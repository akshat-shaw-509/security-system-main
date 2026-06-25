import json
import re
import secrets
import smtplib
import time
import urllib.error
import urllib.request
from collections import defaultdict, deque
from datetime import datetime, timedelta
from email.message import EmailMessage

from fastapi import FastAPI, Depends, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .database import engine, Base, SessionLocal
from . import models
from .auth import (
    hash_secret,
    hash_password,
    verify_secret,
    verify_password,
    create_access_token,
    get_current_user
)
from .config import (
    ALLOWED_ORIGINS,
    AUTH_RATE_LIMIT_REQUESTS,
    AUTH_RATE_LIMIT_WINDOW_SECONDS,
    EXPOSE_RESET_OTP,
    RATE_LIMIT_REQUESTS,
    RATE_LIMIT_WINDOW_SECONDS,
    RESET_OTP_EXPIRE_MINUTES,
    RESET_TOKEN_EXPIRE_MINUTES,
    SMTP_FROM_EMAIL,
    SMTP_HOST,
    SMTP_PASSWORD,
    SMTP_PORT,
    SMTP_USERNAME,
    SMTP_USE_TLS,
    SMS_WEBHOOK_TOKEN,
    SMS_WEBHOOK_URL,
    TELEGRAM_BOT_TOKEN,
    TELEGRAM_CHAT_ID,
)
from .schemas import PasswordOtpVerify, PasswordResetConfirm, PasswordResetRequest, UserCreate, UserLogin
from .device_schemas import DeviceCreate, DeviceUpdate
from .device_auth_schemas import DeviceAuthRequest
from .telemetry_schemas import TelemetryCreate
from .scene_schemas import SceneCreate, SceneUpdate
from .rule_schemas import RuleCreate, RuleUpdate
from .room_schemas import RoomCreate
from .esp_schemas import EspAuthRequest, EspCommandCompleteRequest, EspModuleCreate, EspModuleUpdate
from .websocket_manager import manager
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pathlib import Path


app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
Base.metadata.create_all(bind=engine)


RATE_LIMIT_BUCKETS: dict[str, deque] = defaultdict(deque)
AUTH_PATHS = {"/login", "/register", "/password/forgot", "/password/verify-otp", "/password/reset"}
EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
PHONE_PATTERN = re.compile(r"^\+?[0-9][0-9\s\-()]{7,18}[0-9]$")
DEVICE_ONLINE_THRESHOLD_SECONDS = 75
ESTIMATED_DEVICE_WATTS = {
    "light": 12,
    "fan": 75,
    "ac": 1200,
    "tv": 110,
    "socket": 40,
    "sensor": 2,
    "camera": 8,
    "lock": 3,
}
ENERGY_RATE_PER_KWH = 8.5


def ensure_sqlite_schema() -> None:
    with engine.begin() as conn:
        user_columns = {
            row[1]
            for row in conn.execute(text("PRAGMA table_info(users)")).fetchall()
        }
        if "email" not in user_columns:
            conn.execute(text("ALTER TABLE users ADD COLUMN email VARCHAR"))
        if "phone" not in user_columns:
            conn.execute(text("ALTER TABLE users ADD COLUMN phone VARCHAR"))
        if "password_reset_otp_hash" not in user_columns:
            conn.execute(text("ALTER TABLE users ADD COLUMN password_reset_otp_hash VARCHAR"))
        if "password_reset_otp_expires_at" not in user_columns:
            conn.execute(text("ALTER TABLE users ADD COLUMN password_reset_otp_expires_at DATETIME"))
        if "password_reset_token_hash" not in user_columns:
            conn.execute(text("ALTER TABLE users ADD COLUMN password_reset_token_hash VARCHAR"))
        if "password_reset_expires_at" not in user_columns:
            conn.execute(text("ALTER TABLE users ADD COLUMN password_reset_expires_at DATETIME"))
        if "created_at" not in user_columns:
            conn.execute(text("ALTER TABLE users ADD COLUMN created_at DATETIME"))
            conn.execute(text("""
                UPDATE users
                SET created_at = COALESCE(
                    (
                        SELECT organizations.created_at
                        FROM organizations
                        WHERE organizations.id = users.organization_id
                    ),
                    CURRENT_TIMESTAMP
                )
                WHERE created_at IS NULL
            """))

        device_columns = {
            row[1]
            for row in conn.execute(text("PRAGMA table_info(devices)")).fetchall()
        }
        if "esp_module_id" not in device_columns:
            conn.execute(text("ALTER TABLE devices ADD COLUMN esp_module_id INTEGER"))

        telemetry_columns = {
            row[1]
            for row in conn.execute(text("PRAGMA table_info(device_telemetry)")).fetchall()
        }
        if "power_w" not in telemetry_columns:
            conn.execute(text("ALTER TABLE device_telemetry ADD COLUMN power_w VARCHAR DEFAULT '0'"))
        if "energy_wh" not in telemetry_columns:
            conn.execute(text("ALTER TABLE device_telemetry ADD COLUMN energy_wh VARCHAR DEFAULT '0'"))


ensure_sqlite_schema()


@app.middleware("http")
async def rate_limit_requests(request: Request, call_next):
    if request.url.path.startswith("/assets"):
        return await call_next(request)

    client = request.client.host if request.client else "unknown"
    is_auth_path = request.url.path in AUTH_PATHS
    limit = AUTH_RATE_LIMIT_REQUESTS if is_auth_path else RATE_LIMIT_REQUESTS
    window = AUTH_RATE_LIMIT_WINDOW_SECONDS if is_auth_path else RATE_LIMIT_WINDOW_SECONDS
    bucket_key = f"{client}:{request.url.path if is_auth_path else 'global'}"
    bucket = RATE_LIMIT_BUCKETS[bucket_key]
    now = time.time()

    while bucket and bucket[0] <= now - window:
        bucket.popleft()

    if len(bucket) >= limit:
        return JSONResponse(
            status_code=429,
            content={"detail": "Too many requests. Please wait and try again."},
        )

    bucket.append(now)
    return await call_next(request)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def record_event(
    db: Session,
    event_type: str,
    organization_id: int | None = None,
    message: str | None = None,
    payload: dict | None = None,
) -> models.AppEvent:
    event = models.AppEvent(
        organization_id=organization_id,
        event_type=event_type,
        message=message,
        payload=json.dumps(payload or {}),
    )
    db.add(event)
    return event


def serialize_event(event: models.AppEvent) -> dict:
    try:
        payload = json.loads(event.payload or "{}")
    except json.JSONDecodeError:
        payload = {}

    return {
        "event_id": event.id,
        "event": event.event_type,
        "message": event.message,
        "payload": payload,
        "created_at": event.created_at,
    }


def schema_updates(schema) -> dict:
    if hasattr(schema, "model_dump"):
        return schema.model_dump(exclude_unset=True)
    return schema.dict(exclude_unset=True)


def serialize_telemetry(entry: models.DeviceTelemetry) -> dict:
    return {
        "id": entry.id,
        "device_id": entry.device_id,
        "organization_id": entry.organization_id,
        "temperature": entry.temperature,
        "humidity": entry.humidity,
        "motion_detected": entry.motion_detected,
        "power_w": entry.power_w or "0",
        "energy_wh": entry.energy_wh or "0",
        "created_at": entry.created_at,
    }


def estimated_device_watts(device: models.Device) -> float:
    device_type = (device.device_type or "other").lower()
    watts = ESTIMATED_DEVICE_WATTS.get(device_type, 25)
    state = str(device.current_state or "").upper()
    if device_type == "sensor":
        return watts if state == "ACTIVE" else 0
    return watts if state == "ON" else 0


def telemetry_power_w(entry: models.DeviceTelemetry) -> float:
    try:
        return max(float(entry.power_w or 0), 0)
    except (TypeError, ValueError):
        return 0


