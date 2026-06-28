from pydantic import BaseModel


class CameraRegisterRequest(BaseModel):
    camera_name: str
    room: str | None = None
    esp_module_id: int | None = None
    stream_url: str | None = None
    snapshot_url: str | None = None
    camera_type: str = "mjpeg"


class CameraProvisionRequest(BaseModel):
    chip_id: str | None = None
    camera_name: str | None = None
    room: str | None = None
    firmware_version: str | None = None
    stream_url: str | None = None
    snapshot_url: str | None = None
    camera_type: str = "mjpeg"


class CameraAuthRequest(BaseModel):
    camera_uid: str
    camera_token: str


class CameraHeartbeatRequest(CameraAuthRequest):
    stream_url: str | None = None
    snapshot_url: str | None = None
    status: str | None = "online"
    status_reason: str | None = None


class CameraUpdateRequest(BaseModel):
    camera_name: str | None = None
    room: str | None = None
    stream_url: str | None = None
    snapshot_url: str | None = None
    camera_type: str | None = None
    status: str | None = None
    status_reason: str | None = None


class CameraSnapshotUploadRequest(CameraAuthRequest):
    image_base64: str | None = None
    image_url: str | None = None
    reason: str = "motion"
    motion_device_id: int | None = None


class CameraRecordingRequest(CameraAuthRequest):
    recording_url: str | None = None
    status: str = "finished"
    duration_seconds: int | None = None
    motion_device_id: int | None = None
    error_message: str | None = None


class BrowserCameraSnapshotRequest(BaseModel):
    image_base64: str
    reason: str = "manual"
    motion_device_id: int | None = None


class BrowserCameraRecordingRequest(BaseModel):
    video_base64: str
    mime_type: str = "video/webm"
    duration_seconds: int | None = None
    motion_device_id: int | None = None
    trigger_reason: str = "manual"
