import time
import random
import os
import requests

API_BASE = os.getenv("SMART_HOME_API_BASE", "http://127.0.0.1:8001")

DEVICE_UID = "07825630e0817642"
DEVICE_TOKEN = "8421586460d114efb10bb22ae664731836a43e0b2eca47ac16d371f656f9df0f"

TELEMETRY_INTERVAL_SECONDS = 5


def send_heartbeat():
    payload = {
        "device_uid": "07825630e0817642",
        "device_token": "8421586460d114efb10bb22ae664731836a43e0b2eca47ac16d371f656f9df0f",
        "temperature": 0,
        "humidity": 0,
        "motion_detected": False
    }

    response = requests.post(f"{API_BASE}/devices/heartbeat", json=payload)
    print("Heartbeat:", response.status_code, response.text)


def send_telemetry():
    payload = {
        "device_uid": "07825630e0817642",
        "device_token": "8421586460d114efb10bb22ae664731836a43e0b2eca47ac16d371f656f9df0f",
        "temperature": round(random.uniform(24, 35), 2),
        "humidity": round(random.uniform(45, 75), 2),
        "motion_detected": random.choice([True, False, False]),
        "power_w": round(random.uniform(2, 45), 2),
        "energy_wh": round(random.uniform(0, 500), 2),
    }

    response = requests.post(f"{API_BASE}/devices/telemetry", json=payload)
    print("Telemetry:", response.status_code, response.text)


def fetch_commands():
    payload = {
        "device_uid": "07825630e0817642",
        "device_token": "8421586460d114efb10bb22ae664731836a43e0b2eca47ac16d371f656f9df0f"
    }

    response = requests.post(f"{API_BASE}/devices/commands", json=payload)
    print("Commands:", response.status_code, response.text)

    if response.status_code != 200:
        return

    commands = response.json()

    for command in commands:
        execute_command(command)


def execute_command(command):
    print("Executing:", command)

    command_type = command.get("command_type")

    if command_type == "TURN_ON":
        print("Device turned ON")
    elif command_type == "TURN_OFF":
        print("Device turned OFF")
    else:
        print("Unknown command:", command_type)

    complete_command(command["command_id"])


def complete_command(command_id):
    payload = {
        "device_uid": "07825630e0817642",
        "device_token": "8421586460d114efb10bb22ae664731836a43e0b2eca47ac16d371f656f9df0f"
    }

    response = requests.post(
        f"{API_BASE}/devices/commands/{command_id}/complete",
        json=payload
    )

    print("Complete:", response.status_code, response.text)


def main():
    print("Device simulator started")
    print("Press CTRL+C to stop")

    while True:
        send_heartbeat()
        send_telemetry()
        fetch_commands()
        print("-" * 60)

        time.sleep(TELEMETRY_INTERVAL_SECONDS)


if __name__ == "__main__":
    main()
