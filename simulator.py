"""
ESP Smart-Home Simulator
========================

Zero-touch provisioning flow:
1. Read CHIP_ID and SMART_HOME_API_BASE from environment variables.
2. Load saved ESP credentials from esp_credentials.json if present.
3. Authenticate with POST /esp/auth.
4. If authentication fails, call POST /esp/provision with CHIP_ID.
5. Fetch child devices from POST /esp/devices.
6. Loop: heartbeat every device, send telemetry for sensor devices, and execute
   queued commands.

Environment variables:
SMART_HOME_API_BASE   API URL, default http://127.0.0.1:8001
CHIP_ID               Simulated MAC/ID, default AA:BB:CC:DD:EE:FF
FIRMWARE_VERSION      Reported version, default 1.0.0
CREDENTIALS_FILE      Storage path, default esp_credentials.json
"""

import json
import os
import random
import sys
import time

import requests


API_BASE = os.getenv("SMART_HOME_API_BASE", "http://127.0.0.1:8001")
CHIP_ID = os.getenv("CHIP_ID", "AA:BB:CC:DD:EE:FF")
FIRMWARE_VERSION = os.getenv("FIRMWARE_VERSION", "1.0.0")
CREDENTIALS_FILE = os.getenv("CREDENTIALS_FILE", "esp_credentials.json")

LOOP_DELAY_SECONDS = 5
DEVICE_REFRESH_INTERVAL_SECONDS = 30

SENSOR_TYPES = {
    "sensor",
    "motion_sensor",
    "temperature_sensor",
    "humidity_sensor",
}


def load_credentials() -> dict:
    if not os.path.exists(CREDENTIALS_FILE):
        return {}
    try:
        with open(CREDENTIALS_FILE, "r", encoding="utf-8") as file:
            data = json.load(file)
        if data.get("esp_uid") and data.get("esp_token"):
            print(f"[STORE] Loaded credentials from {CREDENTIALS_FILE}")
            return data
    except (json.JSONDecodeError, OSError) as exc:
        print(f"[STORE] Could not read {CREDENTIALS_FILE}: {exc}")
    return {}


def save_credentials(esp_uid: str, esp_token: str, devices: list | None = None) -> None:
    try:
        payload = {"esp_uid": esp_uid, "esp_token": esp_token}
        if devices:
            payload["devices"] = devices
        with open(CREDENTIALS_FILE, "w", encoding="utf-8") as file:
            json.dump(payload, file, indent=2)
        print(f"[STORE] Credentials saved to {CREDENTIALS_FILE}")
    except OSError as exc:
        print(f"[STORE] Could not save credentials: {exc}")


def clear_credentials() -> None:
    try:
        os.remove(CREDENTIALS_FILE)
        print(f"[STORE] Cleared {CREDENTIALS_FILE}")
    except FileNotFoundError:
        pass


def post(endpoint: str, payload: dict, *, auth_token: str | None = None):
    headers = {"Content-Type": "application/json"}
    if auth_token:
        headers["Authorization"] = f"Bearer {auth_token}"
    try:
        return requests.post(
            f"{API_BASE}{endpoint}",
            json=payload,
            headers=headers,
            timeout=10,
        )
    except requests.exceptions.RequestException as exc:
        print(f"[HTTP] {endpoint} -> {exc}")
        return None


def provision() -> tuple[str | None, str | None, list[dict]]:
    print(f"[PROVISION] Provisioning chip_id={CHIP_ID} ...")
    payload = {"chip_id": CHIP_ID, "firmware_version": FIRMWARE_VERSION}
    response = post("/esp/provision", payload)

    if not response:
        print("[PROVISION] No response from server")
        return None, None, []

    if response.status_code not in (200, 201):
        print(f"[PROVISION] Failed: {response.status_code} {response.text}")
        return None, None, []

    data = response.json()
    esp_uid = data.get("esp_uid")
    esp_token = data.get("esp_token")
    devices = data.get("devices") or []

    if not esp_uid or not esp_token:
        print(f"[PROVISION] Unexpected response body: {data}")
        return None, None, []

    print(f"[PROVISION] Success -> esp_uid={esp_uid} ({len(devices)} device(s))")
    save_credentials(esp_uid, esp_token, devices)
    return esp_uid, esp_token, devices