def validate_password_strength(password: str) -> None:
    if len(password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    if not any(char.isalpha() for char in password) or not any(char.isdigit() for char in password):
        raise HTTPException(status_code=400, detail="Password must include letters and numbers")


def normalize_email(email: str) -> str:
    normalized = email.strip().lower()
    if not EMAIL_PATTERN.match(normalized):
        raise HTTPException(status_code=400, detail="Enter a valid email address")
    return normalized


def normalize_phone(phone: str) -> str:
    value = phone.strip()
    if not PHONE_PATTERN.match(value):
        raise HTTPException(status_code=400, detail="Enter a valid phone number")
    if value.startswith("+"):
        return "+" + re.sub(r"\D", "", value)
    return re.sub(r"\D", "", value)


def send_phone_alert(phone: str, message: str, payload: dict | None = None) -> bool:
    if not phone:
        return False

    body = {
        "to": phone,
        "message": message,
        "payload": payload or {},
    }

    if not SMS_WEBHOOK_URL:
        print(f"Phone alert for {phone}: {message}")
        return False

    data = json.dumps(body).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if SMS_WEBHOOK_TOKEN:
        headers["Authorization"] = f"Bearer {SMS_WEBHOOK_TOKEN}"

    request = urllib.request.Request(
        SMS_WEBHOOK_URL,
        data=data,
        headers=headers,
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            return 200 <= response.status < 300
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        print(f"Phone alert failed for {phone}: {exc}")
        return False


def send_telegram_alert(message: str, payload: dict | None = None) -> bool:
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        print(f"Telegram alert: {message}")
        return False

    details = ""
    if payload:
        visible_payload = {
            key: value
            for key, value in payload.items()
            if value is not None and key not in {"phone_alerts", "telegram_alert"}
        }
        if visible_payload:
            details = "\n\nDetails:\n" + "\n".join(
                f"{key}: {value}" for key, value in visible_payload.items()
            )

    data = json.dumps({
        "chat_id": TELEGRAM_CHAT_ID,
        "text": f"{message}{details}",
    }).encode("utf-8")
    request = urllib.request.Request(
        f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            return 200 <= response.status < 300
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        print(f"Telegram alert failed: {exc}")
        return False


def notify_organization_phone_alert(
    db: Session,
    organization_id: int,
    message: str,
    payload: dict | None = None,
) -> list[dict]:
    users = db.query(models.User).filter(
        models.User.organization_id == organization_id,
        models.User.phone.isnot(None),
    ).all()

    results = []
    for user in users:
        if not user.phone:
            continue
        delivered = send_phone_alert(user.phone, message, payload)
        results.append({
            "user_id": user.id,
            "phone": user.phone,
            "delivered": delivered,
        })

    return results


def device_presence(device: models.Device, now: datetime | None = None) -> dict:
    now = now or datetime.utcnow()
    seconds_since_seen = (now - device.last_seen).total_seconds() if device.last_seen else None
    is_active_sensor = (
        device.is_active
        and device.device_type == "sensor"
        and str(device.current_state).upper() == "ACTIVE"
    )
    is_powered_on = str(device.current_state).upper() == "ON"
    is_online = device.is_active and (is_active_sensor or is_powered_on)
    age = None if seconds_since_seen is None else max(0, int(seconds_since_seen))

    if is_active_sensor:
        label = "Monitoring"
    elif not device.is_active:
        label = "Inactive"
    elif not is_powered_on:
        label = "Offline"
    elif age is None:
        label = "Online"
    elif age < 10:
        label = "Live now"
    elif age < DEVICE_ONLINE_THRESHOLD_SECONDS:
        label = f"Seen {age}s ago"
    else:
        label = "Online"

    return {
        "is_online": is_online,
        "last_seen": device.last_seen,
        "presence_age_seconds": age,
        "presence_label": label,
    }


def send_password_reset_otp(email: str, otp: str) -> bool:
    if not SMTP_HOST or not SMTP_FROM_EMAIL:
        print(f"Password reset OTP for {email}: {otp}")
        return False

    message = EmailMessage()
    message["Subject"] = "Your Smart Home password reset OTP"
    message["From"] = SMTP_FROM_EMAIL
    message["To"] = email
    message.set_content(
        f"Your Smart Home password reset OTP is {otp}. "
        f"It expires in {RESET_OTP_EXPIRE_MINUTES} minutes."
    )

    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=10) as smtp:
            if SMTP_USE_TLS:
                smtp.starttls()
            if SMTP_USERNAME:
                smtp.login(SMTP_USERNAME, SMTP_PASSWORD)
            smtp.send_message(message)
    except Exception as exc:
        print(f"Password reset OTP email failed for {email}: {exc}")
        return False

    return True


def verify_device_token(device: models.Device, provided_token: str, db: Session) -> bool:
    if verify_secret(provided_token, device.device_token):
        if not device.device_token.startswith("$2"):
            device.device_token = hash_secret(provided_token)
            db.flush()
        return True
    return False


def verify_esp_token(esp_module: models.EspModule, provided_token: str, db: Session) -> bool:
    if verify_secret(provided_token, esp_module.esp_token):
        if not esp_module.esp_token.startswith("$2"):
            esp_module.esp_token = hash_secret(provided_token)
            db.flush()
        return True
    return False


def authenticate_esp_module(esp_data: EspAuthRequest, db: Session) -> models.EspModule:
    esp_module = db.query(models.EspModule).filter(
        models.EspModule.esp_uid == esp_data.esp_uid
    ).first()

    if not esp_module or not verify_esp_token(esp_module, esp_data.esp_token, db):
        raise HTTPException(status_code=401, detail="Invalid ESP credentials")

    if not esp_module.is_active:
        raise HTTPException(status_code=403, detail="ESP module is inactive")

    esp_module.last_seen = datetime.utcnow()
    return esp_module


def serialize_esp_module(esp_module: models.EspModule) -> dict:
    return {
        "esp_id": esp_module.id,
        "esp_name": esp_module.name,
        "location": esp_module.location,
        "esp_uid": esp_module.esp_uid,
        "is_active": esp_module.is_active,
        "last_seen": esp_module.last_seen,
        "created_at": esp_module.created_at,
    }


def serialize_child_device(device: models.Device) -> dict:
    return {
        "device_id": device.id,
        "device_name": device.name,
        "device_type": device.device_type,
        "room": device.room,
        "state": device.current_state,
        "device_uid": device.device_uid,
        "is_active": device.is_active,
        "last_seen": device.last_seen,
    }


@app.get("/")
def root():
    return {"message": "Home Server Secure Backend Running"}


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/register")
def register(user: UserCreate, db: Session = Depends(get_db)):
    validate_password_strength(user.password)
    email = normalize_email(user.email)
    phone = normalize_phone(user.phone)
    existing_user = db.query(models.User).filter(
        models.User.username == user.username
    ).first()

    if existing_user:
        raise HTTPException(status_code=400, detail="Username already exists")

    existing_email = db.query(models.User).filter(models.User.email == email).first()
    if existing_email:
        raise HTTPException(status_code=400, detail="Email already exists")

    existing_phone = db.query(models.User).filter(models.User.phone == phone).first()
    if existing_phone:
        raise HTTPException(status_code=400, detail="Phone number already exists")

    try:
        org = models.Organization(name=f"{user.username}_org")
        db.add(org)
        db.flush()

        new_user = models.User(
            username=user.username,
            email=email,
            phone=phone,
            hashed_password=hash_password(user.password),
            is_admin=True,
            created_at=datetime.utcnow(),
            organization_id=org.id,
        )
        db.add(new_user)
        db.commit()
        db.refresh(new_user)
        record_event(
            db,
            "user_registered",
            new_user.organization_id,
            f"{new_user.username} registered",
            {
                "user_id": new_user.id,
                "username": new_user.username,
                "email": new_user.email,
                "phone": new_user.phone,
            },
        )
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Username or organization already exists")
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Registration failed: {exc}")

    return {"message": "Organization and admin user created"}


def _authenticate_user(identifier: str, password: str, db: Session) -> models.User:
    normalized_email = identifier.strip().lower()
    normalized_phone = re.sub(r"\D", "", identifier.strip())
    db_user = db.query(models.User).filter(
        (models.User.username == identifier)
        | (models.User.email == normalized_email)
        | (models.User.phone == normalized_phone)
        | (models.User.phone == f"+{normalized_phone}")
    ).first()

    if not db_user:
        raise HTTPException(status_code=400, detail="Invalid username or email")

    if not verify_password(password, db_user.hashed_password):
        raise HTTPException(status_code=400, detail="Invalid password")

    return db_user


@app.post("/login")
def login(user: UserLogin, db: Session = Depends(get_db)):
    try:
        db_user = _authenticate_user(user.username, user.password, db)
    except HTTPException:
        normalized_email = user.username.strip().lower()
        normalized_phone = re.sub(r"\D", "", user.username.strip())
        candidate = db.query(models.User).filter(
            (models.User.username == user.username)
            | (models.User.email == normalized_email)
            | (models.User.phone == normalized_phone)
            | (models.User.phone == f"+{normalized_phone}")
        ).first()
        alert_result = []
        if candidate and candidate.phone:
            alert_result = [{
                "user_id": candidate.id,
                "phone": candidate.phone,
                "delivered": send_phone_alert(
                    candidate.phone,
                    f"Security alert: failed login attempt for {candidate.username}.",
                    {"event": "failed_login", "identifier": user.username},
                ),
            }]
        telegram_alert = send_telegram_alert(
            f"Security alert: failed login attempt for {user.username}.",
            {"event": "failed_login", "identifier": user.username},
        )
        record_event(
            db,
            "failed_login",
            candidate.organization_id if candidate else None,
            f"Failed login for {user.username}",
            {
                "identifier": user.username,
                "phone_alerts": alert_result,
                "telegram_alert": telegram_alert,
            },
        )
        db.commit()
        raise
    if user.phone:
        phone = normalize_phone(user.phone)
        existing_phone = db.query(models.User).filter(
            models.User.phone == phone,
            models.User.id != db_user.id,
        ).first()
        if existing_phone:
            raise HTTPException(status_code=400, detail="Phone number already exists")
        db_user.phone = phone
    record_event(
        db,
        "user_login",
        db_user.organization_id,
        f"{db_user.username} signed in",
        {"user_id": db_user.id, "username": db_user.username},
    )
    db.commit()
    access_token = create_access_token({"sub": db_user.username})
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": {
            "username": db_user.username,
            "email": db_user.email,
            "phone": db_user.phone,
            "organization_id": db_user.organization_id,
            "created_at": db_user.created_at,
        },
    }


