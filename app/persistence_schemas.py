from pydantic import BaseModel


class SettingsUpdate(BaseModel):
    home_name: str | None = None
    location: str | None = None
    temperature_unit: str | None = None
    timezone: str | None = None
    language: str | None = None
    dark_mode: bool | None = None
    auto_update: bool | None = None
    system_alerts: bool | None = None
    security_alerts: bool | None = None
    voice_feedback: bool | None = None
    dashboard_preferences: dict | None = None


class ProfileUpdate(BaseModel):
    display_name: str | None = None


class ProfilePhotoUpload(BaseModel):
    image_base64: str


class ProvisioningHistoryCreate(BaseModel):
    type: str
    device_id: int | None = None
    esp_module_id: int | None = None
    camera_id: int | None = None
    name: str | None = None
    status: str = "created"
    payload: dict | None = None


class KnownPersonCreate(BaseModel):
    name: str
    photo_base64: str | None = None
    notes: str | None = None


class KnownPersonUpdate(BaseModel):
    name: str | None = None
    photo_base64: str | None = None
    notes: str | None = None


class NotificationUpdate(BaseModel):
    read: bool | None = None
