from fastapi import FastAPI, APIRouter, HTTPException, Depends, Header, UploadFile, File, Query
from fastapi.responses import Response
from fastapi.concurrency import run_in_threadpool
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import math
from html import escape
import uuid
import secrets
import bcrypt
import httpx
import requests
import stripe
from pathlib import Path
from pydantic import BaseModel, Field, EmailStr, BeforeValidator
from typing import List, Optional, Annotated, Any
from datetime import datetime, timezone, timedelta


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# ----------------------------------------------------------------------------
# Object storage helpers
# ----------------------------------------------------------------------------
STORAGE_BASE = (os.environ.get("INTEGRATION_PROXY_URL") or "").strip() or "https://integrations.emergentagent.com"
STORAGE_URL = STORAGE_BASE.rstrip("/") + "/objstore/api/v1/storage"
EMERGENT_KEY = os.environ.get("EMERGENT_LLM_KEY")
APP_NAME = "studiosync"
_storage_key = None

# ----------------------------------------------------------------------------
# Payments config (optional: activates when keys are provided)
# ----------------------------------------------------------------------------
STRIPE_SECRET = os.environ.get("STRIPE_SECRET_KEY", "").strip()
if STRIPE_SECRET:
    stripe.api_key = STRIPE_SECRET
PAYPAL_CLIENT_ID = os.environ.get("PAYPAL_CLIENT_ID", "").strip()
PAYPAL_SECRET = os.environ.get("PAYPAL_SECRET", "").strip()
PAYPAL_MODE = os.environ.get("PAYPAL_MODE", "sandbox").strip()
PAYPAL_BASE = "https://api-m.paypal.com" if PAYPAL_MODE == "live" else "https://api-m.sandbox.paypal.com"
PUBLIC_APP_URL = os.environ.get("PUBLIC_APP_URL", "").rstrip("/")

STRIPE_ENABLED = bool(STRIPE_SECRET)
PAYPAL_ENABLED = bool(PAYPAL_CLIENT_ID and PAYPAL_SECRET)

# Fixed booking management fee (added on top of the owner's price, paid by client)
SERVICE_FEE = 1.0
ADMIN_EMAILS = {e.strip().lower() for e in os.environ.get("ADMIN_EMAILS", "").split(",") if e.strip()}

# ----------------------------------------------------------------------------
# Email (Emergent managed Resend)
# ----------------------------------------------------------------------------
EMAIL_BASE_URL = "https://integrations.emergentagent.com"
EMAIL_KEY = os.environ.get("EMERGENT_EMAIL_KEY", "")
EMAIL_FROM_NAME = os.environ.get("EMAIL_FROM_NAME", "StudioSync")


async def send_email(*, to: str, subject: str, html: str) -> Optional[str]:
    if not EMAIL_KEY:
        logger.warning("EMERGENT_EMAIL_KEY not set; skipping email")
        return None
    payload = {"to": [to], "subject": subject, "html": html, "from_name": EMAIL_FROM_NAME}
    try:
        async with httpx.AsyncClient(timeout=30) as http:
            resp = await http.post(
                f"{EMAIL_BASE_URL}/api/v1/email/send",
                headers={"X-Email-Key": EMAIL_KEY},
                json=payload,
            )
        resp.raise_for_status()
        return resp.json().get("id")
    except Exception as e:
        logger.error(f"Email send error: {e}")
        return None


def _verification_email_html(name: str, code: str) -> str:
    safe_name = escape(name)
    safe_code = escape(code)
    return (
        '<table role="presentation" width="100%"><tr><td style="padding:24px;'
        'font-family:Arial,sans-serif;color:#111">'
        f'<p>Hola {safe_name}, bienvenido a {escape(EMAIL_FROM_NAME)}.</p>'
        '<p>Tu código de verificación es:</p>'
        f'<p style="font-size:32px;font-weight:bold;letter-spacing:6px;color:#111">{safe_code}</p>'
        '<p>Introduce este código en la app para verificar tu email. Caduca en 15 minutos.</p>'
        f'<p style="font-size:12px;color:#888">Enviado por {escape(EMAIL_FROM_NAME)}. '
        'Nunca te pediremos tu contraseña ni datos de tarjeta por email.</p>'
        '</td></tr></table>'
    )


def _gen_code() -> str:
    return f"{secrets.randbelow(1000000):06d}"


def init_storage():
    global _storage_key
    if _storage_key:
        return _storage_key
    resp = requests.post(f"{STORAGE_URL}/init", json={"emergent_key": EMERGENT_KEY}, timeout=30)
    resp.raise_for_status()
    _storage_key = resp.json()["storage_key"]
    return _storage_key