@app.post("/password/forgot")
def forgot_password(request: PasswordResetRequest, db: Session = Depends(get_db)):
    email = normalize_email(request.email)
    user = db.query(models.User).filter(models.User.email == email).first()
    response = {"message": "If the account exists, an OTP was sent."}

    if not user:
        record_event(
            db,
            "password_reset_requested_unknown",
            None,
            f"Password reset requested for unknown email {email}",
            {"email": email},
        )
        db.commit()
        return response

    otp = f"{secrets.randbelow(1000000):06d}"
    delivered = send_password_reset_otp(email, otp)
    if not delivered and not EXPOSE_RESET_OTP:
        record_event(
            db,
            "password_reset_email_failed",
            user.organization_id,
            f"Password reset OTP email failed for {user.email}",
            {"user_id": user.id, "username": user.username, "email": user.email},
        )
        db.commit()
        raise HTTPException(
            status_code=503,
            detail="OTP email could not be sent. Check SMTP settings in .env.",
        )

    user.password_reset_otp_hash = hash_secret(otp)
    user.password_reset_otp_expires_at = datetime.utcnow() + timedelta(minutes=RESET_OTP_EXPIRE_MINUTES)
    user.password_reset_token_hash = None
    user.password_reset_expires_at = None
    record_event(
        db,
        "password_reset_requested",
        user.organization_id,
        f"Password reset OTP requested for {user.email}",
        {"user_id": user.id, "username": user.username, "email": user.email, "delivered": delivered},
    )
    db.commit()

    if EXPOSE_RESET_OTP and not delivered:
        response["otp"] = otp

    return response


@app.post("/password/verify-otp")
def verify_password_otp(otp_data: PasswordOtpVerify, db: Session = Depends(get_db)):
    email = normalize_email(otp_data.email)
    user = db.query(models.User).filter(models.User.email == email).first()

    if (
        not user
        or not user.password_reset_otp_hash
        or not user.password_reset_otp_expires_at
        or user.password_reset_otp_expires_at < datetime.utcnow()
        or not verify_secret(otp_data.otp, user.password_reset_otp_hash)
    ):
        record_event(
            db,
            "password_otp_failed",
            user.organization_id if user else None,
            f"Password reset OTP failed for {email}",
            {"email": email},
        )
        db.commit()
        raise HTTPException(status_code=400, detail="Invalid or expired OTP")

    reset_token = secrets.token_urlsafe(32)
    user.password_reset_otp_hash = None
    user.password_reset_otp_expires_at = None
    user.password_reset_token_hash = hash_secret(reset_token)
    user.password_reset_expires_at = datetime.utcnow() + timedelta(minutes=RESET_TOKEN_EXPIRE_MINUTES)
    record_event(
        db,
        "password_otp_verified",
        user.organization_id,
        f"Password reset OTP verified for {user.email}",
        {"user_id": user.id, "username": user.username, "email": user.email},
    )
    db.commit()

    return {"message": "OTP verified", "reset_token": reset_token}


@app.post("/password/reset")
def reset_password(reset: PasswordResetConfirm, db: Session = Depends(get_db)):
    if reset.new_password != reset.confirm_password:
        raise HTTPException(status_code=400, detail="Passwords do not match")
    validate_password_strength(reset.new_password)
    email = normalize_email(reset.email)
    user = db.query(models.User).filter(models.User.email == email).first()

    if (
        not user
        or not user.password_reset_token_hash
        or not user.password_reset_expires_at
        or user.password_reset_expires_at < datetime.utcnow()
        or not verify_secret(reset.reset_token, user.password_reset_token_hash)
    ):
        record_event(
            db,
            "password_reset_failed",
            user.organization_id if user else None,
            f"Password reset failed for {email}",
            {"email": email},
        )
        db.commit()
        raise HTTPException(status_code=400, detail="Invalid or expired reset token")

    user.hashed_password = hash_password(reset.new_password)
    user.password_reset_token_hash = None
    user.password_reset_expires_at = None
    record_event(
        db,
        "password_reset_completed",
        user.organization_id,
        f"Password reset completed for {user.email}",
        {"user_id": user.id, "username": user.username, "email": user.email},
    )
    db.commit()

    return {"message": "Password reset complete"}


@app.get("/protected")
def protected_route(current_user: models.User = Depends(get_current_user)):
    return {
        "message": "Access granted",
        "user": current_user.username,
        "email": current_user.email,
        "phone": current_user.phone,
        "organization_id": current_user.organization_id,
        "created_at": current_user.created_at,
    }


