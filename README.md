# Smart Security System

End-to-end smart home dashboard with a FastAPI backend, React frontend, and HTTP device integration for hardware telemetry and control.

## Quick start

### 1. Backend (port 8001)

```bash
pip install -r requirements.txt
python -m uvicorn app.main:app --reload --port 8001
```

Copy `.env.example` to `.env` and adjust SMTP settings if you use password reset.

### 2. Frontend (port 5173)

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173 — register, then sign in.

### 3. Hardware / simulator

Run the zero-touch ESP simulator. It provisions itself with `CHIP_ID`, fetches assigned child devices, sends telemetry for sensor devices, and executes queued commands:

```bash
python simulator.py
```

Optional environment variables:

- `SMART_HOME_API_BASE` defaults to `http://127.0.0.1:8001`
- `CHIP_ID` defaults to `AA:BB:CC:DD:EE:FF`
- `FIRMWARE_VERSION` defaults to `1.0.0`
- `CREDENTIALS_FILE` defaults to `esp_credentials.json`

The simulator loop calls:

- `POST /devices/heartbeat`
- `POST /devices/telemetry` (temperature, humidity, motion, **power_w**, energy_wh)
- `POST /devices/commands` → execute → `POST /devices/commands/{id}/complete`

## Main API surface

| Endpoint | Purpose |
|----------|---------|
| `POST /register`, `POST /login` | User auth |
| `POST /devices/register` | Pair a new device |
| `POST /devices/telemetry` | Hardware readings |
| `POST /devices/{id}/command` | Control from dashboard |
| `GET /energy/summary` | Live energy aggregates |
| `GET /rooms`, `POST /rooms` | Room management |
| `GET /dashboard` | Rooms, devices, temperatures |
| `WS /ws` | Real-time events |

## Production notes

- Serve the built frontend (`npm run build`) behind nginx with `/api` and `/ws` proxied to FastAPI.
- Send `power_w` from meters/relays for accurate Energy page readings; without it, usage is estimated from device on/off state.
- Set `SMART_HOME_SMS_WEBHOOK_URL` to an SMS provider webhook to send phone alerts for motion/security events and failed login attempts.
- Set `SMART_HOME_TELEGRAM_BOT_TOKEN` and `SMART_HOME_TELEGRAM_CHAT_ID` to receive the same alerts in Telegram.
