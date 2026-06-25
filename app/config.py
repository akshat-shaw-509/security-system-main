import os
from pathlib import Path


def load_env_file() -> None:
    env_path = Path(__file__).resolve().parent.parent / ".env"
    if not env_path.exists():
        return
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


load_env_file()


def env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


SECRET_KEY = os.getenv("SMART_HOME_SECRET_KEY", "dev-only-change-this-secret")
ALGORITHM = os.getenv("SMART_HOME_JWT_ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("SMART_HOME_TOKEN_EXPIRE_MINUTES", "60"))

ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.getenv(
        "SMART_HOME_ALLOWED_ORIGINS",
        "http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:8001,http://localhost:8001",
    ).split(",")
    if origin.strip()
]

RATE_LIMIT_REQUESTS = int(os.getenv("SMART_HOME_RATE_LIMIT_REQUESTS", "600"))
RATE_LIMIT_WINDOW_SECONDS = int(os.getenv("SMART_HOME_RATE_LIMIT_WINDOW_SECONDS", "60"))
AUTH_RATE_LIMIT_REQUESTS = int(os.getenv("SMART_HOME_AUTH_RATE_LIMIT_REQUESTS", "8"))
AUTH_RATE_LIMIT_WINDOW_SECONDS = int(os.getenv("SMART_HOME_AUTH_RATE_LIMIT_WINDOW_SECONDS", "300"))

RESET_TOKEN_EXPIRE_MINUTES = int(os.getenv("SMART_HOME_RESET_TOKEN_EXPIRE_MINUTES", "15"))
EXPOSE_RESET_TOKEN = env_bool("SMART_HOME_EXPOSE_RESET_TOKEN", True)
RESET_OTP_EXPIRE_MINUTES = int(os.getenv("SMART_HOME_RESET_OTP_EXPIRE_MINUTES", "10"))
EXPOSE_RESET_OTP = env_bool("SMART_HOME_EXPOSE_RESET_OTP", False)

SMTP_HOST = os.getenv("SMART_HOME_SMTP_HOST", "")
SMTP_PORT = int(os.getenv("SMART_HOME_SMTP_PORT", "587"))
SMTP_USERNAME = os.getenv("SMART_HOME_SMTP_USERNAME", "")
SMTP_PASSWORD = os.getenv("SMART_HOME_SMTP_PASSWORD", "")
SMTP_FROM_EMAIL = os.getenv("SMART_HOME_SMTP_FROM_EMAIL", SMTP_USERNAME)
SMTP_USE_TLS = env_bool("SMART_HOME_SMTP_USE_TLS", True)

SMS_WEBHOOK_URL = os.getenv("SMART_HOME_SMS_WEBHOOK_URL", "")
SMS_WEBHOOK_TOKEN = os.getenv("SMART_HOME_SMS_WEBHOOK_TOKEN", "")

TELEGRAM_BOT_TOKEN = os.getenv("SMART_HOME_TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID = os.getenv("SMART_HOME_TELEGRAM_CHAT_ID", "")