def authenticate(esp_uid: str, esp_token: str) -> str | None:
    response = post("/esp/auth", {"esp_uid": esp_uid, "esp_token": esp_token})

    if not response:
        return None

    if response.status_code == 200:
        token = response.json().get("access_token")
        if token:
            print(f"[AUTH] Authenticated esp_uid={esp_uid}")
        else:
            print(f"[AUTH] Got 200 but access_token is null — register a user in the frontend first")
        return token

    print(f"[AUTH] Failed: {response.status_code} {response.text}")
    return None


def boot() -> tuple[str, str, str, list[dict]]:
    credentials = load_credentials()
    esp_uid = credentials.get("esp_uid")
    esp_token = credentials.get("esp_token")
    auth_token = None
    devices: list[dict] = []

    if esp_uid and esp_token:
        auth_token = authenticate(esp_uid, esp_token)

    if not auth_token:
        print("[BOOT] No valid credentials; starting auto-provisioning ...")
        esp_uid, esp_token, devices = provision()

        if not esp_uid or not esp_token:
            print("[BOOT] Provisioning failed. Is the backend running?")
            sys.exit(1)

        auth_token = authenticate(esp_uid, esp_token)
        if not auth_token:
            print("[BOOT] Authentication failed after provisioning.")
            sys.exit(1)

    return esp_uid, esp_token, auth_token, devices


def ensure_devices(esp_uid: str, esp_token: str, auth_token: str, devices: list[dict]) -> tuple[str, str, str, list[dict]]:
    if devices:
        return esp_uid, esp_token, auth_token, devices

    devices = fetch_devices(esp_uid, esp_token, auth_token)
    if devices:
        return esp_uid, esp_token, auth_token, devices

    print("[BOOT] No child devices assigned; re-provisioning to seed defaults ...")
    esp_uid, esp_token, devices = provision()
    if not esp_uid or not esp_token:
        return esp_uid, esp_token, auth_token, []

    auth_token = authenticate(esp_uid, esp_token)
    if not auth_token:
        return esp_uid, esp_token, auth_token, devices

    if devices:
        return esp_uid, esp_token, auth_token, devices

    return esp_uid, esp_token, auth_token, fetch_devices(esp_uid, esp_token, auth_token)


def fetch_devices(esp_uid: str, esp_token: str, auth_token: str) -> list[dict]:
    response = post(
        "/esp/devices",
        {"esp_uid": esp_uid, "esp_token": esp_token},
        auth_token=auth_token,
    )

    if not response:
        return []

    if response.status_code != 200:
        print(f"[DEVICES] Fetch failed: {response.status_code} {response.text}")
        return []

    devices = response.json().get("devices", [])
    stored = load_credentials().get("devices") or []
    token_by_uid = {
        item.get("device_uid"): item.get("device_token")
        for item in stored
        if item.get("device_uid") and item.get("device_token")
    }
    for device in devices:
        if not device.get("device_token"):
            device["device_token"] = token_by_uid.get(device.get("device_uid"))

    names = [device.get("device_name", device.get("device_uid", "?")) for device in devices]
    print(f"[DEVICES] {len(devices)} device(s): {names}")
    return devices


def device_name(device: dict) -> str:
    return device.get("device_name", device.get("device_uid", "unknown"))


def heartbeat(device: dict) -> None:
    payload = {
        "device_uid": device["device_uid"],
        "device_token": device["device_token"],
        "temperature": 0,
        "humidity": 0,
        "motion_detected": False,
    }
    response = post("/devices/heartbeat", payload)
    if response:
        print(f"  [{device_name(device)}] heartbeat -> {response.status_code}")


def send_telemetry(device: dict) -> None:
    temperature = round(random.uniform(24, 36), 2)
    humidity = round(random.uniform(45, 75), 2)
    motion = random.choice([True, False, False])

    payload = {
        "device_uid": device["device_uid"],
        "device_token": device["device_token"],
        "temperature": temperature,
        "humidity": humidity,
        "motion_detected": motion,
        "power_w": round(random.uniform(2, 8), 2),
        "energy_wh": 0,
    }
    response = post("/devices/telemetry", payload)
    if response:
        print(
            f"  [{device_name(device)}] telemetry -> {response.status_code} "
            f"temp={temperature} hum={humidity} motion={motion}"
        )


