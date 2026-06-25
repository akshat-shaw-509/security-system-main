from pydantic import BaseModel

class DeviceAuthRequest(BaseModel):
    device_uid: str
    device_token: str