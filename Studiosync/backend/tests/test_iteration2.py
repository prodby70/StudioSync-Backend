"""
StudioSync iteration 2 tests:
- Search (q) filter on GET /api/studios
- Booking service_fee=1.0 and total_price
- Reviews (403 without booking, 200 with booking, rating recompute)
- Verification workflow: new studios verified=false, hidden from public listing,
  visible in /studios/mine with pending, admin approve toggles verified=true.
- Admin auth (403 for non-admin).
"""
import os
import re
import uuid
import pytest
import requests
from datetime import datetime, timezone, timedelta

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    with open("/app/frontend/.env") as f:
        for line in f:
            m = re.match(r"EXPO_PUBLIC_BACKEND_URL=(.+)", line.strip())
            if m:
                BASE_URL = m.group(1).strip('"').rstrip("/")
                break

API = f"{BASE_URL}/api"
ADMIN_EMAIL = "test@studiosync.app"
ADMIN_PW = "test123"


@pytest.fixture(scope="module")
def s():
    return requests.Session()


@pytest.fixture(scope="module")
def admin_headers(s):
    r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PW})
    if r.status_code == 401:
        s.post(f"{API}/auth/register", json={"email": ADMIN_EMAIL, "password": ADMIN_PW, "name": "Admin Tester"})
        r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PW})
    assert r.status_code == 200
    body = r.json()
    assert body["user"].get("is_admin") is True, "test@studiosync.app must be in ADMIN_EMAILS"
    return {"Authorization": f"Bearer {body['session_token']}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def other_user_headers(s):
    email = f"TEST_other_{uuid.uuid4().hex[:6]}@studiosync.app"
    r = s.post(f"{API}/auth/register", json={"email": email, "password": "pass1234", "name": "Other"})
    assert r.status_code == 200
    return {"Authorization": f"Bearer {r.json()['session_token']}", "Content-Type": "application/json"}


# ---------------- Search ----------------
class TestSearchQ:
    def test_search_by_name(self, s):
        r = s.get(f"{API}/studios", params={"q": "Sonic"})
        assert r.status_code == 200
        studios = r.json()["studios"]
        assert len(studios) >= 1
        assert any("sonic" in st["name"].lower() for st in studios)

    def test_search_by_equipment_or_description(self, s):
        # description of Sonic Vault contains "consola analógica"
        r = s.get(f"{API}/studios", params={"q": "consola"})
        assert r.status_code == 200
        # Should match at least the studio with 'consola' in description
        studios = r.json()["studios"]
        assert any("consola" in st.get("description", "").lower() for st in studios)

    def test_search_no_match(self, s):
        r = s.get(f"{API}/studios", params={"q": "zzzzzunlikelyquery"})
        assert r.status_code == 200
        assert r.json()["studios"] == []


# ---------------- Booking service_fee ----------------
class TestServiceFee:
    def test_booking_has_service_fee_and_total(self, s, admin_headers):
        studios = s.get(f"{API}/studios", params={"city": "Madrid"}).json()["studios"]
        assert studios
        target = studios[0]
        # Choose a far-future date & odd time to avoid collision
        date = (datetime.now(timezone.utc) + timedelta(days=20)).strftime("%Y-%m-%d")
        payload = {
            "studio_id": target["id"], "date": date,
            "start_hour": 9, "hours": 2, "payment_method": "pay_at_studio",
        }
        r = s.post(f"{API}/bookings", json=payload, headers=admin_headers)
        if r.status_code == 409:
            # try another hour
            payload["start_hour"] = 22
            r = s.post(f"{API}/bookings", json=payload, headers=admin_headers)
        assert r.status_code == 200, r.text
        b = r.json()
        expected_subtotal = round(target["price_per_hour"] * 2, 2)
        assert b["subtotal"] == expected_subtotal, b
        assert b["service_fee"] == 1.0, b
        assert b["total_price"] == round(expected_subtotal + 1.0, 2), b
        # cleanup
        s.post(f"{API}/bookings/{b['id']}/cancel", headers=admin_headers)


# ---------------- Reviews ----------------
class TestReviews:
    def test_review_forbidden_without_booking(self, s, other_user_headers):
        studios = s.get(f"{API}/studios", params={"city": "Berlin"}).json()["studios"]
        sid = studios[0]["id"]
        r = s.post(f"{API}/studios/{sid}/reviews",
                   json={"rating": 5, "comment": "Great"}, headers=other_user_headers)
        assert r.status_code == 403

    def test_review_allowed_with_booking_and_recomputes_rating(self, s, admin_headers):
        # Admin has bookings in previous tests / seed; ensure one exists.
        my_bookings = s.get(f"{API}/bookings", headers=admin_headers).json()["bookings"]
        # Only bookings that point to a currently-existing (non-deleted) studio are valid
        valid = []
        for b in my_bookings:
            chk = s.get(f"{API}/studios/{b['studio_id']}")
            if chk.status_code == 200:
                valid.append(b)
        if not valid:
            studios = s.get(f"{API}/studios", params={"city": "Madrid"}).json()["studios"]
            target = studios[0]
            date = (datetime.now(timezone.utc) + timedelta(days=25)).strftime("%Y-%m-%d")
            for hr in (11, 13, 20, 21, 23):
                r = s.post(f"{API}/bookings", json={
                    "studio_id": target["id"], "date": date, "start_hour": hr, "hours": 1
                }, headers=admin_headers)
                if r.status_code == 200:
                    valid = [r.json()]
                    break
            assert valid, "could not create a valid booking"
        studio_id = valid[0]["studio_id"]

        r = s.post(f"{API}/studios/{studio_id}/reviews",
                   json={"rating": 5, "comment": f"TEST review {uuid.uuid4().hex[:6]}"},
                   headers=admin_headers)
        assert r.status_code == 200, r.text
        rev = r.json()
        assert rev["rating"] == 5
        assert "id" in rev

        # list reviews
        r2 = s.get(f"{API}/studios/{studio_id}/reviews")
        assert r2.status_code == 200
        revs = r2.json()["reviews"]
        assert any(rr["id"] == rev["id"] for rr in revs)

        # studio rating updated
        r3 = s.get(f"{API}/studios/{studio_id}")
        assert r3.status_code == 200
        assert r3.json()["review_count"] >= 1
        assert r3.json()["rating"] > 0


# ---------------- Verification workflow ----------------
class TestVerification:
    _created_ids = []

    def test_new_studio_pending_and_hidden(self, s, admin_headers):
        payload = {
            "name": f"TEST_Pending_{uuid.uuid4().hex[:6]}",
            "type": "recording", "price_per_hour": 40, "city": "Testville",
            "country": "Spain", "address": "X", "lat": 41.0, "lng": 2.0,
            "photos": [], "equipment": [], "open_hour": 9, "close_hour": 22,
        }
        r = s.post(f"{API}/studios", json=payload, headers=admin_headers)
        assert r.status_code == 200
        st = r.json()
        assert st["verified"] is False
        assert st["verification_status"] == "pending"
        TestVerification._created_ids.append(st["id"])

        # NOT in public listing
        public = s.get(f"{API}/studios", params={"city": "Testville"}).json()["studios"]
        assert not any(x["id"] == st["id"] for x in public)

        # IS in /studios/mine
        mine = s.get(f"{API}/studios/mine", headers=admin_headers).json()["studios"]
        assert any(x["id"] == st["id"] for x in mine)

    def test_admin_pending_and_approve(self, s, admin_headers):
        r = s.get(f"{API}/admin/studios/pending", headers=admin_headers)
        assert r.status_code == 200
        pending_ids = [x["id"] for x in r.json()["studios"]]
        assert TestVerification._created_ids[0] in pending_ids

        sid = TestVerification._created_ids[0]
        r2 = s.post(f"{API}/admin/studios/{sid}/verify", params={"approve": "true"}, headers=admin_headers)
        assert r2.status_code == 200
        assert r2.json()["verified"] is True

        # now visible publicly
        public = s.get(f"{API}/studios", params={"city": "Testville"}).json()["studios"]
        assert any(x["id"] == sid for x in public)

    def test_admin_reject(self, s, admin_headers):
        # create another and reject
        payload = {
            "name": f"TEST_Reject_{uuid.uuid4().hex[:6]}", "type": "rehearsal",
            "price_per_hour": 12, "city": "Testville2", "lat": 41.1, "lng": 2.1,
        }
        r = s.post(f"{API}/studios", json=payload, headers=admin_headers)
        sid = r.json()["id"]
        TestVerification._created_ids.append(sid)

        r2 = s.post(f"{API}/admin/studios/{sid}/verify", params={"approve": "false"}, headers=admin_headers)
        assert r2.status_code == 200
        assert r2.json()["verified"] is False

        got = s.get(f"{API}/studios/mine", headers=admin_headers).json()["studios"]
        rec = next(x for x in got if x["id"] == sid)
        assert rec["verification_status"] == "rejected"

    def test_admin_endpoints_forbidden_for_non_admin(self, s, other_user_headers):
        r = s.get(f"{API}/admin/studios/pending", headers=other_user_headers)
        assert r.status_code == 403
        r2 = s.post(f"{API}/admin/studios/x/verify", params={"approve": "true"}, headers=other_user_headers)
        assert r2.status_code == 403

    @classmethod
    def teardown_class(cls):
        # Cleanup created test studios
        sess = requests.Session()
        r = sess.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PW})
        if r.status_code == 200:
            h = {"Authorization": f"Bearer {r.json()['session_token']}"}
            for sid in cls._created_ids:
                sess.delete(f"{API}/studios/{sid}", headers=h)


# ---------------- Payments config ----------------
def test_payments_config_disabled(s):
    r = s.get(f"{API}/payments/config")
    assert r.status_code == 200
    body = r.json()
    assert body == {"stripe": False, "paypal": False}