def put_object(path: str, data: bytes, content_type: str) -> dict:
    key = init_storage()
    resp = requests.put(
        f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key, "Content-Type": content_type},
        data=data,
        timeout=120,
    )
    resp.raise_for_status()
    return resp.json()


def get_object(path: str):
    global _storage_key
    key = init_storage()
    resp = requests.get(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": key}, timeout=60)
    if resp.status_code == 503:
        _storage_key = None
        key = init_storage()
        resp = requests.get(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": key}, timeout=60)
    resp.raise_for_status()
    return resp.content, resp.headers.get("Content-Type", "application/octet-stream")


# ----------------------------------------------------------------------------
# Mongo base document
# ----------------------------------------------------------------------------
def _to_str(v: Any) -> Any:
    return str(v) if v is not None else v


PyObjectId = Annotated[str, BeforeValidator(_to_str)]


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


# ----------------------------------------------------------------------------
# Models
# ----------------------------------------------------------------------------
class User(BaseModel):
    user_id: str
    email: str
    name: str
    picture: Optional[str] = None
    is_owner: bool = False


class RegisterInput(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)
    name: str


class LoginInput(BaseModel):
    email: EmailStr
    password: str


class SessionInput(BaseModel):
    session_id: str


class StudioInput(BaseModel):
    name: str
    type: str = "recording"  # recording | rehearsal
    description: str = ""
    price_per_hour: float
    currency: str = "EUR"
    city: str
    country: str = ""
    address: str = ""
    lat: float
    lng: float
    photos: List[str] = []
    equipment: List[str] = []
    open_hour: int = 8
    close_hour: int = 24
    verification_docs: List[str] = []


class BookingInput(BaseModel):
    studio_id: str
    date: str  # YYYY-MM-DD
    start_hour: int
    hours: int = 1
    payment_method: str = "pay_at_studio"


class ReviewInput(BaseModel):
    rating: int = Field(ge=1, le=5)
    comment: str = ""


class CheckoutInput(BaseModel):
    booking_id: str
    provider: str  # stripe | paypal


class VerifyInput(BaseModel):
    booking_id: str
    provider: str
    ref: str


class EmailCodeInput(BaseModel):
    code: str


# ----------------------------------------------------------------------------
# App / router
# ----------------------------------------------------------------------------
app = FastAPI()
api_router = APIRouter(prefix="/api")


async def get_current_user(authorization: Optional[str] = Header(None)) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = authorization.split(" ", 1)[1].strip()
    session = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=401, detail="Invalid session")
    expires_at = session.get("expires_at")
    if isinstance(expires_at, datetime):
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if expires_at < now_utc():
            raise HTTPException(status_code=401, detail="Session expired")
    user = await db.users.find_one({"user_id": session["user_id"]}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


async def optional_user(authorization: Optional[str] = Header(None)) -> Optional[dict]:
    try:
        return await get_current_user(authorization)
    except HTTPException:
        return None


async def create_session(user_id: str) -> str:
    token = secrets.token_urlsafe(32)
    await db.user_sessions.insert_one({
        "session_token": token,
        "user_id": user_id,
        "created_at": now_utc(),
        "expires_at": now_utc() + timedelta(days=7),
    })
    return token


def public_user(user: dict) -> dict:
    return {
        "user_id": user["user_id"],
        "email": user["email"],
        "name": user["name"],
        "picture": user.get("picture"),
        "is_owner": user.get("is_owner", False),
        "is_admin": user.get("is_admin", False) or user["email"].lower() in ADMIN_EMAILS,
        "email_verified": user.get("email_verified", False),
    }


async def get_admin(user: dict = Depends(get_current_user)) -> dict:
    if not (user.get("is_admin") or user["email"].lower() in ADMIN_EMAILS):
        raise HTTPException(status_code=403, detail="Solo administradores")
    return user


# ----------------------------------------------------------------------------
# Auth routes
# ----------------------------------------------------------------------------
@api_router.post("/auth/register")
async def register(body: RegisterInput):
    existing = await db.users.find_one({"email": body.email.lower()})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    user_id = f"user_{uuid.uuid4().hex[:12]}"
    pw_hash = bcrypt.hashpw(body.password.encode(), bcrypt.gensalt()).decode()
    code = _gen_code()
    doc = {
        "user_id": user_id,
        "email": body.email.lower(),
        "name": body.name,
        "picture": None,
        "is_owner": False,
        "password_hash": pw_hash,
        "email_verified": False,
        "email_code": code,
        "email_code_expires": (now_utc() + timedelta(minutes=15)).isoformat(),
        "created_at": now_utc(),
    }
    await db.users.insert_one(doc)
    await send_email(
        to=doc["email"],
        subject=f"Tu código de verificación de {EMAIL_FROM_NAME}",
        html=_verification_email_html(body.name, code),
    )
    token = await create_session(user_id)
    return {"session_token": token, "user": public_user(doc)}


@api_router.post("/auth/login")
async def login(body: LoginInput):
    user = await db.users.find_one({"email": body.email.lower()})
    if not user or not user.get("password_hash"):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if not bcrypt.checkpw(body.password.encode(), user["password_hash"].encode()):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = await create_session(user["user_id"])
    return {"session_token": token, "user": public_user(user)}


@api_router.post("/auth/session")
async def auth_session(body: SessionInput):
    async with httpx.AsyncClient(timeout=30) as http:
        resp = await http.get(
            "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
            headers={"X-Session-ID": body.session_id},
        )
    if resp.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid session")
    data = resp.json()
    email = data["email"].lower()
    user = await db.users.find_one({"email": email})
    if user:
        user_id = user["user_id"]
    else:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        user = {
            "user_id": user_id,
            "email": email,
            "name": data.get("name", email.split("@")[0]),
            "picture": data.get("picture"),
            "is_owner": False,
            "email_verified": True,
            "created_at": now_utc(),
        }
        await db.users.insert_one(user)
    token = await create_session(user_id)
    return {"session_token": token, "user": public_user(user)}


@api_router.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return {"user": public_user(user)}


@api_router.post("/auth/verify-email")
async def verify_email(body: EmailCodeInput, user: dict = Depends(get_current_user)):
    if user.get("email_verified"):
        return {"user": public_user(user)}
    stored = user.get("email_code")
    expires = user.get("email_code_expires")
    if not stored or stored != body.code.strip():
        raise HTTPException(status_code=400, detail="Código incorrecto")
    if expires:
        try:
            exp = datetime.fromisoformat(expires)
            if exp.tzinfo is None:
                exp = exp.replace(tzinfo=timezone.utc)
            if exp < now_utc():
                raise HTTPException(status_code=400, detail="El código ha caducado")
        except ValueError:
            pass
    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$set": {"email_verified": True}, "$unset": {"email_code": "", "email_code_expires": ""}},
    )
    fresh = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0})
    return {"user": public_user(fresh)}