def complete_command(device: dict, command_id, success: bool = True, failure_reason: str | None = None) -> None:
    params = f"?success={'true' if success else 'false'}"
    if not success and failure_reason:
        params += f"&failure_reason={requests.utils.quote(failure_reason)}"
    response = post(
        f"/devices/commands/{command_id}/complete{params}",
        {
            "device_uid": device["device_uid"],
            "device_token": device["device_token"],
        },
    )
    if response:
        result = "OK" if success else "FAILED"
        print(f"  [{device_name(device)}] complete({command_id}) {result} -> {response.status_code}")


def fetch_and_execute_commands(device: dict) -> None:
    response = post(
        "/devices/commands",
        {
            "device_uid": device["device_uid"],
            "device_token": device["device_token"],
        },
    )
    if not response:
        return
    if response.status_code != 200:
        print(f"  [{device_name(device)}] commands -> {response.status_code}")
        return

    for command in response.json():
        command_type = command.get("command_type")
        command_id = command.get("command_id")
        print(f"  [{device_name(device)}] executing {command_type} ...")

        # Simulate hardware execution delay (real ESP would act here)
        time.sleep(0.5)

        # Simulate very rare hardware failure (5% of the time) for realism.
        # Remove or adjust this in production / when you always want success.
        if random.random() < 0.05:
            print(f"  [{device_name(device)}] hardware fault on {command_type}")
            complete_command(device, command_id, success=False, failure_reason="Simulated hardware fault")
            continue

        # Update local simulator state
        if command_type == "TURN_ON":
            device["_state"] = "ON"
        elif command_type == "TURN_OFF":
            device["_state"] = "OFF"
        elif command_type == "LOCK":
            device["_state"] = "LOCKED"
        elif command_type == "UNLOCK":
            device["_state"] = "UNLOCKED"
        else:
            print(f"  [{device_name(device)}] unknown command: {command_type}")

        # Report success to backend — this is the only moment the backend
        # will update Device.current_state and broadcast command_completed.
        complete_command(device, command_id, success=True)


def print_states(devices: list[dict]) -> None:
    if not devices:
        return
    print("\n  Current States:")
    for device in devices:
        device_type = device.get("device_type", "?").upper()
        state = device.get("_state", device.get("state", "-"))
        print(f"    [{device_type:20s}] {device_name(device)}: {state}")
    print("-" * 60)


def main() -> None:
    print("=" * 60)
    print("  ESP Smart-Home Simulator")
    print(f"  API      : {API_BASE}")
    print(f"  Chip ID  : {CHIP_ID}")
    print(f"  Firmware : {FIRMWARE_VERSION}")
    print("  Press CTRL+C to stop")
    print("=" * 60)

    esp_uid, esp_token, auth_token, devices = boot()
    esp_uid, esp_token, auth_token, devices = ensure_devices(esp_uid, esp_token, auth_token, devices)

    last_refresh = 0

    while True:
        now = time.time()

        if now - last_refresh >= DEVICE_REFRESH_INTERVAL_SECONDS:
            new_token = authenticate(esp_uid, esp_token)

            if not new_token:
                print("[LOOP] Auth failed; re-provisioning ...")
                clear_credentials()
                esp_uid, esp_token, auth_token, devices = boot()
                esp_uid, esp_token, auth_token, devices = ensure_devices(
                    esp_uid, esp_token, auth_token, devices,
                )
            else:
                auth_token = new_token
                fresh_devices = fetch_devices(esp_uid, esp_token, auth_token)

                if not fresh_devices:
                    esp_uid, esp_token, auth_token, fresh_devices = ensure_devices(
                        esp_uid, esp_token, auth_token, devices,
                    )

                if fresh_devices:
                    uid_to_state = {device["device_uid"]: device.get("_state") for device in devices}
                    for device in fresh_devices:
                        saved_state = uid_to_state.get(device["device_uid"])
                        if saved_state:
                            device["_state"] = saved_state
                    devices = fresh_devices

            last_refresh = now

        if not devices:
            print("[LOOP] No devices assigned yet; waiting ...")
            time.sleep(LOOP_DELAY_SECONDS)
            continue

        print(f"\n[LOOP] Tick - {len(devices)} device(s)")

        for device in devices:
            heartbeat(device)

        for device in devices:
            if device.get("device_type", "").lower() in SENSOR_TYPES:
                send_telemetry(device)

        for device in devices:
            fetch_and_execute_commands(device)

        print_states(devices)
        time.sleep(LOOP_DELAY_SECONDS)


if __name__ == "__main__":
    main()