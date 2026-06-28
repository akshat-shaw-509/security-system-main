"""Register camera, user-data, and ESP provisioning routes on the FastAPI app."""

from __future__ import annotations

import asyncio
import base64
import json
import secrets
from datetime import datetime, timedelta
from pathlib import Path

import requests
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response, StreamingResponse
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from . import models
from .api_utils import record_event, schema_payload
from .auth import (
    get_current_user,
    get_db,
    hash_secret,
    verify_secret,
)
from .camera_schemas import (
    BrowserCameraRecordingRequest,
    BrowserCameraSnapshotRequest,
    CameraAuthRequest,
    CameraHeartbeatRequest,
    CameraProvisionRequest,
    CameraRecordingRequest,
    CameraRegisterRequest,
    CameraSnapshotUploadRequest,
    CameraUpdateRequest,
)
from .config import ALGORITHM, SECRET_KEY
from .database import SessionLocal
from .esp_schemas import EspProvisionRequest
from .persistence_schemas import (
    KnownPersonCreate,
    KnownPersonUpdate,
    ProfilePhotoUpload,
    ProfileUpdate,
    ProvisioningHistoryCreate,
    SettingsUpdate,
)
from .schedules import router as schedules_router
from .scheduler_service import schedule_runner_loop
from .websocket_manager import manager

CAMERA_ONLINE_THRESHOLD_SECONDS = 90
CAMERA_RECORDING_DURATION_SECONDS = 30
CAMERA_MEDIA_DIR = Path("camera_media")
PROFILE_MEDIA_DIR = Path("profile_media")
KNOWN_PEOPLE_MEDIA_DIR = Path("known_people_media")

camera_router = APIRouter(prefix="/cameras", tags=["cameras"])
device_camera_router = APIRouter(prefix="/camera", tags=["camera-device"])
user_router = APIRouter(tags=["user-data"])


def get_default_provisioning_owner(db: Session):
    organization = db.query(models.Organization).order_by(models.Organization.id.asc()).first()
    if not organization:
        organization = models.Organization(name="Default Home")
        db.add(organization)
        db.flush()
    owner = db.query(models.User).filter(
        models.User.organization_id == organization.id,
    ).order_by(models.User.id.asc()).first()
    return organization, owner


def verify_camera_token(camera: models.Camera, camera_token: str) -> bool:
    return verify_secret(camera_token, camera.camera_token)


def authenticate_camera(camera_data: CameraAuthRequest, db: Session) -> models.Camera:
    camera = db.query(models.Camera).filter(
        models.Camera.camera_uid == camera_data.camera_uid,
    ).first()
    if not camera or not verify_camera_token(camera, camera_data.camera_token):
        raise HTTPException(status_code=401, detail="Invalid camera credentials")
    return camera


def camera_presence(camera: models.Camera, now: datetime | None = None) -> dict:
    now = now or datetime.utcnow()
    seconds_since_seen = (now - camera.last_seen).total_seconds() if camera.last_seen else None
    is_online = camera.status == "online" and (
        seconds_since_seen is None or seconds_since_seen <= CAMERA_ONLINE_THRESHOLD_SECONDS
    )
    if is_online:
        label = "Online"
    elif camera.status_reason:
        label = camera.status_reason
    elif not camera.last_seen:
        label = "Never Connected"
    else:
        label = "Camera Offline"
    return {
        "is_online": is_online,
        "last_seen": camera.last_seen,
        "presence_age_seconds": seconds_since_seen,
        "presence_label": label,
    }


def serialize_camera(camera: models.Camera, now: datetime | None = None) -> dict:
    presence = camera_presence(camera, now)
    return {
        "camera_id": camera.id,
        "camera_name": camera.camera_name,
        "room": camera.room,
        "esp_id": camera.esp_module_id,
        "esp_name": camera.esp_module.name if camera.esp_module else None,
        "camera_type": camera.camera_type,
        "status": "online" if presence["is_online"] else "offline",
        "status_reason": camera.status_reason,
        "last_seen": presence["last_seen"],
        "presence_age_seconds": presence["presence_age_seconds"],
        "presence_label": presence["presence_label"],
        "has_stream": bool(camera.stream_url),
        "has_snapshot": bool(camera.snapshot_url),
        "stream_path": f"/cameras/{camera.id}/stream" if camera.stream_url else None,
        "snapshot_path": f"/cameras/{camera.id}/snapshot",
        "created_at": camera.created_at,
        "updated_at": camera.updated_at,
    }


def serialize_camera_snapshot(snapshot: models.CameraSnapshot) -> dict:
    return {
        "snapshot_id": snapshot.id,
        "camera_id": snapshot.camera_id,
        "camera_name": snapshot.camera.camera_name if snapshot.camera else None,
        "room": snapshot.camera.room if snapshot.camera else None,
        "motion_device_id": snapshot.motion_device_id,
        "reason": snapshot.reason,
        "status": snapshot.status,
        "error_message": snapshot.error_message,
        "captured_at": snapshot.captured_at,
        "image_path": f"/cameras/snapshots/{snapshot.id}/image",
    }