@api_router.post("/auth/resend-code")
async def resend_code(user: dict = Depends(get_current_user)):
    if user.get("email_verified"):
        return {"ok": True}
    code = _gen_code()
    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$set": {"email_code": code, "email_code_expires": (now_utc() + timedelta(minutes=15)).isoformat()}},
    )
    await send_email(
        to=user["email"],
        subject=f"Tu código de verificación de {EMAIL_FROM_NAME}",
        html=_verification_email_html(user.get("name", ""), code),
    )
    return {"ok": True}


@api_router.post("/auth/logout")
async def logout(authorization: Optional[str] = Header(None)):
    if authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ", 1)[1].strip()
        await db.user_sessions.delete_one({"session_token": token})
    return {"ok": True}


# ----------------------------------------------------------------------------
# Upload / files
# ----------------------------------------------------------------------------
@api_router.post("/upload")
async def upload(file: UploadFile = File(...), user: dict = Depends(get_current_user)):
    data = await file.read()
    ext = (file.filename or "img").split(".")[-1].lower()
    if ext not in ("jpg", "jpeg", "png", "webp", "heic"):
        ext = "jpg"
    path = f"{APP_NAME}/uploads/{user['user_id']}/{uuid.uuid4().hex}.{ext}"
    ct = file.content_type or "image/jpeg"
    await run_in_threadpool(put_object, path, data, ct)
    await db.uploads.insert_one({
        "storage_path": path,
        "owner_id": user["user_id"],
        "content_type": ct,
        "created_at": now_utc(),
    })
    return {"path": path}


@api_router.get("/files/{path:path}")
async def files(path: str, token: Optional[str] = Query(None)):
    rec = await db.uploads.find_one({"storage_path": path}, {"_id": 0})
    if not rec:
        raise HTTPException(status_code=404, detail="Not found")
    content, ct = await run_in_threadpool(get_object, path)
    return Response(content=content, media_type=ct)


