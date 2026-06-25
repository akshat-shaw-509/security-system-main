from pydantic import BaseModel, Field


class TelemetryCreate(BaseModel):
    device_uid: str
    device_token: str
    temperature: float = 0
    humidity: float = 0
    motion_detected: bool = False
    power_w: float = Field(default=0, ge=0)
    energy_wh: float = Field(default=0, ge=0)