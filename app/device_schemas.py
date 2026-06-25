from pydantic import BaseModel


class DeviceCreate(BaseModel):
    name: str
    device_type: str
    room: str | None = None
    esp_uid: str | None = None


class DeviceUpdate(BaseModel):
    name: str | None = None
    device_type: str | None = None
    room: str | None = None
    is_active: bool | None = None
    esp_uid: str | None = None