# ----------------------------------------------------------------------------
# Studios
# ----------------------------------------------------------------------------
def haversine(lat1, lng1, lat2, lng2) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return r * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def serialize_studio(s: dict, lat: Optional[float] = None, lng: Optional[float] = None) -> dict:
    out = {k: v for k, v in s.items() if k != "_id"}
    if lat is not None and lng is not None:
        out["distance_km"] = round(haversine(lat, lng, s["lat"], s["lng"]), 1)
    else:
        out["distance_km"] = None
    return out


@api_router.post("/studios")
async def create_studio(body: StudioInput, user: dict = Depends(get_current_user)):
    studio_id = f"studio_{uuid.uuid4().hex[:12]}"
    doc = body.model_dump()
    doc.update({
        "id": studio_id,
        "owner_id": user["user_id"],
        "owner_name": user["name"],
        "owner_email": user["email"],
        "rating": 0.0,
        "review_count": 0,
        "verified": False,
        "verification_status": "pending",
        "created_at": now_utc().isoformat(),
        "deleted_at": None,
    })
    await db.studios.insert_one(doc)
    if not user.get("is_owner"):
        await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"is_owner": True}})
    return serialize_studio(doc)


@api_router.get("/studios")
async def list_studios(
    city: Optional[str] = None,
    type: Optional[str] = None,
    q: Optional[str] = None,
    lat: Optional[float] = None,
    lng: Optional[float] = None,
    sort: str = "relevance",
):
    query: dict = {"deleted_at": None, "verified": True}
    if city:
        query["city"] = {"$regex": f"^{city}$", "$options": "i"}
    if type and type != "all":
        query["type"] = type
    if q:
        query["$or"] = [
            {"name": {"$regex": q, "$options": "i"}},
            {"city": {"$regex": q, "$options": "i"}},
            {"description": {"$regex": q, "$options": "i"}},
        ]
    docs = await db.studios.find(query).to_list(500)
    items = [serialize_studio(d, lat, lng) for d in docs]

    if sort == "price_asc":
        items.sort(key=lambda x: x["price_per_hour"])
    elif sort == "price_desc":
        items.sort(key=lambda x: x["price_per_hour"], reverse=True)
    else:  # relevance
        if lat is not None and lng is not None:
            items.sort(key=lambda x: (x.get("distance_km") or 9e9, -x["rating"]))
        else:
            items.sort(key=lambda x: (-x["rating"], -x["review_count"]))
    return {"studios": items}


@api_router.get("/studios/mine")
async def my_studios(user: dict = Depends(get_current_user)):
    docs = await db.studios.find({"owner_id": user["user_id"], "deleted_at": None}).to_list(200)
    return {"studios": [serialize_studio(d) for d in docs]}


@api_router.get("/studios/{studio_id}")
async def get_studio(studio_id: str, lat: Optional[float] = None, lng: Optional[float] = None):
    doc = await db.studios.find_one({"id": studio_id, "deleted_at": None})
    if not doc:
        raise HTTPException(status_code=404, detail="Studio not found")
    return serialize_studio(doc, lat, lng)


