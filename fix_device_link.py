import sqlite3

conn = sqlite3.connect("home_server.db")

print("=== Devices ===")
for row in conn.execute("SELECT id, name, device_uid, esp_module_id FROM devices ORDER BY id"):
    print(row)

print("\n=== ESP Modules ===")
for row in conn.execute("SELECT id, name, esp_uid FROM esp_modules"):
    print(row)

conn.close()