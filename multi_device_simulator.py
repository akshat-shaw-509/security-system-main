import time
import random
import os
import requests

API_BASE = os.getenv("SMART_HOME_API_BASE", "http://127.0.0.1:8001")


DEVICES = {
    "motion_sensor": {
        "name": "Motion Sensor",
        "uid": "07825630e0817642",
        "token": "8421586460d114efb10bb22ae664731836a43e0b2eca47ac16d371f656f9df0f",
        "type": "sensor",
        "state": "ACTIVE"
    },
    "fan": {
        "name": "Fan",
        "uid": "c1a96f5ca717bb74",
        "token": "1dcd14e47936177e14a79748316979b0961495874c320ccb98433a4b644d4122",
        "type": "fan",
        "state": "OFF"
    },
    "light": {
        "name": "Light",
        "uid": "40c4092d468b2bc6",
        "token": "dbcac2e91792ebeb7adafb21c5c94787681a2346c67898ae9a159b3298f3dfd5",
        "type": "light",
        "state": "OFF"
    }
}


LOOP_DELAY_SECONDS = 5


def post(endpoint, payload):
    try:
        response = requests.post(f"{API_BASE}{endpoint}", json=payload)
        return response
    except requests.exceptions.RequestException as e:
        print("Request failed:", e)
        return None


def heartbeat(device):
    payload = {
        "device_uid": device["uid"],
        "device_token": device["token"],
        "temperature": 0,
        "humidity": 0,
        "motion_detected": False
    }

    response = post("/devices/heartbeat", payload)

    if response:
        print(f"[{device['name']}] Heartbeat:", response.status_code)


def send_sensor_telemetry():
    sensor = DEVICES["motion_sensor"]

    motion_detected = random.choice([True, False, False])
    temperature = round(random.uniform(24, 36), 2)
    humidity = round(random.uniform(45, 75), 2)

    payload = {
        "device_uid": sensor["uid"],
        "device_token": sensor["token"],
        "temperature": temperature,
        "humidity": humidity,
        "motion_detected": motion_detected,
        "power_w": round(random.uniform(2, 8), 2),
        "energy_wh": 0,
    }

    response = post("/devices/telemetry", payload)

    if response:
        print(
            f"[Motion Sensor] Telemetry:",
            response.status_code,
            {
                "temperature": temperature,
                "humidity": humidity,
                "motion": motion_detected
            }
        )


def fetch_and_execute_commands(device_key):
    device = DEVICES[device_key]

    payload = {
        "device_uid": device["uid"],
        "device_token": device["token"]
    }

    response = post("/devices/commands", payload)

    if not response:
        return

    if response.status_code != 200:
        print(f"[{device['name']}] Command fetch failed:", response.status_code, response.text)
        return

    commands = response.json()

    if not commands:
        print(f"[{device['name']}] No commands")
        return

    for command in commands:
        command_type = command.get("command_type")
        command_id = command.get("command_id")

        print(f"[{device['name']}] Executing command:", command)

        if command_type == "TURN_ON":
            device["state"] = "ON"
        elif command_type == "TURN_OFF":
            device["state"] = "OFF"

        complete_command(device, command_id)


def complete_command(device, command_id):
    payload = {
        "device_uid": device["uid"],
        "device_token": device["token"]
    }

    response = post(f"/devices/commands/{command_id}/complete", payload)

    if response:
        print(f"[{device['name']}] Command complete:", response.status_code)


def print_states():
    print("\nCurrent Simulated States:")
    for key, device in DEVICES.items():
        print(f" - {device['name']}: {device['state']}")
    print("-" * 60)


def main():
    print("Multi-device simulator started")
    print("Press CTRL+C to stop")
    print("-" * 60)

    while True:
        for device in DEVICES.values():
            heartbeat(device)

        send_sensor_telemetry()

        fetch_and_execute_commands("fan")
        fetch_and_execute_commands("light")

        print_states()

        time.sleep(LOOP_DELAY_SECONDS)


if __name__ == "__main__":
    main()