@api_router.delete("/studios/{studio_id}")
async def delete_studio(studio_id: str, user: dict = Depends(get_current_user)):
    doc = await db.studios.find_one({"id": studio_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Studio not found")
    if doc["owner_id"] != user["user_id"]:
        raise HTTPException(status_code=403, detail="Not your studio")
    await db.studios.update_one({"id": studio_id}, {"$set": {"deleted_at": now_utc().isoformat()}})
    return {"ok": True}


@api_router.get("/studios/{studio_id}/availability")
async def availability(studio_id: str, date: str):
    studio = await db.studios.find_one({"id": studio_id, "deleted_at": None})
    if not studio:
        raise HTTPException(status_code=404, detail="Studio not found")
    bookings = await db.bookings.find(
        {"studio_id": studio_id, "date": date, "status": "confirmed", "deleted_at": None}
    ).to_list(200)
    booked = set()
    for b in bookings:
        for h in range(b["start_hour"], b["start_hour"] + b["hours"]):
            booked.add(h)
    return {
        "date": date,
        "open_hour": studio.get("open_hour", 8),
        "close_hour": studio.get("close_hour", 24),
        "booked_hours": sorted(booked),
    }


# ----------------------------------------------------------------------------
# Bookings
# ----------------------------------------------------------------------------
@api_router.post("/bookings")
async def create_booking(body: BookingInput, user: dict = Depends(get_current_user)):
    studio = await db.studios.find_one({"id": body.studio_id, "deleted_at": None})
    if not studio:
        raise HTTPException(status_code=404, detail="Studio not found")
    if body.hours < 1:
        raise HTTPException(status_code=400, detail="Minimum 1 hour")

    # must start at least 1 hour ahead of now
    try:
        start_dt = datetime.strptime(body.date, "%Y-%m-%d").replace(
            hour=body.start_hour, tzinfo=timezone.utc
        )
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date")
    if start_dt < now_utc() + timedelta(hours=1):
        raise HTTPException(status_code=400, detail="Bookings must be at least 1 hour in advance")

    # overlap check
    existing = await db.bookings.find(
        {"studio_id": body.studio_id, "date": body.date, "status": "confirmed", "deleted_at": None}
    ).to_list(200)
    requested = set(range(body.start_hour, body.start_hour + body.hours))
    for b in existing:
        if requested & set(range(b["start_hour"], b["start_hour"] + b["hours"])):
            raise HTTPException(status_code=409, detail="Selected time is no longer available")

    booking_id = f"bk_{uuid.uuid4().hex[:12]}"
    subtotal = round(studio["price_per_hour"] * body.hours, 2)
    service_fee = SERVICE_FEE
    total = round(subtotal + service_fee, 2)
    photo = studio.get("photos", [None])[0] if studio.get("photos") else None
    doc = {
        "id": booking_id,
        "studio_id": body.studio_id,
        "studio_name": studio["name"],
        "studio_city": studio["city"],
        "studio_photo": photo,
        "user_id": user["user_id"],
        "date": body.date,
        "start_hour": body.start_hour,
        "hours": body.hours,
        "subtotal": subtotal,
        "service_fee": service_fee,
        "total_price": total,
        "currency": studio.get("currency", "EUR"),
        "payment_method": body.payment_method,
        "payment_status": "onsite",
        "amount_minor": int(round(total * 100)),
        "status": "confirmed",
        "created_at": now_utc().isoformat(),
        "deleted_at": None,
    }
    await db.bookings.insert_one(doc)
    return {k: v for k, v in doc.items() if k != "_id"}


@api_router.get("/bookings")
async def my_bookings(user: dict = Depends(get_current_user)):
    docs = await db.bookings.find(
        {"user_id": user["user_id"], "deleted_at": None}
    ).sort("created_at", -1).to_list(200)
    return {"bookings": [{k: v for k, v in d.items() if k != "_id"} for d in docs]}


@api_router.post("/bookings/{booking_id}/cancel")
async def cancel_booking(booking_id: str, user: dict = Depends(get_current_user)):
    b = await db.bookings.find_one({"id": booking_id})
    if not b or b["user_id"] != user["user_id"]:
        raise HTTPException(status_code=404, detail="Booking not found")
    await db.bookings.update_one({"id": booking_id}, {"$set": {"status": "cancelled"}})
    return {"ok": True}


# ----------------------------------------------------------------------------
# Reviews
# ----------------------------------------------------------------------------
async def recompute_rating(studio_id: str):
    reviews = await db.reviews.find({"studio_id": studio_id}).to_list(1000)
    if reviews:
        avg = round(sum(r["rating"] for r in reviews) / len(reviews), 1)
        await db.studios.update_one(
            {"id": studio_id},
            {"$set": {"rating": avg, "review_count": len(reviews)}},
        )


@api_router.get("/studios/{studio_id}/reviews")
async def list_reviews(studio_id: str):
    docs = await db.reviews.find({"studio_id": studio_id}).sort("created_at", -1).to_list(200)
    return {"reviews": [{k: v for k, v in d.items() if k != "_id"} for d in docs]}


@api_router.post("/studios/{studio_id}/reviews")
async def add_review(studio_id: str, body: ReviewInput, user: dict = Depends(get_current_user)):
    studio = await db.studios.find_one({"id": studio_id, "deleted_at": None})
    if not studio:
        raise HTTPException(status_code=404, detail="Studio not found")
    has_booking = await db.bookings.find_one(
        {"studio_id": studio_id, "user_id": user["user_id"], "deleted_at": None}
    )
    if not has_booking:
        raise HTTPException(status_code=403, detail="Solo puedes reseñar estudios que hayas reservado")

    existing = await db.reviews.find_one({"studio_id": studio_id, "user_id": user["user_id"]})
    if existing:
        await db.reviews.update_one(
            {"id": existing["id"]},
            {"$set": {"rating": body.rating, "comment": body.comment.strip(), "created_at": now_utc().isoformat()}},
        )
        review_id = existing["id"]
    else:
        review_id = f"rev_{uuid.uuid4().hex[:12]}"
        await db.reviews.insert_one({
            "id": review_id,
            "studio_id": studio_id,
            "user_id": user["user_id"],
            "user_name": user["name"],
            "user_picture": user.get("picture"),
            "rating": body.rating,
            "comment": body.comment.strip(),
            "created_at": now_utc().isoformat(),
        })
    await recompute_rating(studio_id)
    doc = await db.reviews.find_one({"id": review_id}, {"_id": 0})
    return doc


# ----------------------------------------------------------------------------
# Payments (Stripe hosted Checkout + PayPal Orders)
# ----------------------------------------------------------------------------
@api_router.get("/payments/config")
async def payments_config():
    return {"stripe": STRIPE_ENABLED, "paypal": PAYPAL_ENABLED}


async def _paypal_token() -> str:
    async with httpx.AsyncClient(timeout=30) as http:
        resp = await http.post(
            f"{PAYPAL_BASE}/v1/oauth2/token",
            auth=(PAYPAL_CLIENT_ID, PAYPAL_SECRET),
            data={"grant_type": "client_credentials"},
        )
    resp.raise_for_status()
    return resp.json()["access_token"]


@api_router.post("/payments/checkout")
async def payments_checkout(body: CheckoutInput, user: dict = Depends(get_current_user)):
    booking = await db.bookings.find_one({"id": body.booking_id, "user_id": user["user_id"]})
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    if booking.get("payment_status") == "paid":
        raise HTTPException(status_code=409, detail="Ya está pagada")
    amount = float(booking["total_price"])
    currency = booking.get("currency", "EUR")

    if body.provider == "stripe":
        if not STRIPE_ENABLED:
            raise HTTPException(status_code=400, detail="Pagos con tarjeta no configurados")
        session = await run_in_threadpool(
            lambda: stripe.checkout.Session.create(
                mode="payment",
                payment_method_types=["card"],
                line_items=[{
                    "price_data": {
                        "currency": currency.lower(),
                        "product_data": {"name": booking["studio_name"]},
                        "unit_amount": int(round(amount * 100)),
                    },
                    "quantity": 1,
                }],
                client_reference_id=body.booking_id,
                metadata={"booking_id": body.booking_id},
                success_url=f"{PUBLIC_APP_URL}/payment-return?provider=stripe&booking_id={body.booking_id}&ref={{CHECKOUT_SESSION_ID}}",
                cancel_url=f"{PUBLIC_APP_URL}/payment-return?provider=stripe&booking_id={body.booking_id}&cancel=1",
            )
        )
        await db.bookings.update_one(
            {"id": body.booking_id},
            {"$set": {"payment_status": "awaiting", "payment_ref": session.id, "provider": "stripe"}},
        )
        return {"url": session.url, "ref": session.id}

    if body.provider == "paypal":
        if not PAYPAL_ENABLED:
            raise HTTPException(status_code=400, detail="PayPal no configurado")
        token = await _paypal_token()
        async with httpx.AsyncClient(timeout=30) as http:
            resp = await http.post(
                f"{PAYPAL_BASE}/v2/checkout/orders",
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                json={
                    "intent": "CAPTURE",
                    "purchase_units": [{
                        "reference_id": body.booking_id,
                        "description": booking["studio_name"],
                        "amount": {"currency_code": currency, "value": f"{amount:.2f}"},
                    }],
                    "application_context": {
                        "return_url": f"{PUBLIC_APP_URL}/payment-return?provider=paypal&booking_id={body.booking_id}",
                        "cancel_url": f"{PUBLIC_APP_URL}/payment-return?provider=paypal&booking_id={body.booking_id}&cancel=1",
                        "user_action": "PAY_NOW",
                    },
                },
            )
        resp.raise_for_status()
        order = resp.json()
        approve = next((l["href"] for l in order.get("links", []) if l["rel"] == "approve"), None)
        await db.bookings.update_one(
            {"id": body.booking_id},
            {"$set": {"payment_status": "awaiting", "payment_ref": order["id"], "provider": "paypal"}},
        )
        return {"url": approve, "ref": order["id"]}

    raise HTTPException(status_code=400, detail="Proveedor no válido")


@api_router.post("/payments/verify")
async def payments_verify(body: VerifyInput, user: dict = Depends(get_current_user)):
    booking = await db.bookings.find_one({"id": body.booking_id, "user_id": user["user_id"]})
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    paid = False

    if body.provider == "stripe" and STRIPE_ENABLED:
        session = await run_in_threadpool(lambda: stripe.checkout.Session.retrieve(body.ref))
        paid = session.get("payment_status") == "paid"
    elif body.provider == "paypal" and PAYPAL_ENABLED:
        token = await _paypal_token()
        async with httpx.AsyncClient(timeout=30) as http:
            resp = await http.post(
                f"{PAYPAL_BASE}/v2/checkout/orders/{body.ref}/capture",
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            )
        if resp.status_code in (200, 201):
            paid = resp.json().get("status") == "COMPLETED"
        elif resp.status_code == 422:
            # already captured
            paid = True

    if paid:
        await db.bookings.update_one(
            {"id": body.booking_id}, {"$set": {"payment_status": "paid"}}
        )
    doc = await db.bookings.find_one({"id": body.booking_id}, {"_id": 0})
    return {"paid": paid, "booking": doc}


# ----------------------------------------------------------------------------
# Admin: studio verification
# ----------------------------------------------------------------------------
@api_router.get("/admin/studios/pending")
async def admin_pending(admin: dict = Depends(get_admin)):
    docs = await db.studios.find(
        {"verification_status": "pending", "deleted_at": None}
    ).to_list(200)
    return {"studios": [serialize_studio(d) for d in docs]}


@api_router.post("/admin/studios/{studio_id}/verify")
async def admin_verify(studio_id: str, approve: bool = True, admin: dict = Depends(get_admin)):
    studio = await db.studios.find_one({"id": studio_id})
    if not studio:
        raise HTTPException(status_code=404, detail="Studio not found")
    await db.studios.update_one(
        {"id": studio_id},
        {"$set": {
            "verified": bool(approve),
            "verification_status": "approved" if approve else "rejected",
        }},
    )
    return {"ok": True, "verified": bool(approve)}


@api_router.get("/")
async def root():
    return {"message": "StudioSync API"}


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=False,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


SEED_STUDIOS = [
    {"name": "Sonic Vault Studios", "type": "recording", "city": "Madrid", "country": "Spain",
     "address": "Calle de la Cabeza 12", "lat": 40.4114, "lng": -3.7038, "price_per_hour": 45,
     "rating": 4.9, "review_count": 128, "equipment": ["SSL Console", "Neumann U87", "Pro Tools", "Vintage Preamps"],
     "photos": ["https://images.unsplash.com/photo-1598488035139-bdbb2231ce04?crop=entropy&cs=srgb&fm=jpg&q=85&w=1200"],
     "description": "Sala de grabación premium en el centro de Madrid con consola analógica y cabina aislada."},
    {"name": "La Cueva Rehearsal", "type": "rehearsal", "city": "Madrid", "country": "Spain",
     "address": "Calle de Embajadores 45", "lat": 40.4055, "lng": -3.7025, "price_per_hour": 18,
     "rating": 4.6, "review_count": 87, "equipment": ["Backline", "Batería Pearl", "PA System", "Amplis Marshall"],
     "photos": ["https://images.pexels.com/photos/8197342/pexels-photo-8197342.jpeg?auto=compress&cs=tinysrgb&w=1200"],
     "description": "Local de ensayo insonorizado con backline completo. Ideal para bandas."},
    {"name": "Retiro Sound Lab", "type": "recording", "city": "Madrid", "country": "Spain",
     "address": "Av. Menéndez Pelayo 3", "lat": 40.4189, "lng": -3.6836, "price_per_hour": 60,
     "rating": 4.8, "review_count": 64, "equipment": ["API 1608", "Analog Tape", "Mac Studio", "Genelec Monitors"],
     "photos": ["https://images.pexels.com/photos/8197364/pexels-photo-8197364.jpeg?auto=compress&cs=tinysrgb&w=1200"],
     "description": "Estudio boutique junto al Retiro con cinta analógica y monitores Genelec."},
    {"name": "Gràcia Records", "type": "recording", "city": "Barcelona", "country": "Spain",
     "address": "Carrer de Verdi 20", "lat": 41.4036, "lng": 2.1580, "price_per_hour": 50,
     "rating": 4.7, "review_count": 92, "equipment": ["Neve 1073", "Logic Pro", "Adam Monitors"],
     "photos": ["https://images.unsplash.com/photo-1598488035139-bdbb2231ce04?crop=entropy&cs=srgb&fm=jpg&q=85&w=1200"],
     "description": "Estudio con vibra creativa en Gràcia. Preamps Neve y control acústico."},
    {"name": "Poblenou Jam Room", "type": "rehearsal", "city": "Barcelona", "country": "Spain",
     "address": "Carrer de Pujades 100", "lat": 41.4008, "lng": 2.1990, "price_per_hour": 15,
     "rating": 4.5, "review_count": 56, "equipment": ["Batería", "Amplis", "Micros", "PA"],
     "photos": ["https://images.pexels.com/photos/8197342/pexels-photo-8197342.jpeg?auto=compress&cs=tinysrgb&w=1200"],
     "description": "Sala de ensayo económica y espaciosa en Poblenou."},
    {"name": "Kreuzberg Klang", "type": "recording", "city": "Berlin", "country": "Germany",
     "address": "Oranienstraße 40", "lat": 52.5010, "lng": 13.4180, "price_per_hour": 55,
     "rating": 4.9, "review_count": 143, "equipment": ["SSL", "Modular Synths", "Ableton", "Analog Outboard"],
     "photos": ["https://images.unsplash.com/photo-1598488035139-bdbb2231ce04?crop=entropy&cs=srgb&fm=jpg&q=85&w=1200"],
     "description": "Techno & electronic focused studio in the heart of Kreuzberg."},
    {"name": "Camden Live Rooms", "type": "rehearsal", "city": "London", "country": "United Kingdom",
     "address": "Chalk Farm Rd 22", "lat": 51.5416, "lng": -0.1465, "price_per_hour": 22,
     "rating": 4.6, "review_count": 78, "equipment": ["Full Backline", "Drum Kit", "PA System"],
     "photos": ["https://images.pexels.com/photos/8197342/pexels-photo-8197342.jpeg?auto=compress&cs=tinysrgb&w=1200"],
     "description": "Iconic rehearsal rooms in Camden with full backline."},
    {"name": "Marais Analog", "type": "recording", "city": "Paris", "country": "France",
     "address": "Rue de Bretagne 15", "lat": 48.8632, "lng": 2.3620, "price_per_hour": 65,
     "rating": 4.8, "review_count": 51, "equipment": ["Vintage Neve", "Tape Machine", "Grand Piano"],
     "photos": ["https://images.pexels.com/photos/8197364/pexels-photo-8197364.jpeg?auto=compress&cs=tinysrgb&w=1200"],
     "description": "Analog paradise in Le Marais with a grand piano and tape machine."},
]


@app.on_event("startup")
async def startup():
    try:
        await db.users.create_index("email", unique=True)
        await db.users.create_index("user_id", unique=True)
        await db.user_sessions.create_index("session_token", unique=True)
        await db.user_sessions.create_index("user_id")
        await db.user_sessions.create_index("expires_at", expireAfterSeconds=0)
        await db.studios.create_index("id", unique=True)
        await db.studios.create_index("city")
        await db.bookings.create_index("id", unique=True)
        await db.reviews.create_index("id", unique=True)
        await db.reviews.create_index([("studio_id", 1), ("user_id", 1)])
    except Exception as e:
        logger.warning(f"index setup: {e}")

    try:
        await run_in_threadpool(init_storage)
    except Exception as e:
        logger.warning(f"storage init: {e}")

    # Grandfather any pre-existing studios that predate the verification field.
    try:
        await db.studios.update_many(
            {"verified": {"$exists": False}},
            {"$set": {"verified": True, "verification_status": "approved"}},
        )
    except Exception as e:
        logger.warning(f"verify migration: {e}")

    try:
        count = await db.studios.count_documents({})
        if count == 0:
            seed_owner = "user_seed_studiosync"
            await db.users.update_one(
                {"user_id": seed_owner},
                {"$setOnInsert": {
                    "user_id": seed_owner, "email": "studios@studiosync.app",
                    "name": "StudioSync", "is_owner": True, "created_at": now_utc(),
                }},
                upsert=True,
            )
            for s in SEED_STUDIOS:
                doc = dict(s)
                doc.update({
                    "id": f"studio_{uuid.uuid4().hex[:12]}",
                    "owner_id": seed_owner,
                    "owner_name": "StudioSync",
                    "currency": "EUR" if doc["country"] != "United Kingdom" else "GBP",
                    "open_hour": 8,
                    "close_hour": 24,
                    "verified": True,
                    "verification_status": "approved",
                    "description": doc.get("description", ""),
                    "created_at": now_utc().isoformat(),
                    "deleted_at": None,
                })
                await db.studios.insert_one(doc)
            logger.info("Seeded studios")
    except Exception as e:
        logger.warning(f"seed: {e}")


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