def serialize_camera_recording(recording: models.CameraRecording) -> dict:
    return {
        "recording_id": recording.id,
        "camera_id": recording.camera_id,
        "camera_name": recording.camera.camera_name if recording.camera else None,
        "room": recording.camera.room if recording.camera else None,
        "motion_device_id": recording.motion_device_id,
        "trigger_reason": recording.trigger_reason,
        "status": recording.status,
        "started_at": recording.started_at,
        "ended_at": recording.ended_at,
        "duration_seconds": recording.duration_seconds,
        "error_message": recording.error_message,
        "recording_path": (
            f"/cameras/recordings/{recording.id}/media"
            if recording.file_path or recording.external_url
            else None
        ),
    }


def get_camera_or_404(db: Session, camera_id: int, organization_id: int) -> models.Camera:
    camera = db.query(models.Camera).filter(
        models.Camera.id == camera_id,
        models.Camera.organization_id == organization_id,
    ).first()
    if not camera:
        raise HTTPException(status_code=404, detail="Camera not found")
    return camera


def validate_camera_remote_url(url: str | None) -> str:
    if not url:
        raise HTTPException(status_code=404, detail="Camera URL is not configured")
    lowered = url.lower()
    if lowered.startswith("rtsp://"):
        raise HTTPException(
            status_code=400,
            detail="RTSP cameras require an RTSP-to-MJPEG/WebRTC gateway before browser playback",
        )
    if not (lowered.startswith("http://") or lowered.startswith("https://")):
        raise HTTPException(status_code=400, detail="Only HTTP/HTTPS camera URLs can be proxied")
    return url


def camera_media_file(kind: str, organization_id: int, camera_id: int, suffix: str) -> Path:
    folder = CAMERA_MEDIA_DIR / kind / str(organization_id) / str(camera_id)
    folder.mkdir(parents=True, exist_ok=True)
    return folder / f"{int(datetime.utcnow().timestamp() * 1000)}{suffix}"


def save_snapshot_bytes(
    db: Session,
    camera: models.Camera,
    content: bytes | None,
    motion_device_id: int | None,
    reason: str,
    error_message: str | None = None,
) -> models.CameraSnapshot:
    snapshot = models.CameraSnapshot(
        camera_id=camera.id,
        organization_id=camera.organization_id,
        motion_device_id=motion_device_id,
        reason=reason,
        status="captured" if content else "failed",
        error_message=error_message,
    )
    if content:
        path = camera_media_file("snapshots", camera.organization_id, camera.id, ".jpg")
        path.write_bytes(content)
        snapshot.file_path = str(path)
    db.add(snapshot)
    db.flush()
    return snapshot


def current_user_from_query_token(access_token: str, db: Session) -> models.User:
    credentials_exception = HTTPException(status_code=401, detail="Could not validate credentials")
    try:
        payload = jwt.decode(access_token, SECRET_KEY, algorithms=[ALGORITHM])
        username = payload.get("sub")
        if not username or str(username).startswith("esp:"):
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    user = db.query(models.User).filter(models.User.username == username).first()
    if not user:
        raise credentials_exception
    return user


def ensure_user_settings(db: Session, user: models.User) -> models.UserSettings:
    settings = db.query(models.UserSettings).filter(models.UserSettings.user_id == user.id).first()
    if settings:
        return settings
    settings = models.UserSettings(user_id=user.id, organization_id=user.organization_id)
    db.add(settings)
    db.flush()
    return settings


def ensure_user_profile(db: Session, user: models.User) -> models.UserProfile:
    profile = db.query(models.UserProfile).filter(models.UserProfile.user_id == user.id).first()
    if profile:
        return profile
    profile = models.UserProfile(
        user_id=user.id,
        organization_id=user.organization_id,
        display_name=user.username,
    )
    db.add(profile)
    db.flush()
    return profile


def serialize_settings(settings: models.UserSettings) -> dict:
    try:
        dashboard_preferences = json.loads(settings.dashboard_preferences or "{}")
    except json.JSONDecodeError:
        dashboard_preferences = {}
    return {
        "home_name": settings.home_name or "",
        "location": settings.location or "",
        "temperature_unit": settings.temperature_unit or "C",
        "timezone": settings.timezone or "Asia/Kolkata",
        "language": settings.language or "en",
        "dark_mode": settings.dark_mode,
        "auto_update": settings.auto_update,
        "system_alerts": settings.system_alerts,
        "security_alerts": settings.security_alerts,
        "voice_feedback": settings.voice_feedback,
        "dashboard_preferences": dashboard_preferences,
    }


def serialize_profile(profile: models.UserProfile, user: models.User) -> dict:
    photo_path = None
    if profile.photo_path and Path(profile.photo_path).exists():
        photo_path = f"/profile/photo?access_token=TOKEN"
    return {
        "user_id": user.id,
        "username": user.username,
        "display_name": profile.display_name or user.username,
        "photo_path": photo_path,
        "updated_at": profile.updated_at,
    }