@app.get("/events")
def list_events(
    limit: int = 100,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    cutoff = datetime.utcnow().timestamp() - (72 * 60 * 60)
    cutoff_dt = datetime.utcfromtimestamp(cutoff)
    db.query(models.AppEvent).filter(
        models.AppEvent.organization_id == current_user.organization_id,
        models.AppEvent.created_at < cutoff_dt,
    ).delete(synchronize_session=False)
    db.commit()

    events = db.query(models.AppEvent).filter(
        models.AppEvent.organization_id == current_user.organization_id
    ).order_by(
        models.AppEvent.created_at.desc()
    ).limit(min(limit, 200)).all()

    return [serialize_event(event) for event in events]


@app.post("/alerts/telegram/test")
def test_telegram_alert(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    delivered = send_telegram_alert(
        f"Smart Home test alert for {current_user.username}.",
        {
            "event": "telegram_test",
            "username": current_user.username,
            "organization_id": current_user.organization_id,
        },
    )
    record_event(
        db,
        "telegram_test",
        current_user.organization_id,
        "Telegram test alert sent" if delivered else "Telegram test alert failed",
        {"telegram_alert": delivered},
    )
    db.commit()

    if not delivered:
        raise HTTPException(
            status_code=503,
            detail="Telegram alert failed. Check bot token, chat ID, and internet access.",
        )

    return {"message": "Telegram test alert sent"}


@app.delete("/events")
def clear_events(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    db.query(models.AppEvent).filter(
        models.AppEvent.organization_id == current_user.organization_id
    ).delete(synchronize_session=False)
    db.commit()
    return {"message": "Events cleared"}


@app.post("/esp/register")
def register_esp_module(
    esp: EspModuleCreate,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    esp_uid = secrets.token_hex(8)
    esp_token = secrets.token_hex(32)

    esp_module = models.EspModule(
        name=esp.name,
        location=esp.location,
        esp_uid=esp_uid,
        esp_token=hash_secret(esp_token),
        owner_id=current_user.id,
        organization_id=current_user.organization_id,
    )
    db.add(esp_module)
    db.flush()
    record_event(
        db,
        "esp_registered",
        current_user.organization_id,
        f"{esp_module.name} ESP module registered",
        {"esp_id": esp_module.id, "esp_uid": esp_module.esp_uid, "location": esp_module.location},
    )
    db.commit()
    db.refresh(esp_module)

    return {
        **serialize_esp_module(esp_module),
        "esp_token": esp_token,
    }


@app.get("/esp/modules")
def list_esp_modules(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    modules = db.query(models.EspModule).filter(
        models.EspModule.organization_id == current_user.organization_id
    ).all()

    return [
        {
            **serialize_esp_module(module),
            "device_count": len(module.devices),
        }
        for module in modules
    ]


@app.patch("/esp/modules/{esp_id}")
def update_esp_module(
    esp_id: int,
    updates: EspModuleUpdate,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    esp_module = db.query(models.EspModule).filter(
        models.EspModule.id == esp_id,
        models.EspModule.organization_id == current_user.organization_id,
    ).first()

    if not esp_module:
        raise HTTPException(status_code=404, detail="ESP module not found")

    update_data = schema_updates(updates)
    for field, value in update_data.items():
        if field == "name":
            esp_module.name = value
        elif field == "location":
            esp_module.location = value
        elif field == "is_active":
            esp_module.is_active = value

    record_event(
        db,
        "esp_updated",
        current_user.organization_id,
        f"{esp_module.name} ESP module updated",
        {"esp_id": esp_module.id, "changes": update_data},
    )
    db.commit()
    db.refresh(esp_module)

    return serialize_esp_module(esp_module)


@app.post("/esp/modules/{esp_id}/devices/register")
async def register_esp_child_device(
    esp_id: int,
    device: DeviceCreate,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    esp_module = db.query(models.EspModule).filter(
        models.EspModule.id == esp_id,
        models.EspModule.organization_id == current_user.organization_id,
    ).first()

    if not esp_module:
        raise HTTPException(status_code=404, detail="ESP module not found")

    device_uid = secrets.token_hex(8)
    device_token = secrets.token_hex(32)
    new_device = models.Device(
        name=device.name,
        device_type=device.device_type,
        room=device.room,
        device_uid=device_uid,
        device_token=hash_secret(device_token),
        owner_id=current_user.id,
        organization_id=current_user.organization_id,
        esp_module_id=esp_module.id,
    )

    db.add(new_device)
    db.flush()
    record_event(
        db,
        "esp_child_device_registered",
        current_user.organization_id,
        f"{new_device.name} registered under {esp_module.name}",
        {
            "esp_id": esp_module.id,
            "esp_uid": esp_module.esp_uid,
            "device_id": new_device.id,
            "device_name": new_device.name,
        },
    )
    db.commit()
    db.refresh(new_device)

    await manager.broadcast({
        "event": "device_registered",
        "device_id": new_device.id,
        "device_name": new_device.name,
        "device_type": new_device.device_type,
        "room": new_device.room,
        "esp_id": esp_module.id,
        "esp_uid": esp_module.esp_uid,
        "organization_id": new_device.organization_id,
    })

    return {
        "device_id": new_device.id,
        "device_uid": new_device.device_uid,
        "device_token": device_token,
        "esp_uid": esp_module.esp_uid,
    }


@app.post("/esp/auth")
def authenticate_esp(esp_data: EspAuthRequest, db: Session = Depends(get_db)):
    esp_module = authenticate_esp_module(esp_data, db)
    db.commit()

    return {
        "message": "ESP module authenticated",
        **serialize_esp_module(esp_module),
        "devices": [serialize_child_device(device) for device in esp_module.devices],
    }


@app.post("/esp/devices")
def list_esp_child_devices(esp_data: EspAuthRequest, db: Session = Depends(get_db)):
    esp_module = authenticate_esp_module(esp_data, db)
    db.commit()

    return {
        "esp": serialize_esp_module(esp_module),
        "devices": [serialize_child_device(device) for device in esp_module.devices],
    }


@app.post("/esp/devices/tokens")
def provision_esp_child_device_tokens(esp_data: EspAuthRequest, db: Session = Depends(get_db)):
    esp_module = authenticate_esp_module(esp_data, db)
    devices = db.query(models.Device).filter(
        models.Device.esp_module_id == esp_module.id,
        models.Device.organization_id == esp_module.organization_id,
    ).all()

    provisioned_devices = []
    for device in devices:
        device_token = secrets.token_hex(32)
        device.device_token = hash_secret(device_token)
        provisioned_devices.append({
            **serialize_child_device(device),
            "device_token": device_token,
        })

    record_event(
        db,
        "esp_child_device_tokens_issued",
        esp_module.organization_id,
        f"Device tokens issued to {esp_module.name}",
        {
            "esp_id": esp_module.id,
            "esp_uid": esp_module.esp_uid,
            "device_ids": [device["device_id"] for device in provisioned_devices],
        },
    )
    db.commit()

    return {
        "message": "Device tokens provisioned",
        "esp": serialize_esp_module(esp_module),
        "devices": provisioned_devices,
    }


@app.post("/esp/commands")
async def fetch_esp_commands(esp_data: EspAuthRequest, db: Session = Depends(get_db)):
    esp_module = authenticate_esp_module(esp_data, db)
    commands = db.query(models.DeviceCommand).join(models.Device).filter(
        models.Device.esp_module_id == esp_module.id,
        models.DeviceCommand.status == "pending",
    ).all()

    result = []
    for cmd in commands:
        cmd.status = "delivered"
        result.append({
            "command_id": cmd.id,
            "device_id": cmd.device_id,
            "device_uid": cmd.device.device_uid,
            "device_name": cmd.device.name,
            "command_type": cmd.command_type,
            "payload": cmd.payload,
        })

    db.commit()

    if result:
        record_event(
            db,
            "esp_commands_delivered",
            esp_module.organization_id,
            f"{len(result)} command(s) delivered to {esp_module.name}",
            {"esp_id": esp_module.id, "esp_uid": esp_module.esp_uid, "commands": result},
        )
        db.commit()
        await manager.broadcast({
            "event": "esp_commands_delivered",
            "esp_id": esp_module.id,
            "esp_uid": esp_module.esp_uid,
            "commands": result,
        })

    return result


@app.post("/esp/commands/{command_id}/complete")
async def complete_esp_command(
    command_id: int,
    esp_data: EspCommandCompleteRequest,
    db: Session = Depends(get_db)
):
    esp_module = authenticate_esp_module(esp_data, db)
    command = db.query(models.DeviceCommand).join(models.Device).filter(
        models.DeviceCommand.id == command_id,
        models.Device.esp_module_id == esp_module.id,
    ).first()

    if not command:
        raise HTTPException(status_code=404, detail="Command not found")

    if esp_data.device_uid and command.device.device_uid != esp_data.device_uid:
        raise HTTPException(status_code=400, detail="Command does not belong to this device")

    command.status = "executed"
    command.executed_at = datetime.utcnow()

    if command.command_type == "TURN_ON":
        command.device.current_state = "ON"
    elif command.command_type == "TURN_OFF":
        command.device.current_state = "OFF"
    command.device.last_seen = datetime.utcnow()

    record_event(
        db,
        "esp_command_completed",
        esp_module.organization_id,
        f"{command.command_type} completed by {esp_module.name} for {command.device.name}",
        {
            "esp_id": esp_module.id,
            "esp_uid": esp_module.esp_uid,
            "command_id": command.id,
            "device_id": command.device_id,
            "device_uid": command.device.device_uid,
        },
    )
    db.commit()

    await manager.broadcast({
        "event": "command_completed",
        "command_id": command.id,
        "device_id": command.device_id,
        "device_name": command.device.name,
        "state": command.device.current_state,
        "executed_at": command.executed_at,
    })

    return {"message": "Command completed"}


@app.post("/devices/register")
async def register_device(
    device: DeviceCreate,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    device_uid = secrets.token_hex(8)
    device_token = secrets.token_hex(32)
    esp_module = None

    if device.esp_uid:
        esp_module = db.query(models.EspModule).filter(
            models.EspModule.esp_uid == device.esp_uid,
            models.EspModule.organization_id == current_user.organization_id,
        ).first()
        if not esp_module:
            raise HTTPException(status_code=404, detail="ESP module not found")

    new_device = models.Device(
        name=device.name,
        device_type=device.device_type,
        room=device.room,
        device_uid=device_uid,
        device_token=hash_secret(device_token),
        owner_id=current_user.id,
        organization_id=current_user.organization_id,
        esp_module_id=esp_module.id if esp_module else None,
    )

    db.add(new_device)
    db.flush()
    record_event(
        db,
        "device_registered",
        current_user.organization_id,
        f"{new_device.name} registered",
        {
            "device_id": new_device.id,
            "device_name": new_device.name,
            "room": new_device.room,
            "esp_id": esp_module.id if esp_module else None,
            "esp_uid": esp_module.esp_uid if esp_module else None,
        },
    )
    db.commit()
    db.refresh(new_device)

    await manager.broadcast({
        "event": "device_registered",
        "device_id": new_device.id,
        "device_name": new_device.name,
        "device_type": new_device.device_type,
        "room": new_device.room,
        "esp_id": esp_module.id if esp_module else None,
        "esp_uid": esp_module.esp_uid if esp_module else None,
        "organization_id": new_device.organization_id
    })

    return {
        "device_id": new_device.id,
        "device_uid": new_device.device_uid,
        "device_token": device_token,
        "esp_uid": esp_module.esp_uid if esp_module else None,
    }


@app.patch("/devices/{device_id}")
async def update_device(
    device_id: int,
    updates: DeviceUpdate,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    device = db.query(models.Device).filter(
        models.Device.id == device_id,
        models.Device.organization_id == current_user.organization_id
    ).first()

    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    update_data = schema_updates(updates)
    for field, value in update_data.items():
        if field == "name":
            device.name = value
        elif field == "device_type":
            device.device_type = value
        elif field == "room":
            device.room = value
        elif field == "is_active":
            device.is_active = value
        elif field == "esp_uid":
            if value in (None, ""):
                device.esp_module_id = None
            else:
                esp_module = db.query(models.EspModule).filter(
                    models.EspModule.esp_uid == value,
                    models.EspModule.organization_id == current_user.organization_id,
                ).first()
                if not esp_module:
                    raise HTTPException(status_code=404, detail="ESP module not found")
                device.esp_module_id = esp_module.id

    record_event(
        db,
        "device_updated",
        current_user.organization_id,
        f"{device.name} updated",
        {"device_id": device.id, "changes": update_data},
    )
    db.commit()

    await manager.broadcast({
        "event": "device_updated",
        "device_id": device.id,
        "device_name": device.name,
        "changes": update_data,
    })

    return {"message": "Device updated"}


@app.delete("/devices/{device_id}")
async def delete_device(
    device_id: int,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    device = db.query(models.Device).filter(
        models.Device.id == device_id,
        models.Device.organization_id == current_user.organization_id
    ).first()

    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    device_name = device.name

    db.query(models.DeviceTelemetry).filter(models.DeviceTelemetry.device_id == device.id).delete()
    db.query(models.DeviceCommand).filter(models.DeviceCommand.device_id == device.id).delete()
    db.query(models.AutomationRuleActivity).filter(
        (models.AutomationRuleActivity.sensor_device_id == device.id) |
        (models.AutomationRuleActivity.action_device_id == device.id)
    ).delete(synchronize_session=False)
    db.query(models.AutomationRule).filter(
        (models.AutomationRule.device_id == device.id) |
        (models.AutomationRule.action_device_id == device.id)
    ).delete(synchronize_session=False)
    db.query(models.SceneAction).filter(models.SceneAction.device_id == device.id).delete()
    db.delete(device)
    record_event(
        db,
        "device_deleted",
        current_user.organization_id,
        f"{device_name} deleted",
        {"device_id": device_id, "device_name": device_name},
    )
    db.commit()

    await manager.broadcast({
        "event": "device_deleted",
        "device_id": device_id,
        "device_name": device_name,
    })

    return {"message": "Device deleted"}


@app.post("/devices/auth")
def authenticate_device(device_data: DeviceAuthRequest, db: Session = Depends(get_db)):
    device = db.query(models.Device).filter(
        models.Device.device_uid == device_data.device_uid
    ).first()

    if not device:
        raise HTTPException(status_code=401, detail="Invalid device UID")

    if not verify_device_token(device, device_data.device_token, db):
        record_event(
            db,
            "device_auth_failed",
            device.organization_id,
            f"Invalid token for {device.name}",
            {"device_id": device.id, "device_uid": device.device_uid},
        )
        db.commit()
        raise HTTPException(status_code=401, detail="Invalid device token")

    if not device.is_active:
        raise HTTPException(status_code=403, detail="Device is inactive")

    db.commit()
    return {
        "message": "Device authenticated",
        "device_id": device.id,
        "device_name": device.name
    }


@app.post("/devices/heartbeat")
async def device_heartbeat(
    telemetry: TelemetryCreate,
    db: Session = Depends(get_db)
):
    device = db.query(models.Device).filter(
        models.Device.device_uid == telemetry.device_uid
    ).first()

    if not device or not verify_device_token(device, telemetry.device_token, db):
        raise HTTPException(status_code=401, detail="Invalid device credentials")

    device.last_seen = datetime.utcnow()
    db.commit()

    await manager.broadcast({
        "event": "heartbeat",
        "device_id": device.id,
        "device_name": device.name,
        "last_seen": device.last_seen
    })

    return {"message": "Heartbeat received"}


@app.post("/devices/telemetry")
async def device_telemetry(
    telemetry: TelemetryCreate,
    db: Session = Depends(get_db)
):
    device = db.query(models.Device).filter(
        models.Device.device_uid == telemetry.device_uid
    ).first()

    if not device or not verify_device_token(device, telemetry.device_token, db):
        raise HTTPException(status_code=401, detail="Invalid device credentials")

    new_entry = models.DeviceTelemetry(
        device_id=device.id,
        organization_id=device.organization_id,
        temperature=str(telemetry.temperature),
        humidity=str(telemetry.humidity),
        motion_detected=telemetry.motion_detected,
        power_w=str(telemetry.power_w),
        energy_wh=str(telemetry.energy_wh),
    )

    device.last_seen = datetime.utcnow()
    db.add(new_entry)

    triggered_rules = []

    rules = db.query(models.AutomationRule).filter(
        models.AutomationRule.device_id == device.id,
        models.AutomationRule.organization_id == device.organization_id,
        models.AutomationRule.is_active == True
    ).all()

    for rule in rules:
        trigger = False
        observed_value = None

        if rule.condition_type == "motion":
            observed_value = str(telemetry.motion_detected)
            if telemetry.motion_detected:
                trigger = True

        elif rule.condition_type == "temperature":
            observed_value = str(telemetry.temperature)

            if rule.value:
                if rule.operator == ">" and telemetry.temperature > float(rule.value):
                    trigger = True
                elif rule.operator == "<" and telemetry.temperature < float(rule.value):
                    trigger = True
                elif rule.operator == "=" and telemetry.temperature == float(rule.value):
                    trigger = True

        elif rule.condition_type == "humidity":
            observed_value = str(telemetry.humidity)

            if rule.value:
                if rule.operator == ">" and telemetry.humidity > float(rule.value):
                    trigger = True
                elif rule.operator == "<" and telemetry.humidity < float(rule.value):
                    trigger = True
                elif rule.operator == "=" and telemetry.humidity == float(rule.value):
                    trigger = True

        if not trigger:
            continue

        existing_command = db.query(models.DeviceCommand).filter(
            models.DeviceCommand.device_id == rule.action_device_id,
            models.DeviceCommand.command_type == rule.action_command,
            models.DeviceCommand.status.in_(["pending", "delivered"])
        ).first()

        if existing_command:
            continue

        command = models.DeviceCommand(
            device_id=rule.action_device_id,
            organization_id=device.organization_id,
            command_type=rule.action_command
        )

        db.add(command)
        db.flush()

        activity = models.AutomationRuleActivity(
            rule_id=rule.id,
            organization_id=device.organization_id,
            sensor_device_id=device.id,
            action_device_id=rule.action_device_id,
            command_id=command.id,
            trigger_type=rule.condition_type,
            observed_value=observed_value,
            action_command=rule.action_command
        )

        db.add(activity)

        triggered_rules.append({
            "rule_id": rule.id,
            "rule_name": rule.name,
            "command_id": command.id,
            "action_device_id": rule.action_device_id,
            "action_command": rule.action_command
        })

    db.commit()

    record_event(
        db,
        "telemetry_received",
        device.organization_id,
        f"Telemetry received from {device.name}",
        {
            "device_id": device.id,
            "device_name": device.name,
            "temperature": telemetry.temperature,
            "humidity": telemetry.humidity,
            "motion_detected": telemetry.motion_detected,
            "power_w": telemetry.power_w,
            "energy_wh": telemetry.energy_wh,
        },
    )
    for item in triggered_rules:
        record_event(
            db,
            "rule_triggered",
            device.organization_id,
            f"{item['rule_name']} triggered",
            item,
        )
    phone_alerts = []
    if telemetry.motion_detected:
        alert_payload = {
            "event": "motion_detected",
            "device_id": device.id,
            "device_name": device.name,
            "room": device.room,
            "temperature": telemetry.temperature,
            "humidity": telemetry.humidity,
        }
        phone_alerts = notify_organization_phone_alert(
            db,
            device.organization_id,
            f"Security alert: motion detected by {device.name}"
            f"{f' in {device.room}' if device.room else ''}.",
            alert_payload,
        )
        telegram_alert = send_telegram_alert(
            f"Security alert: motion detected by {device.name}"
            f"{f' in {device.room}' if device.room else ''}.",
            alert_payload,
        )
        record_event(
            db,
            "security_alert",
            device.organization_id,
            f"Motion detected by {device.name}",
            {
                **alert_payload,
                "phone_alerts": phone_alerts,
                "telegram_alert": telegram_alert,
            },
        )
    db.commit()

    await manager.broadcast({
        "event": "telemetry",
        "device_id": device.id,
        "device_name": device.name,
        "temperature": telemetry.temperature,
        "humidity": telemetry.humidity,
        "motion_detected": telemetry.motion_detected,
        "power_w": telemetry.power_w,
        "energy_wh": telemetry.energy_wh,
        "phone_alerts": phone_alerts,
        "telegram_alert": telegram_alert if telemetry.motion_detected else False,
    })

    for item in triggered_rules:
        await manager.broadcast({
            "event": "rule_triggered",
            **item
        })

    return {
        "message": "Telemetry stored",
        "triggered_rules": triggered_rules
    }


@app.get("/devices")
def list_devices(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    devices = db.query(models.Device).filter(
        models.Device.organization_id == current_user.organization_id
    ).all()

    now = datetime.utcnow()
    result = []

    for device in devices:
        result.append({
            "device_id": device.id,
            "device_name": device.name,
            "device_type": device.device_type,
            "room": device.room,
            "state": device.current_state,
            "device_uid": device.device_uid,
            "esp_id": device.esp_module_id,
            "esp_uid": device.esp_module.esp_uid if device.esp_module else None,
            "esp_name": device.esp_module.name if device.esp_module else None,
            **device_presence(device, now),
        })

    return result


@app.post("/devices/{device_id}/command")
async def create_command(
    device_id: int,
    command_type: str,
    payload: str = None,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    device = db.query(models.Device).filter(
        models.Device.id == device_id,
        models.Device.organization_id == current_user.organization_id
    ).first()

    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    command = models.DeviceCommand(
        device_id=device.id,
        organization_id=device.organization_id,
        command_type=command_type,
        payload=payload
    )

    if command_type == "TURN_ON":
        device.current_state = "ON"
    elif command_type == "TURN_OFF":
        device.current_state = "OFF"
    device.last_seen = datetime.utcnow()

    db.add(command)
    db.flush()
    presence = device_presence(device)
    record_event(
        db,
        "command_created",
        current_user.organization_id,
        f"{command_type} sent to {device.name}",
        {
            "command_id": command.id,
            "device_id": device.id,
            "device_name": device.name,
            "command_type": command_type,
            "state": device.current_state,
            "status": command.status,
            "is_online": presence["is_online"],
        },
    )
    db.commit()
    db.refresh(command)

    await manager.broadcast({
        "event": "command_created",
        "command_id": command.id,
        "device_id": device.id,
        "device_name": device.name,
        "command_type": command.command_type,
        "payload": command.payload,
        "state": device.current_state,
        "is_online": presence["is_online"],
        "presence_label": presence["presence_label"],
    })

    return {
        "message": "Command created",
        "command_id": command.id,
        "status": command.status,
        "state": device.current_state,
        "is_online": presence["is_online"],
        "presence_label": presence["presence_label"],
        "presence_age_seconds": presence["presence_age_seconds"],
        "last_seen": presence["last_seen"],
    }


@app.post("/devices/commands")
async def fetch_device_commands(
    device_data: DeviceAuthRequest,
    db: Session = Depends(get_db)
):
    device = db.query(models.Device).filter(
        models.Device.device_uid == device_data.device_uid
    ).first()

    if not device or not verify_device_token(device, device_data.device_token, db):
        raise HTTPException(status_code=401, detail="Invalid device credentials")

    commands = db.query(models.DeviceCommand).filter(
        models.DeviceCommand.device_id == device.id,
        models.DeviceCommand.status == "pending"
    ).all()

    result = []

    for cmd in commands:
        cmd.status = "delivered"
        result.append({
            "command_id": cmd.id,
            "command_type": cmd.command_type,
            "payload": cmd.payload
        })

    db.commit()

    if result:
        record_event(
            db,
            "commands_delivered",
            device.organization_id,
            f"{len(result)} command(s) delivered to {device.name}",
            {"device_id": device.id, "device_name": device.name, "commands": result},
        )
        db.commit()
        await manager.broadcast({
            "event": "commands_delivered",
            "device_id": device.id,
            "device_name": device.name,
            "commands": result
        })

    return result


@app.post("/devices/commands/{command_id}/complete")
async def complete_command(
    command_id: int,
    device_data: DeviceAuthRequest,
    db: Session = Depends(get_db)
):
    device = db.query(models.Device).filter(
        models.Device.device_uid == device_data.device_uid
    ).first()

    if not device or not verify_device_token(device, device_data.device_token, db):
        raise HTTPException(status_code=401, detail="Invalid device credentials")

    command = db.query(models.DeviceCommand).filter(
        models.DeviceCommand.id == command_id,
        models.DeviceCommand.device_id == device.id
    ).first()

    if not command:
        raise HTTPException(status_code=404, detail="Command not found")

    command.status = "executed"
    command.executed_at = datetime.utcnow()

    if command.command_type == "TURN_ON":
        device.current_state = "ON"
    elif command.command_type == "TURN_OFF":
        device.current_state = "OFF"
    device.last_seen = datetime.utcnow()
    presence = device_presence(device)

    record_event(
        db,
        "command_completed",
        device.organization_id,
        f"{command.command_type} executed by {device.name}",
        {
            "command_id": command.id,
            "device_id": device.id,
            "device_name": device.name,
            "command_type": command.command_type,
            "state": device.current_state,
            "status": command.status,
            "is_online": presence["is_online"],
        },
    )
    db.commit()

    await manager.broadcast({
        "event": "command_completed",
        "command_id": command.id,
        "device_id": device.id,
        "device_name": device.name,
        "command_type": command.command_type,
        "state": device.current_state,
        "is_online": presence["is_online"],
        "presence_label": presence["presence_label"],
    })

    return {"message": "Command marked as executed"}


@app.get("/dashboard")
def dashboard(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    devices = db.query(models.Device).filter(
        models.Device.organization_id == current_user.organization_id
    ).all()

    result = {}
    room_temperatures: dict[str, list[float]] = defaultdict(list)

    for device in devices:
        room = device.room or "Unassigned"

        if room not in result:
            result[room] = []

        latest_telemetry = (
            db.query(models.DeviceTelemetry)
            .filter(models.DeviceTelemetry.device_id == device.id)
            .order_by(models.DeviceTelemetry.created_at.desc())
            .first()
        )
        if latest_telemetry and latest_telemetry.temperature:
            try:
                room_temperatures[room].append(float(latest_telemetry.temperature))
            except (TypeError, ValueError):
                pass

        result[room].append({
            "device_id": device.id,
            "device_name": device.name,
            "device_type": device.device_type,
            "state": device.current_state,
            **device_presence(device),
        })

    enriched = {}
    for room, room_devices in result.items():
        temps = room_temperatures.get(room, [])
        enriched[room] = {
            "devices": room_devices,
            "temperature": round(sum(temps) / len(temps), 1) if temps else None,
        }

    return enriched


@app.post("/scenes")
async def create_scene(
    scene: SceneCreate,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    new_scene = models.Scene(
        name=scene.name,
        organization_id=current_user.organization_id
    )
    db.add(new_scene)
    db.commit()
    db.refresh(new_scene)

    for action in scene.actions:
        device = db.query(models.Device).filter(
            models.Device.id == action.device_id,
            models.Device.organization_id == current_user.organization_id
        ).first()

        if not device:
            raise HTTPException(
                status_code=404,
                detail=f"Device {action.device_id} not found"
            )

        new_action = models.SceneAction(
            scene_id=new_scene.id,
            device_id=action.device_id,
            command_type=action.command_type,
            payload=action.payload
        )
        db.add(new_action)

    record_event(
        db,
        "scene_created",
        current_user.organization_id,
        f"{new_scene.name} created",
        {"scene_id": new_scene.id, "scene_name": new_scene.name},
    )
    db.commit()

    await manager.broadcast({
        "event": "scene_created",
        "scene_id": new_scene.id,
        "scene_name": new_scene.name
    })

    return {"message": "Scene created", "scene_id": new_scene.id}


@app.get("/scenes")
def list_scenes(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    scenes = db.query(models.Scene).filter(
        models.Scene.organization_id == current_user.organization_id
    ).all()

    result = []
    for scene in scenes:
        actions = db.query(models.SceneAction).filter(
            models.SceneAction.scene_id == scene.id
        ).all()
        result.append({
            "scene_id": scene.id,
            "name": scene.name,
            "actions": [
                {
                    "device_id": action.device_id,
                    "command_type": action.command_type,
                    "payload": action.payload,
                }
                for action in actions
            ],
        })

    return result


@app.patch("/scenes/{scene_id}")
async def update_scene(
    scene_id: int,
    updates: SceneUpdate,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    scene = db.query(models.Scene).filter(
        models.Scene.id == scene_id,
        models.Scene.organization_id == current_user.organization_id
    ).first()

    if not scene:
        raise HTTPException(status_code=404, detail="Scene not found")

    update_data = schema_updates(updates)
    if "name" in update_data and update_data["name"]:
        scene.name = update_data["name"]

    if "actions" in update_data and update_data["actions"] is not None:
        db.query(models.SceneAction).filter(models.SceneAction.scene_id == scene.id).delete()
        for action in updates.actions:
            device = db.query(models.Device).filter(
                models.Device.id == action.device_id,
                models.Device.organization_id == current_user.organization_id
            ).first()

            if not device:
                raise HTTPException(status_code=404, detail=f"Device {action.device_id} not found")

            db.add(models.SceneAction(
                scene_id=scene.id,
                device_id=action.device_id,
                command_type=action.command_type,
                payload=action.payload,
            ))

    record_event(
        db,
        "scene_updated",
        current_user.organization_id,
        f"{scene.name} updated",
        {"scene_id": scene.id, "changes": update_data},
    )
    db.commit()

    await manager.broadcast({
        "event": "scene_updated",
        "scene_id": scene.id,
        "scene_name": scene.name,
    })

    return {"message": "Scene updated"}


@app.delete("/scenes/{scene_id}")
async def delete_scene(
    scene_id: int,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    scene = db.query(models.Scene).filter(
        models.Scene.id == scene_id,
        models.Scene.organization_id == current_user.organization_id
    ).first()

    if not scene:
        raise HTTPException(status_code=404, detail="Scene not found")

    scene_name = scene.name
    db.query(models.SceneAction).filter(models.SceneAction.scene_id == scene.id).delete()
    db.delete(scene)
    record_event(
        db,
        "scene_deleted",
        current_user.organization_id,
        f"{scene_name} deleted",
        {"scene_id": scene_id, "scene_name": scene_name},
    )
    db.commit()

    await manager.broadcast({
        "event": "scene_deleted",
        "scene_id": scene_id,
        "scene_name": scene_name,
    })

    return {"message": "Scene deleted"}


@app.post("/scenes/{scene_id}/run")
async def run_scene(
    scene_id: int,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    scene = db.query(models.Scene).filter(
        models.Scene.id == scene_id,
        models.Scene.organization_id == current_user.organization_id
    ).first()

    if not scene:
        raise HTTPException(status_code=404, detail="Scene not found")

    actions = db.query(models.SceneAction).filter(
        models.SceneAction.scene_id == scene.id
    ).all()

    created_commands = []

    for action in actions:
        device = db.query(models.Device).filter(
            models.Device.id == action.device_id,
            models.Device.organization_id == current_user.organization_id
        ).first()

        if not device:
            continue

        command = models.DeviceCommand(
            device_id=device.id,
            organization_id=device.organization_id,
            command_type=action.command_type,
            payload=action.payload
        )
        db.add(command)
        db.flush()

        if action.command_type == "TURN_ON":
            device.current_state = "ON"
        elif action.command_type == "TURN_OFF":
            device.current_state = "OFF"
        device.last_seen = datetime.utcnow()
        presence = device_presence(device)

        created_commands.append({
            "device_id": device.id,
            "device_name": device.name,
            "command_id": command.id,
            "command_type": command.command_type,
            "payload": command.payload,
            "state": device.current_state,
            "is_online": presence["is_online"],
            "presence_label": presence["presence_label"],
        })

    db.commit()

    record_event(
        db,
        "scene_executed",
        current_user.organization_id,
        f"{scene.name} executed",
        {"scene_id": scene.id, "scene_name": scene.name, "commands": created_commands},
    )
    db.commit()

    await manager.broadcast({
        "event": "scene_executed",
        "scene_id": scene.id,
        "scene_name": scene.name,
        "commands": created_commands
    })

    return {
        "message": "Scene executed",
        "commands": created_commands
    }


@app.post("/rules")
async def create_rule(
    rule: RuleCreate,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    new_rule = models.AutomationRule(
        name=rule.name,
        organization_id=current_user.organization_id,
        device_id=rule.device_id,
        condition_type=rule.condition_type,
        operator=rule.operator,
        value=rule.value,
        action_device_id=rule.action_device_id,
        action_command=rule.action_command
    )

    db.add(new_rule)
    db.flush()
    record_event(
        db,
        "rule_created",
        current_user.organization_id,
        f"{new_rule.name} created",
        {"rule_id": new_rule.id, "rule_name": new_rule.name},
    )
    db.commit()
    db.refresh(new_rule)

    await manager.broadcast({
        "event": "rule_created",
        "rule_id": new_rule.id,
        "rule_name": new_rule.name
    })

    return {"message": "Rule created", "rule_id": new_rule.id}


@app.get("/rules")
def list_rules(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    rules = db.query(models.AutomationRule).filter(
        models.AutomationRule.organization_id == current_user.organization_id
    ).all()

    return [
        {
            "rule_id": rule.id,
            "name": rule.name,
            "device_id": rule.device_id,
            "condition_type": rule.condition_type,
            "operator": rule.operator,
            "value": rule.value,
            "action_device_id": rule.action_device_id,
            "action_command": rule.action_command,
            "is_active": rule.is_active,
        }
        for rule in rules
    ]


@app.patch("/rules/{rule_id}")
async def update_rule(
    rule_id: int,
    updates: RuleUpdate,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    rule = db.query(models.AutomationRule).filter(
        models.AutomationRule.id == rule_id,
        models.AutomationRule.organization_id == current_user.organization_id
    ).first()

    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")

    update_data = schema_updates(updates)
    for field, value in update_data.items():
        setattr(rule, field, value)

    record_event(
        db,
        "rule_updated",
        current_user.organization_id,
        f"{rule.name} updated",
        {"rule_id": rule.id, "changes": update_data},
    )
    db.commit()

    await manager.broadcast({
        "event": "rule_updated",
        "rule_id": rule.id,
        "rule_name": rule.name,
    })

    return {"message": "Rule updated"}


@app.delete("/rules/{rule_id}")
async def delete_rule(
    rule_id: int,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    rule = db.query(models.AutomationRule).filter(
        models.AutomationRule.id == rule_id,
        models.AutomationRule.organization_id == current_user.organization_id
    ).first()

    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")

    rule_name = rule.name
    db.query(models.AutomationRuleActivity).filter(
        models.AutomationRuleActivity.rule_id == rule.id
    ).delete()
    db.delete(rule)
    record_event(
        db,
        "rule_deleted",
        current_user.organization_id,
        f"{rule_name} deleted",
        {"rule_id": rule_id, "rule_name": rule_name},
    )
    db.commit()

    await manager.broadcast({
        "event": "rule_deleted",
        "rule_id": rule_id,
        "rule_name": rule_name,
    })

    return {"message": "Rule deleted"}


@app.get("/devices/{device_id}/telemetry")
def get_device_telemetry(
    device_id: int,
    limit: int = 50,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    device = db.query(models.Device).filter(
        models.Device.id == device_id,
        models.Device.organization_id == current_user.organization_id
    ).first()

    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    telemetry = db.query(models.DeviceTelemetry).filter(
        models.DeviceTelemetry.device_id == device.id
    ).order_by(
        models.DeviceTelemetry.created_at.desc()
    ).limit(limit).all()

    return [serialize_telemetry(entry) for entry in telemetry]


@app.get("/energy/summary")
def energy_summary(
    range: str = "today",
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    now = datetime.utcnow()
    range_days = {"today": 1, "week": 7, "month": 30, "year": 365}.get(range, 1)
    since = now - timedelta(days=range_days)

    devices = db.query(models.Device).filter(
        models.Device.organization_id == current_user.organization_id
    ).all()
    device_ids = [device.id for device in devices]

    telemetry_rows = []
    if device_ids:
        telemetry_rows = (
            db.query(models.DeviceTelemetry)
            .filter(
                models.DeviceTelemetry.device_id.in_(device_ids),
                models.DeviceTelemetry.created_at >= since,
            )
            .order_by(models.DeviceTelemetry.created_at.asc())
            .all()
        )

    timeline_buckets: dict[datetime, list[float]] = defaultdict(list)

    def bucket_key(created_at: datetime) -> datetime:
        if range == "today":
            return created_at.replace(minute=0, second=0, microsecond=0)
        if range == "week":
            hour = (created_at.hour // 6) * 6
            return created_at.replace(hour=hour, minute=0, second=0, microsecond=0)
        return created_at.replace(hour=0, minute=0, second=0, microsecond=0)
    total_energy_kwh = 0.0
    has_hardware_power = False

    for index, entry in enumerate(telemetry_rows):
        power = telemetry_power_w(entry)
        if power > 0:
            has_hardware_power = True
        elif index > 0:
            prev = telemetry_rows[index - 1]
            if entry.device_id == prev.device_id:
                delta_hours = max(
                    (entry.created_at - prev.created_at).total_seconds() / 3600,
                    1 / 120,
                )
                device = next((item for item in devices if item.id == entry.device_id), None)
                if device:
                    power = estimated_device_watts(device)

        if power > 0 and index > 0:
            prev = telemetry_rows[index - 1]
            if entry.device_id == prev.device_id:
                delta_hours = max(
                    (entry.created_at - prev.created_at).total_seconds() / 3600,
                    1 / 120,
                )
                total_energy_kwh += (power / 1000) * delta_hours

        timeline_buckets[bucket_key(entry.created_at)].append(power)

    timeline = [
        {
            "time": bucket.isoformat(),
            "label": bucket.strftime("%H:%M" if range == "today" else "%d %b"),
            "kwh": round(sum(values) / max(len(values), 1) / 1000, 2),
            "power_w": round(sum(values) / max(len(values), 1), 1),
        }
        for bucket, values in sorted(timeline_buckets.items())
    ]

    if not timeline and devices:
        for device in devices:
            watts = estimated_device_watts(device)
            if watts <= 0:
                continue
            timeline.append(
                {
                    "time": now.isoformat(),
                    "label": device.name,
                    "kwh": round(watts / 1000, 2),
                    "power_w": round(watts, 1),
                }
            )
            total_energy_kwh += (watts / 1000) * (range_days * 2)

    latest_powers = []
    for device in devices:
        latest = (
            db.query(models.DeviceTelemetry)
            .filter(models.DeviceTelemetry.device_id == device.id)
            .order_by(models.DeviceTelemetry.created_at.desc())
            .first()
        )
        power = telemetry_power_w(latest) if latest else 0
        if power <= 0:
            power = estimated_device_watts(device)
        latest_powers.append(power)

    current_kw = round(sum(latest_powers) / 1000, 2) if latest_powers else 0
    if total_energy_kwh <= 0 and current_kw > 0:
        total_energy_kwh = current_kw * max(range_days * 4, 1)

    daily_average = round(total_energy_kwh / max(range_days, 1), 1)
    month_total = round(daily_average * 30, 1) if range != "year" else round(total_energy_kwh, 1)

    breakdown_totals: dict[str, float] = defaultdict(float)
    for device in devices:
        latest = (
            db.query(models.DeviceTelemetry)
            .filter(models.DeviceTelemetry.device_id == device.id)
            .order_by(models.DeviceTelemetry.created_at.desc())
            .first()
        )
        power = telemetry_power_w(latest) if latest else 0
        if power <= 0:
            power = estimated_device_watts(device)
        label = (device.device_type or "other").title()
        breakdown_totals[label] += power

    total_breakdown = sum(breakdown_totals.values()) or 1
    usage_breakdown = [
        {
            "label": label,
            "percent": round((value / total_breakdown) * 100),
            "power_w": round(value, 1),
        }
        for label, value in sorted(breakdown_totals.items(), key=lambda item: item[1], reverse=True)
    ]

    return {
        "range": range,
        "has_hardware_power": has_hardware_power,
        "current_kw": current_kw,
        "daily_average_kwh": daily_average,
        "month_total_kwh": month_total,
        "estimated_bill": round(month_total * ENERGY_RATE_PER_KWH, 0),
        "timeline": timeline,
        "usage_breakdown": usage_breakdown,
        "reading_count": len(telemetry_rows),
    }


@app.get("/rooms")
def list_rooms(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rooms = db.query(models.Room).filter(
        models.Room.organization_id == current_user.organization_id
    ).order_by(models.Room.name.asc()).all()
    return [
        {
            "room_id": room.id,
            "name": room.name,
            "created_at": room.created_at,
        }
        for room in rooms
    ]


@app.post("/rooms")
async def create_room(
    room: RoomCreate,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    name = room.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Room name is required")

    existing = db.query(models.Room).filter(
        models.Room.organization_id == current_user.organization_id,
        models.Room.name == name,
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="Room already exists")

    new_room = models.Room(name=name, organization_id=current_user.organization_id)
    db.add(new_room)
    record_event(
        db,
        "room_created",
        current_user.organization_id,
        f"{name} room created",
        {"room_name": name},
    )
    db.commit()
    db.refresh(new_room)

    await manager.broadcast({
        "event": "room_created",
        "room_id": new_room.id,
        "room_name": new_room.name,
    })

    return {"room_id": new_room.id, "name": new_room.name}


@app.delete("/rooms/{room_id}")
async def delete_room(
    room_id: int,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    room = db.query(models.Room).filter(
        models.Room.id == room_id,
        models.Room.organization_id == current_user.organization_id,
    ).first()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")

    room_name = room.name
    db.delete(room)
    record_event(
        db,
        "room_deleted",
        current_user.organization_id,
        f"{room_name} room deleted",
        {"room_id": room_id, "room_name": room_name},
    )
    db.commit()

    await manager.broadcast({
        "event": "room_deleted",
        "room_id": room_id,
        "room_name": room_name,
    })

    return {"message": "Room deleted"}


@app.get("/devices/{device_id}/commands")
def get_device_commands(
    device_id: int,
    limit: int = 50,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    device = db.query(models.Device).filter(
        models.Device.id == device_id,
        models.Device.organization_id == current_user.organization_id
    ).first()

    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    commands = db.query(models.DeviceCommand).filter(
        models.DeviceCommand.device_id == device.id
    ).order_by(
        models.DeviceCommand.created_at.desc()
    ).limit(limit).all()

    return commands


@app.get("/rules/{rule_id}/activity")
def get_rule_activity(
    rule_id: int,
    limit: int = 50,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    rule = db.query(models.AutomationRule).filter(
        models.AutomationRule.id == rule_id,
        models.AutomationRule.organization_id == current_user.organization_id
    ).first()

    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")

    activity = db.query(models.AutomationRuleActivity).filter(
        models.AutomationRuleActivity.rule_id == rule.id
    ).order_by(
        models.AutomationRuleActivity.created_at.desc()
    ).limit(limit).all()

    return activity


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)

    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)


@app.post("/test-broadcast")
async def test_broadcast():
    await manager.broadcast({
        "event": "test",
        "message": "WebSocket broadcast working"
    })

    return {"message": "Broadcast sent"}


_frontend_dist = Path(__file__).resolve().parent.parent / "frontend" / "dist"
if _frontend_dist.is_dir():
    app.mount("/", StaticFiles(directory=_frontend_dist, html=True), name="frontend")
