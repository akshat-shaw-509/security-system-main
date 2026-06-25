from pydantic import BaseModel


class EspModuleCreate(BaseModel):
    name: str
    location: str | None = None


class EspModuleUpdate(BaseModel):
    name: str | None = None
    location: str | None = None
    is_active: bool | None = None


class EspAuthRequest(BaseModel):
    esp_uid: str
    esp_token: str


class EspCommandCompleteRequest(EspAuthRequest):
    device_uid: str | None = None