def serialize_provisioning_history(row: models.ProvisioningHistory) -> dict:
    try:
        payload = json.loads(row.payload or "{}")
    except json.JSONDecodeError:
        payload = {}
    return {
        "history_id": row.id,
        "type": row.type,
        "device_id": row.device_id,
        "esp_module_id": row.esp_module_id,
        "camera_id": row.camera_id,
        "name": row.name,
        "status": row.status,
        "payload": payload,
        "created_at": row.created_at,
    }


def create_provisioning_history(
    db: Session,
    organization_id: int,
    entry_type: str,
    *,
    name: str | None = None,
    created_by: int | None = None,
    device_id: int | None = None,
    esp_module_id: int | None = None,
    camera_id: int | None = None,
    status: str = "created",
    payload: dict | None = None,
) -> models.ProvisioningHistory:
    row = models.ProvisioningHistory(
        organization_id=organization_id,
        type=entry_type,
        device_id=device_id,
        esp_module_id=esp_module_id,
        camera_id=camera_id,
        created_by=created_by,
        name=name,
        status=status,
        payload=json.dumps(payload or {}),
    )
    db.add(row)
    db.flush()
    return row


def serialize_known_person(person: models.KnownPerson) -> dict:
    photo_path = None
    if person.photo_path and Path(person.photo_path).exists():
        photo_path = f"/known-people/{person.id}/photo?access_token=TOKEN"
    return {
        "person_id": person.id,
        "name": person.name,
        "notes": person.notes,
        "photo_path": photo_path,
        "created_at": person.created_at,
        "updated_at": person.updated_at,
    }


def serialize_notification(notification: models.Notification) -> dict:
    return {
        "notification_id": notification.id,
        "title": notification.title,
        "message": notification.message,
        "read": notification.read,
        "event_type": notification.event_type,
        "created_at": notification.created_at,
        "read_at": notification.read_at,
    }


async def camera_recording_maintenance_loop():
    while True:
        try:
            await asyncio.sleep(5)
            db = SessionLocal()
            try:
                now = datetime.utcnow()
                recordings = db.query(models.CameraRecording).filter(
                    models.CameraRecording.status == "recording",
                ).all()
                for recording in recordings:
                    elapsed = (now - recording.started_at).total_seconds()
                    if elapsed < (recording.duration_seconds or CAMERA_RECORDING_DURATION_SECONDS):
                        continue
                    recording.status = "finished"
                    recording.ended_at = now
                    await manager.broadcast({
                        "event": "recording_finished",
                        "camera_id": recording.camera_id,
                        "recording_id": recording.id,
                    })
                db.commit()
            finally:
                db.close()
        except asyncio.CancelledError:
            raise
        except Exception:
            pass


# --- Camera dashboard routes ---

