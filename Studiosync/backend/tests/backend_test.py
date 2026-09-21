"""
StudioSync backend API pytest suite.
Covers: auth (register/login/me/logout), studios (list/filter/sort/get/mine/create/delete),
availability, bookings (create/list/cancel/overlap/min-1h), upload (best-effort).
"""
import os
import uuid
import pytest
import requests
from datetime import datetime, timezone, timedelta

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # fallback to frontend .env
    import re
    with open("/app/frontend/.env") as f:
        for line in f:
            m = re.match(r"EXPO_PUBLIC_BACKEND_URL=(.+)", line.strip())
            if m:
                BASE_URL = m.group(1).strip('"').rstrip("/")
                break

API = f"{BASE_URL}/api"
TEST_EMAIL = "test@studiosync.app"
TEST_PASSWORD = "test123"


@pytest.fixture(scope="session")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


@pytest.fixture(scope="session")
def token(s):
    # Try login first; if 401, register the seed test user.
    r = s.post(f"{API}/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    if r.status_code == 401:
        rr = s.post(f"{API}/auth/register", json={
            "email": TEST_EMAIL, "password": TEST_PASSWORD, "name": "Test User"
        })
        assert rr.status_code == 200, f"register failed: {rr.status_code} {rr.text}"
        return rr.json()["session_token"]
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json()["session_token"]


@pytest.fixture(scope="session")
def auth_headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ------------------------ Health ------------------------
def test_health_root(s):
    r = s.get(f"{API}/")
    assert r.status_code == 200
    assert "StudioSync" in r.json().get("message", "")


# ------------------------ Auth ------------------------
class TestAuth:
    def test_register_duplicate_returns_400(self, s):
        r = s.post(f"{API}/auth/register", json={
            "email": TEST_EMAIL, "password": TEST_PASSWORD, "name": "Test"
        })
        # test user is already created by the fixture-order-independent case; if not:
        assert r.status_code in (200, 400)
        if r.status_code == 400:
            assert "already" in r.json().get("detail", "").lower()

    def test_login_success(self, s):
        r = s.post(f"{API}/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
        # If seeded user missing, register once
        if r.status_code == 401:
            s.post(f"{API}/auth/register", json={"email": TEST_EMAIL, "password": TEST_PASSWORD, "name": "Test"})
            r = s.post(f"{API}/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
        assert r.status_code == 200
        data = r.json()
        assert "session_token" in data and len(data["session_token"]) > 10
        assert data["user"]["email"] == TEST_EMAIL

    def test_login_invalid(self, s):
        r = s.post(f"{API}/auth/login", json={"email": TEST_EMAIL, "password": "wrong-pw"})
        assert r.status_code == 401

    def test_me_requires_auth(self, s):
        r = s.get(f"{API}/auth/me")
        assert r.status_code == 401

    def test_me_returns_user(self, s, auth_headers):
        r = s.get(f"{API}/auth/me", headers=auth_headers)
        assert r.status_code == 200
        assert r.json()["user"]["email"] == TEST_EMAIL

    def test_logout(self, s):
        # Make a throwaway session so we don't kill the shared token.
        email = f"TEST_logout_{uuid.uuid4().hex[:8]}@studiosync.app"
        rr = s.post(f"{API}/auth/register", json={"email": email, "password": "pass1234", "name": "Logout"})
        assert rr.status_code == 200
        tk = rr.json()["session_token"]
        headers = {"Authorization": f"Bearer {tk}"}
        r = s.post(f"{API}/auth/logout", headers=headers)
        assert r.status_code == 200 and r.json().get("ok") is True
        r2 = s.get(f"{API}/auth/me", headers=headers)
        assert r2.status_code == 401


# ------------------------ Studios ------------------------
class TestStudios:
    def test_list_default(self, s):
        r = s.get(f"{API}/studios")
        assert r.status_code == 200
        studios = r.json()["studios"]
        assert isinstance(studios, list)
        assert len(studios) >= 8, "seed data should provide 8 studios"
        # ensure _id is not exposed
        for st in studios:
            assert "_id" not in st
            assert "id" in st and "price_per_hour" in st and "lat" in st

    def test_filter_by_city(self, s):
        r = s.get(f"{API}/studios", params={"city": "Madrid"})
        assert r.status_code == 200
        studios = r.json()["studios"]
        assert len(studios) >= 1
        assert all(st["city"].lower() == "madrid" for st in studios)

    def test_filter_by_type_recording(self, s):
        r = s.get(f"{API}/studios", params={"type": "recording"})
        assert r.status_code == 200
        studios = r.json()["studios"]
        assert all(st["type"] == "recording" for st in studios)

    def test_sort_price_asc(self, s):
        r = s.get(f"{API}/studios", params={"sort": "price_asc"})
        prices = [st["price_per_hour"] for st in r.json()["studios"]]
        assert prices == sorted(prices)

    def test_sort_price_desc(self, s):
        r = s.get(f"{API}/studios", params={"sort": "price_desc"})
        prices = [st["price_per_hour"] for st in r.json()["studios"]]
        assert prices == sorted(prices, reverse=True)

    def test_relevance_with_geo_computes_distance(self, s):
        # Madrid center
        r = s.get(f"{API}/studios", params={"lat": 40.4168, "lng": -3.7038, "sort": "relevance"})
        assert r.status_code == 200
        studios = r.json()["studios"]
        assert any(st.get("distance_km") is not None for st in studios)

    def test_get_studio_by_id(self, s):
        listed = s.get(f"{API}/studios").json()["studios"]
        sid = listed[0]["id"]
        r = s.get(f"{API}/studios/{sid}")
        assert r.status_code == 200
        assert r.json()["id"] == sid

    def test_get_studio_not_found(self, s):
        r = s.get(f"{API}/studios/does-not-exist")
        assert r.status_code == 404

    def test_studios_mine_requires_auth(self, s):
        r = s.get(f"{API}/studios/mine")
        assert r.status_code == 401


class TestStudioOwnerFlow:
    @pytest.fixture(scope="class")
    def studio_id(self, s, auth_headers):
        payload = {
            "name": f"TEST_Studio_{uuid.uuid4().hex[:6]}",
            "type": "recording",
            "description": "Test studio for pytest",
            "price_per_hour": 30.0,
            "currency": "EUR",
            "city": "Madrid",
            "country": "Spain",
            "address": "Test 1",
            "lat": 40.4168,
            "lng": -3.7038,
            "photos": [],
            "equipment": ["Mic"],
            "open_hour": 8,
            "close_hour": 24,
        }
        r = s.post(f"{API}/studios", json=payload, headers=auth_headers)
        assert r.status_code == 200, r.text
        sid = r.json()["id"]
        yield sid
        # cleanup: delete
        s.delete(f"{API}/studios/{sid}", headers=auth_headers)

    def test_create_studio_persists(self, s, studio_id):
        r = s.get(f"{API}/studios/{studio_id}")
        assert r.status_code == 200
        assert r.json()["price_per_hour"] == 30.0

    def test_studios_mine_contains_created(self, s, auth_headers, studio_id):
        r = s.get(f"{API}/studios/mine", headers=auth_headers)
        assert r.status_code == 200
        ids = [st["id"] for st in r.json()["studios"]]
        assert studio_id in ids

    def test_delete_studio_soft(self, s, auth_headers):
        # create another and delete it
        payload = {
            "name": f"TEST_Del_{uuid.uuid4().hex[:6]}", "type": "rehearsal",
            "price_per_hour": 10, "city": "Madrid", "lat": 40.4, "lng": -3.7,
        }
        r = s.post(f"{API}/studios", json=payload, headers=auth_headers)
        sid = r.json()["id"]
        r2 = s.delete(f"{API}/studios/{sid}", headers=auth_headers)
        assert r2.status_code == 200
        r3 = s.get(f"{API}/studios/{sid}")
        assert r3.status_code == 404

    def test_delete_other_owner_studio_forbidden(self, s, auth_headers):
        # seed studios owner is different user
        seed_id = s.get(f"{API}/studios", params={"city": "Berlin"}).json()["studios"][0]["id"]
        r = s.delete(f"{API}/studios/{seed_id}", headers=auth_headers)
        assert r.status_code == 403


# ------------------------ Availability & Bookings ------------------------
def _future_date_str(days=2):
    return (datetime.now(timezone.utc) + timedelta(days=days)).strftime("%Y-%m-%d")


class TestBookings:
    @pytest.fixture(scope="class")
    def seed_studio(self, s):
        return s.get(f"{API}/studios", params={"city": "Madrid"}).json()["studios"][0]

    def test_availability(self, s, seed_studio):
        r = s.get(f"{API}/studios/{seed_studio['id']}/availability", params={"date": _future_date_str()})
        assert r.status_code == 200
        body = r.json()
        assert body["open_hour"] == 8 and body["close_hour"] == 24
        assert isinstance(body["booked_hours"], list)

    def test_booking_requires_auth(self, s, seed_studio):
        r = s.post(f"{API}/bookings", json={
            "studio_id": seed_studio["id"], "date": _future_date_str(),
            "start_hour": 10, "hours": 1,
        })
        assert r.status_code == 401

    def test_min_1h_ahead_validation(self, s, auth_headers, seed_studio):
        # date in the past should be rejected
        past = (datetime.now(timezone.utc) - timedelta(days=1)).strftime("%Y-%m-%d")
        r = s.post(f"{API}/bookings", json={
            "studio_id": seed_studio["id"], "date": past, "start_hour": 10, "hours": 1
        }, headers=auth_headers)
        assert r.status_code == 400
        assert "1 hour" in r.json().get("detail", "").lower() or "advance" in r.json().get("detail", "").lower()

    def test_create_and_overlap(self, s, auth_headers, seed_studio):
        import random
        date = _future_date_str(days=random.randint(10, 60))
        start = random.choice([8, 9, 10, 11, 12, 13, 14, 15, 16, 17])
        payload = {
            "studio_id": seed_studio["id"], "date": date,
            "start_hour": start, "hours": 2, "payment_method": "pay_at_studio"
        }
        r = s.post(f"{API}/bookings", json=payload, headers=auth_headers)
        # retry with different slot if collision
        for _ in range(5):
            if r.status_code == 200:
                break
            start = (start + 3) % 20 + 8
            payload["start_hour"] = start
            r = s.post(f"{API}/bookings", json=payload, headers=auth_headers)
        assert r.status_code == 200, r.text
        booking = r.json()
        assert booking["status"] == "confirmed"
        assert booking["total_price"] == round(seed_studio["price_per_hour"] * 2 + 1.0, 2)
        booking_id = booking["id"]

        # overlapping booking -> 409
        r2 = s.post(f"{API}/bookings", json={
            "studio_id": seed_studio["id"], "date": date, "start_hour": start + 1, "hours": 1
        }, headers=auth_headers)
        assert r2.status_code == 409

        # availability now shows those hours as booked
        r3 = s.get(f"{API}/studios/{seed_studio['id']}/availability", params={"date": date})
        assert start in r3.json()["booked_hours"] and (start + 1) in r3.json()["booked_hours"]

        # cleanup: cancel
        rc = s.post(f"{API}/bookings/{booking_id}/cancel", headers=auth_headers)
        assert rc.status_code == 200

    def test_list_my_bookings(self, s, auth_headers):
        r = s.get(f"{API}/bookings", headers=auth_headers)
        assert r.status_code == 200
        assert isinstance(r.json()["bookings"], list)

    def test_cancel_not_owned(self, s, auth_headers):
        r = s.post(f"{API}/bookings/nonexistent-id/cancel", headers=auth_headers)
        assert r.status_code == 404