@camera_router.get("")
def list_cameras(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    now = datetime.utcnow()
    cameras = db.query(models.Camera).filter(
        models.Camera.organization_id == current_user.organization_id,
    ).order_by(models.Camera.created_at.desc()).all()
    return [serialize_camera(camera, now) for camera in cameras]


@camera_router.post("/register")
async def register_camera(
    request: CameraRegisterRequest,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if request.esp_module_id:
        esp_module = db.query(models.EspModule).filter(
            models.EspModule.id == request.esp_module_id,
            models.EspModule.organization_id == current_user.organization_id,
        ).first()
        if not esp_module:
            raise HTTPException(status_code=404, detail="ESP module not found")

    camera_token = secrets.token_hex(32)
    camera = models.Camera(
        organization_id=current_user.organization_id,
        esp_module_id=request.esp_module_id,
        camera_name=request.camera_name,
        room=request.room,
        camera_uid=f"cam_{secrets.token_hex(8)}",
        camera_token=hash_secret(camera_token),
        stream_url=request.stream_url,
        snapshot_url=request.snapshot_url,
        camera_type=request.camera_type,
        status="offline",
        status_reason="Waiting for camera heartbeat",
    )
    db.add(camera)
    db.flush()
    record_event(
        db,
        "camera_registered",
        current_user.organization_id,
        f"{camera.camera_name} registered",
        {"camera_id": camera.id, "camera_name": camera.camera_name},
    )
    db.commit()
    db.refresh(camera)

    await manager.broadcast({
        "event": "camera_registered",
        "camera_id": camera.id,
        "camera_name": camera.camera_name,
    })

    return {
        **serialize_camera(camera),
        "camera_uid": camera.camera_uid,
        "camera_token": camera_token,
    }


@camera_router.get("/snapshots/recent")
def recent_camera_snapshots(
    limit: int = 12,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    snapshots = db.query(models.CameraSnapshot).filter(
        models.CameraSnapshot.organization_id == current_user.organization_id,
    ).order_by(models.CameraSnapshot.captured_at.desc()).limit(min(limit, 50)).all()
    return [serialize_camera_snapshot(snapshot) for snapshot in snapshots]


@camera_router.get("/recordings/recent")
def recent_camera_recordings(
    limit: int = 12,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    recordings = db.query(models.CameraRecording).filter(
        models.CameraRecording.organization_id == current_user.organization_id,
    ).order_by(models.CameraRecording.started_at.desc()).limit(min(limit, 50)).all()
    return [serialize_camera_recording(recording) for recording in recordings]


@camera_router.get("/snapshots/{snapshot_id}/image")
def camera_snapshot_image(
    snapshot_id: int,
    access_token: str = Query(...),
    db: Session = Depends(get_db),
):
    current_user = current_user_from_query_token(access_token, db)
    snapshot = db.query(models.CameraSnapshot).filter(
        models.CameraSnapshot.id == snapshot_id,
        models.CameraSnapshot.organization_id == current_user.organization_id,
    ).first()
    if not snapshot:
        raise HTTPException(status_code=404, detail="Snapshot not found")
    if snapshot.file_path and Path(snapshot.file_path).exists():
        return Response(Path(snapshot.file_path).read_bytes(), media_type="image/jpeg")
    if snapshot.external_url:
        response = requests.get(validate_camera_remote_url(snapshot.external_url), timeout=8)
        response.raise_for_status()
        return Response(response.content, media_type=response.headers.get("content-type", "image/jpeg"))
    raise HTTPException(status_code=404, detail=snapshot.error_message or "Snapshot image is unavailable")


@camera_router.get("/recordings/{recording_id}/media")
def camera_recording_media(
    recording_id: int,
    access_token: str = Query(...),
    db: Session = Depends(get_db),
):
    current_user = current_user_from_query_token(access_token, db)
    recording = db.query(models.CameraRecording).filter(
        models.CameraRecording.id == recording_id,
        models.CameraRecording.organization_id == current_user.organization_id,
    ).first()
    if not recording:
        raise HTTPException(status_code=404, detail="Recording not found")
    if recording.file_path and Path(recording.file_path).exists():
        suffix = Path(recording.file_path).suffix.lower()
        media_type = (
            "video/webm" if suffix == ".webm"
            else "video/mp4" if suffix == ".mp4"
            else "multipart/x-mixed-replace"
        )
        return Response(Path(recording.file_path).read_bytes(), media_type=media_type)
    if recording.external_url:
        response = requests.get(validate_camera_remote_url(recording.external_url), stream=True, timeout=8)
        response.raise_for_status()
        return StreamingResponse(
            response.iter_content(chunk_size=1024 * 64),
            media_type=response.headers.get("content-type", "video/mp4"),
        )
    raise HTTPException(status_code=404, detail=recording.error_message or "Recording media is unavailable")


@camera_router.get("/{camera_id}")
def get_camera(
    camera_id: int,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    camera = get_camera_or_404(db, camera_id, current_user.organization_id)
    return serialize_camera(camera)


@camera_router.patch("/{camera_id}")
async def update_camera(
    camera_id: int,
    request: CameraUpdateRequest,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    camera = get_camera_or_404(db, camera_id, current_user.organization_id)
    updates = schema_payload(request)
    for field, value in updates.items():
        setattr(camera, field, value)
    if updates.get("status") == "online":
        camera.last_seen = datetime.utcnow()
    camera.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(camera)
    payload = serialize_camera(camera)
    await manager.broadcast({"event": "camera_updated", **payload})
    return payload


@camera_router.delete("/{camera_id}")
async def delete_camera(
    camera_id: int,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    camera = get_camera_or_404(db, camera_id, current_user.organization_id)
    db.delete(camera)
    db.commit()
    await manager.broadcast({"event": "camera_deleted", "camera_id": camera_id})
    return {"message": "Camera deleted"}


@camera_router.post("/{camera_id}/reconnect")
async def reconnect_camera(
    camera_id: int,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    camera = get_camera_or_404(db, camera_id, current_user.organization_id)
    camera.status = "online"
    camera.status_reason = "Reconnect requested"
    camera.last_seen = datetime.utcnow()
    db.commit()
    payload = serialize_camera(camera)
    await manager.broadcast({"event": "camera_online", **payload})
    return payload


@camera_router.post("/{camera_id}/snapshot")
async def upload_browser_camera_snapshot(
    camera_id: int,
    request: BrowserCameraSnapshotRequest,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    camera = get_camera_or_404(db, camera_id, current_user.organization_id)
    try:
        encoded = request.image_base64.split(",", 1)[-1]
        content = base64.b64decode(encoded)
        snapshot = save_snapshot_bytes(
            db, camera, content, request.motion_device_id, request.reason,
        )
    except Exception as exc:
        snapshot = save_snapshot_bytes(
            db, camera, None, request.motion_device_id, request.reason, str(exc),
        )
    record_event(
        db, "snapshot_captured", current_user.organization_id,
        f"Snapshot captured from {camera.camera_name}",
        {"camera_id": camera.id, "snapshot_id": snapshot.id, "reason": request.reason},
    )
    db.commit()
    db.refresh(snapshot)
    payload = serialize_camera_snapshot(snapshot)
    await manager.broadcast({"event": "snapshot_captured", **payload})
    return payload


@camera_router.post("/{camera_id}/recording")
async def upload_browser_camera_recording(
    camera_id: int,
    request: BrowserCameraRecordingRequest,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    camera = get_camera_or_404(db, camera_id, current_user.organization_id)
    mime = request.mime_type or "video/webm"
    suffix = ".webm" if "webm" in mime else ".mp4" if "mp4" in mime else ".bin"
    path = camera_media_file("recordings", camera.organization_id, camera.id, suffix)
    try:
        encoded = request.video_base64.split(",", 1)[-1]
        path.write_bytes(base64.b64decode(encoded))
        status = "finished"
        error_message = None
    except Exception as exc:
        status = "failed"
        error_message = str(exc)

    duration = request.duration_seconds or CAMERA_RECORDING_DURATION_SECONDS
    ended_at = datetime.utcnow()
    recording = models.CameraRecording(
        camera_id=camera.id,
        organization_id=camera.organization_id,
        motion_device_id=request.motion_device_id,
        file_path=str(path) if status == "finished" else None,
        trigger_reason=request.trigger_reason,
        status=status,
        started_at=ended_at - timedelta(seconds=duration),
        ended_at=ended_at,
        duration_seconds=duration,
        error_message=error_message,
    )
    db.add(recording)
    db.flush()
    record_event(
        db, "recording_saved", current_user.organization_id,
        f"Browser webcam recording {status} for {camera.camera_name}",
        {"camera_id": camera.id, "recording_id": recording.id},
    )
    db.commit()
    db.refresh(recording)
    payload = serialize_camera_recording(recording)
    await manager.broadcast({"event": "recording_saved", **payload})
    return payload


@camera_router.get("/{camera_id}/stream")
def camera_stream(
    camera_id: int,
    access_token: str = Query(...),
    db: Session = Depends(get_db),
):
    current_user = current_user_from_query_token(access_token, db)
    camera = get_camera_or_404(db, camera_id, current_user.organization_id)
    if not camera_presence(camera)["is_online"]:
        raise HTTPException(status_code=503, detail=camera.status_reason or "Camera Offline")
    url = validate_camera_remote_url(camera.stream_url)
    try:
        response = requests.get(url, stream=True, timeout=(5, 30))
        response.raise_for_status()
    except requests.RequestException as exc:
        camera.status = "offline"
        camera.status_reason = str(exc)
        db.commit()
        raise HTTPException(status_code=502, detail="Camera stream is unavailable")

    def iter_stream():
        try:
            for chunk in response.iter_content(chunk_size=1024 * 32):
                if chunk:
                    yield chunk
        finally:
            response.close()

    return StreamingResponse(
        iter_stream(),
        media_type=response.headers.get("content-type", "multipart/x-mixed-replace"),
    )


@camera_router.get("/{camera_id}/snapshot")
def camera_live_snapshot(
    camera_id: int,
    access_token: str = Query(...),
    db: Session = Depends(get_db),
):
    current_user = current_user_from_query_token(access_token, db)
    camera = get_camera_or_404(db, camera_id, current_user.organization_id)
    if camera.snapshot_url:
        try:
            response = requests.get(validate_camera_remote_url(camera.snapshot_url), timeout=8)
            response.raise_for_status()
            return Response(response.content, media_type=response.headers.get("content-type", "image/jpeg"))
        except requests.RequestException as exc:
            raise HTTPException(status_code=502, detail=str(exc))
    latest = db.query(models.CameraSnapshot).filter(
        models.CameraSnapshot.camera_id == camera.id,
    ).order_by(models.CameraSnapshot.captured_at.desc()).first()
    if latest and latest.file_path and Path(latest.file_path).exists():
        return Response(Path(latest.file_path).read_bytes(), media_type="image/jpeg")
    raise HTTPException(status_code=404, detail="No snapshot available")


# --- Hardware camera device routes ---

@device_camera_router.post("/provision")
async def provision_camera_device(
    request: CameraProvisionRequest,
    db: Session = Depends(get_db),
):
    chip_id = (request.chip_id or "").strip()
    organization, owner = get_default_provisioning_owner(db)
    esp_module = None

    if chip_id:
        esp_module = db.query(models.EspModule).filter(
            models.EspModule.chip_id == chip_id,
        ).first()
        if not esp_module:
            esp_module = models.EspModule(
                name=f"ESP32-CAM {chip_id}",
                location=request.room or "Camera",
                chip_id=chip_id,
                firmware_version=request.firmware_version,
                esp_uid=secrets.token_hex(8),
                esp_token=hash_secret(secrets.token_hex(32)),
                owner_id=owner.id if owner else None,
                organization_id=organization.id,
            )
            db.add(esp_module)
            db.flush()
        else:
            esp_module.firmware_version = request.firmware_version or esp_module.firmware_version
            esp_module.last_seen = datetime.utcnow()
            organization = esp_module.organization

    camera = None
    if esp_module:
        camera = db.query(models.Camera).filter(
            models.Camera.esp_module_id == esp_module.id,
            models.Camera.organization_id == esp_module.organization_id,
        ).first()

    camera_token = secrets.token_hex(32)
    if camera:
        camera.camera_token = hash_secret(camera_token)
        camera.camera_name = request.camera_name or camera.camera_name
        camera.room = request.room or camera.room
        camera.stream_url = request.stream_url or camera.stream_url
        camera.snapshot_url = request.snapshot_url or camera.snapshot_url
        camera.camera_type = request.camera_type or camera.camera_type
        camera.status = "online"
        camera.status_reason = None
        camera.last_seen = datetime.utcnow()
    else:
        camera = models.Camera(
            organization_id=organization.id,
            esp_module_id=esp_module.id if esp_module else None,
            camera_name=request.camera_name or (f"ESP32-CAM {chip_id}" if chip_id else "Camera"),
            room=request.room,
            camera_uid=f"cam_{secrets.token_hex(8)}",
            camera_token=hash_secret(camera_token),
            stream_url=request.stream_url,
            snapshot_url=request.snapshot_url,
            camera_type=request.camera_type or "mjpeg",
            status="online",
            last_seen=datetime.utcnow(),
        )
        db.add(camera)
        db.flush()

    record_event(
        db, "camera_provisioned", camera.organization_id,
        f"{camera.camera_name} provisioned",
        {"camera_id": camera.id, "camera_name": camera.camera_name, "room": camera.room},
    )
    db.commit()
    db.refresh(camera)

    await manager.broadcast({
        "event": "camera_online",
        "camera_id": camera.id,
        "camera_name": camera.camera_name,
        "room": camera.room,
    })

    return {
        **serialize_camera(camera),
        "camera_uid": camera.camera_uid,
        "camera_token": camera_token,
        "message": "Camera provisioned",
    }


@device_camera_router.post("/auth")
async def authenticate_camera_device(
    request: CameraAuthRequest,
    db: Session = Depends(get_db),
):
    camera = authenticate_camera(request, db)
    camera.status = "online"
    camera.status_reason = None
    camera.last_seen = datetime.utcnow()
    record_event(
        db, "camera_online", camera.organization_id,
        f"{camera.camera_name} authenticated",
        {"camera_id": camera.id, "camera_name": camera.camera_name},
    )
    db.commit()
    await manager.broadcast({
        "event": "camera_online",
        "camera_id": camera.id,
        "camera_name": camera.camera_name,
    })
    return serialize_camera(camera)


@device_camera_router.post("/heartbeat")
async def camera_heartbeat(
    request: CameraHeartbeatRequest,
    db: Session = Depends(get_db),
):
    camera = authenticate_camera(request, db)
    if request.stream_url:
        camera.stream_url = request.stream_url
    if request.snapshot_url:
        camera.snapshot_url = request.snapshot_url
    camera.status = request.status or "online"
    camera.status_reason = request.status_reason
    camera.last_seen = datetime.utcnow()
    db.commit()
    payload = serialize_camera(camera)
    await manager.broadcast({"event": "camera_online", **payload})
    return payload


@device_camera_router.post("/snapshot")
async def upload_camera_snapshot_device(
    request: CameraSnapshotUploadRequest,
    db: Session = Depends(get_db),
):
    camera = authenticate_camera(request, db)
    content = None
    error_message = None
    try:
        if request.image_base64:
            encoded = request.image_base64.split(",", 1)[-1]
            content = base64.b64decode(encoded)
        elif request.image_url:
            response = requests.get(validate_camera_remote_url(request.image_url), timeout=8)
            response.raise_for_status()
            content = response.content
    except Exception as exc:
        error_message = str(exc)

    snapshot = save_snapshot_bytes(
        db, camera, content, request.motion_device_id, request.reason, error_message,
    )
    if request.image_url and content:
        snapshot.external_url = request.image_url
    camera.last_seen = datetime.utcnow()
    db.commit()
    db.refresh(snapshot)
    payload = serialize_camera_snapshot(snapshot)
    await manager.broadcast({"event": "snapshot_captured", **payload})
    return payload


@device_camera_router.post("/recording")
async def upload_camera_recording_device(
    request: CameraRecordingRequest,
    db: Session = Depends(get_db),
):
    camera = authenticate_camera(request, db)
    recording = models.CameraRecording(
        camera_id=camera.id,
        organization_id=camera.organization_id,
        motion_device_id=request.motion_device_id,
        external_url=request.recording_url,
        status=request.status,
        duration_seconds=request.duration_seconds or CAMERA_RECORDING_DURATION_SECONDS,
        error_message=request.error_message,
    )
    if request.status == "finished":
        recording.ended_at = datetime.utcnow()
    db.add(recording)
    camera.last_seen = datetime.utcnow()
    db.commit()
    db.refresh(recording)
    payload = serialize_camera_recording(recording)
    await manager.broadcast({"event": "recording_saved", **payload})
    return payload


# --- User data routes ---

@user_router.get("/settings")
def get_settings(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    settings = ensure_user_settings(db, current_user)
    db.commit()
    return serialize_settings(settings)


@user_router.patch("/settings")
async def update_settings(
    request: SettingsUpdate,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    settings = ensure_user_settings(db, current_user)
    updates = schema_payload(request)
    if "dashboard_preferences" in updates and updates["dashboard_preferences"] is not None:
        updates["dashboard_preferences"] = json.dumps(updates["dashboard_preferences"])
    for field, value in updates.items():
        setattr(settings, field, value)
    settings.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(settings)
    payload = serialize_settings(settings)
    await manager.broadcast({"event": "settings_updated", "user_id": current_user.id, "settings": payload})
    return payload


@user_router.get("/profiles")
def get_profile(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    profile = ensure_user_profile(db, current_user)
    db.commit()
    return serialize_profile(profile, current_user)


@user_router.patch("/profiles")
async def update_profile(
    request: ProfileUpdate,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    profile = ensure_user_profile(db, current_user)
    updates = schema_payload(request)
    for field, value in updates.items():
        setattr(profile, field, value)
    profile.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(profile)
    payload = serialize_profile(profile, current_user)
    await manager.broadcast({"event": "profile_updated", "user_id": current_user.id, "profile": payload})
    return payload


@user_router.post("/profiles/photo")
async def upload_profile_photo(
    request: ProfilePhotoUpload,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    profile = ensure_user_profile(db, current_user)
    try:
        encoded = request.image_base64.split(",", 1)[-1]
        content = base64.b64decode(encoded)
        folder = PROFILE_MEDIA_DIR / str(current_user.organization_id)
        folder.mkdir(parents=True, exist_ok=True)
        path = folder / f"user_{current_user.id}.jpg"
        path.write_bytes(content)
        profile.photo_path = str(path)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Profile photo upload failed: {exc}")
    profile.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(profile)
    payload = serialize_profile(profile, current_user)
    await manager.broadcast({"event": "profile_updated", "user_id": current_user.id, "profile": payload})
    return payload


@user_router.get("/profile/photo")
def get_profile_photo(
    access_token: str = Query(...),
    db: Session = Depends(get_db),
):
    current_user = current_user_from_query_token(access_token, db)
    profile = ensure_user_profile(db, current_user)
    db.commit()
    if not profile.photo_path or not Path(profile.photo_path).exists():
        raise HTTPException(status_code=404, detail="Profile photo not found")
    return Response(Path(profile.photo_path).read_bytes(), media_type="image/jpeg")


@user_router.get("/provisioning/history")
def list_provisioning_history(
    limit: int = 100,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rows = db.query(models.ProvisioningHistory).filter(
        models.ProvisioningHistory.organization_id == current_user.organization_id,
    ).order_by(models.ProvisioningHistory.created_at.desc()).limit(min(limit, 200)).all()
    return [serialize_provisioning_history(row) for row in rows]


@user_router.post("/provisioning/history")
async def add_provisioning_history(
    request: ProvisioningHistoryCreate,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = create_provisioning_history(
        db,
        current_user.organization_id,
        request.type,
        name=request.name,
        created_by=current_user.id,
        device_id=request.device_id,
        esp_module_id=request.esp_module_id,
        camera_id=request.camera_id,
        status=request.status,
        payload=request.payload,
    )
    db.commit()
    db.refresh(row)
    payload = serialize_provisioning_history(row)
    await manager.broadcast({"event": "provisioning_history_created", **payload})
    return payload


@user_router.delete("/provisioning/history")
async def clear_provisioning_history(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    db.query(models.ProvisioningHistory).filter(
        models.ProvisioningHistory.organization_id == current_user.organization_id,
    ).delete(synchronize_session=False)
    db.commit()
    await manager.broadcast({"event": "provisioning_history_cleared"})
    return {"message": "Provisioning history cleared"}


@user_router.get("/known-people")
def list_known_people(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    people = db.query(models.KnownPerson).filter(
        models.KnownPerson.organization_id == current_user.organization_id,
    ).order_by(models.KnownPerson.created_at.desc()).all()
    return [serialize_known_person(person) for person in people]


@user_router.post("/known-people")
async def create_known_person(
    request: KnownPersonCreate,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    person = models.KnownPerson(
        organization_id=current_user.organization_id,
        name=request.name,
        notes=request.notes,
    )
    if request.photo_base64:
        try:
            encoded = request.photo_base64.split(",", 1)[-1]
            content = base64.b64decode(encoded)
            folder = KNOWN_PEOPLE_MEDIA_DIR / str(current_user.organization_id)
            folder.mkdir(parents=True, exist_ok=True)
            path = folder / f"person_{secrets.token_hex(6)}.jpg"
            path.write_bytes(content)
            person.photo_path = str(path)
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"Photo upload failed: {exc}")
    db.add(person)
    db.commit()
    db.refresh(person)
    payload = serialize_known_person(person)
    await manager.broadcast({"event": "known_person_created", **payload})
    return payload


@user_router.patch("/known-people/{person_id}")
async def update_known_person(
    person_id: int,
    request: KnownPersonUpdate,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    person = db.query(models.KnownPerson).filter(
        models.KnownPerson.id == person_id,
        models.KnownPerson.organization_id == current_user.organization_id,
    ).first()
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")
    updates = schema_payload(request)
    if "photo_base64" in updates:
        photo_base64 = updates.pop("photo_base64")
        if photo_base64:
            try:
                encoded = photo_base64.split(",", 1)[-1]
                content = base64.b64decode(encoded)
                folder = KNOWN_PEOPLE_MEDIA_DIR / str(current_user.organization_id)
                folder.mkdir(parents=True, exist_ok=True)
                path = folder / f"person_{person.id}.jpg"
                path.write_bytes(content)
                person.photo_path = str(path)
            except Exception as exc:
                raise HTTPException(status_code=400, detail=f"Photo upload failed: {exc}")
    for field, value in updates.items():
        setattr(person, field, value)
    person.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(person)
    payload = serialize_known_person(person)
    await manager.broadcast({"event": "known_person_updated", **payload})
    return payload


@user_router.delete("/known-people/{person_id}")
async def delete_known_person(
    person_id: int,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    person = db.query(models.KnownPerson).filter(
        models.KnownPerson.id == person_id,
        models.KnownPerson.organization_id == current_user.organization_id,
    ).first()
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")
    db.delete(person)
    db.commit()
    await manager.broadcast({"event": "known_person_deleted", "person_id": person_id})
    return {"message": "Person deleted"}


@user_router.get("/notifications")
def list_notifications(
    limit: int = 50,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    notifications = db.query(models.Notification).filter(
        models.Notification.user_id == current_user.id,
    ).order_by(models.Notification.created_at.desc()).limit(min(limit, 100)).all()
    return [serialize_notification(item) for item in notifications]


def seed_esp_demo_devices(esp_module, organization, owner, db):
    """Create default child devices for an ESP module and return plaintext tokens."""
    seeded_devices = []
    for name, device_type, room in [
        ("Living Room Light", "light", "Living Room"),
        ("Bedroom Fan", "fan", "Bedroom"),
        ("Motion Sensor", "motion_sensor", "Hallway"),
    ]:
        device_token = secrets.token_hex(32)
        device = models.Device(
            name=name,
            device_type=device_type,
            room=room,
            device_uid=secrets.token_hex(8),
            device_token=hash_secret(device_token),
            owner_id=owner.id if owner else None,
            organization_id=organization.id,
            esp_module_id=esp_module.id,
        )
        db.add(device)
        db.flush()
        seeded_devices.append({
            "device_id": device.id,
            "device_name": device.name,
            "device_type": device.device_type,
            "room": device.room,
            "device_uid": device.device_uid,
            "device_token": device_token,
            "state": device.current_state,
        })
    return seeded_devices


def refresh_esp_device_tokens(esp_module, db):
    """Rotate child device tokens and return plaintext values for the ESP."""
    seeded_devices = []
    for device in esp_module.devices:
        device_token = secrets.token_hex(32)
        device.device_token = hash_secret(device_token)
        seeded_devices.append({
            "device_id": device.id,
            "device_name": device.name,
            "device_type": device.device_type,
            "room": device.room,
            "device_uid": device.device_uid,
            "device_token": device_token,
            "state": device.current_state,
        })
    return seeded_devices


def register_esp_provision_route(app):
    """Zero-touch ESP provisioning used by simulator.py."""

    @app.post("/esp/provision")
    def esp_provision(request: EspProvisionRequest, db: Session = Depends(get_db)):
        organization, owner = get_default_provisioning_owner(db)
        chip_id = request.chip_id.strip()

        esp_module = db.query(models.EspModule).filter(
            models.EspModule.chip_id == chip_id,
        ).first()

        esp_token = secrets.token_hex(32)
        if esp_module:
            esp_module.esp_token = hash_secret(esp_token)
            esp_module.firmware_version = request.firmware_version or esp_module.firmware_version
            esp_module.last_seen = datetime.utcnow()
            if esp_module.devices:
                seeded_devices = refresh_esp_device_tokens(esp_module, db)
            else:
                seeded_devices = seed_esp_demo_devices(esp_module, organization, owner, db)
        else:
            esp_module = models.EspModule(
                name=f"ESP {chip_id}",
                location="Auto-provisioned",
                chip_id=chip_id,
                firmware_version=request.firmware_version,
                esp_uid=secrets.token_hex(8),
                esp_token=hash_secret(esp_token),
                owner_id=owner.id if owner else None,
                organization_id=organization.id,
            )
            db.add(esp_module)
            db.flush()
            seeded_devices = seed_esp_demo_devices(esp_module, organization, owner, db)

        record_event(
            db, "esp_provisioned", esp_module.organization_id,
            f"{esp_module.name} auto-provisioned",
            {"esp_id": esp_module.id, "chip_id": chip_id},
        )
        db.commit()
        db.refresh(esp_module)

        return {
            "esp_id": esp_module.id,
            "esp_uid": esp_module.esp_uid,
            "esp_token": esp_token,
            "devices": seeded_devices,
            "message": "ESP module provisioned",
        }


def setup(app):
    app.include_router(camera_router)
    app.include_router(device_camera_router)
    app.include_router(user_router)
    app.include_router(schedules_router, prefix="/schedules", tags=["schedules"])
    register_esp_provision_route(app)

    @app.on_event("startup")
    async def start_background_tasks():
        app.state.camera_recording_task = asyncio.create_task(camera_recording_maintenance_loop())
        app.state.schedule_runner_task = asyncio.create_task(schedule_runner_loop(manager.broadcast))

    @app.on_event("shutdown")
    async def stop_background_tasks():
        for attr in ("camera_recording_task", "schedule_runner_task"):
            task = getattr(app.state, attr, None)
            if task:
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass
