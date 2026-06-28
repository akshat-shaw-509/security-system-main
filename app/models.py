from enum import Enum

from sqlalchemy import Column, Integer, String, Boolean, ForeignKey, DateTime, Text
from sqlalchemy.orm import relationship
from datetime import datetime
from .database import Base


class Organization(Base):
    __tablename__ = "organizations"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    users = relationship("User", back_populates="organization")
    devices = relationship("Device", back_populates="organization")
    esp_modules = relationship("EspModule", back_populates="organization")


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True)
    email = Column(String, unique=True, index=True, nullable=True)
    phone = Column(String, unique=True, index=True, nullable=True)
    hashed_password = Column(String)
    is_admin = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    password_reset_otp_hash = Column(String, nullable=True)
    password_reset_otp_expires_at = Column(DateTime, nullable=True)
    password_reset_token_hash = Column(String, nullable=True)
    password_reset_expires_at = Column(DateTime, nullable=True)

    organization_id = Column(Integer, ForeignKey("organizations.id"))
    organization = relationship("Organization", back_populates="users")

    devices = relationship("Device", back_populates="owner")


class Device(Base):
    __tablename__ = "devices"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    device_type = Column(String, nullable=False)
    room = Column(String, nullable=True)
    current_state = Column(String, default="OFF")

    device_uid = Column(String, unique=True, index=True, nullable=False)
    device_token = Column(String, unique=True, nullable=False)

    is_active = Column(Boolean, default=True)
    last_seen = Column(DateTime, default=datetime.utcnow)

    owner_id = Column(Integer, ForeignKey("users.id"))
    owner = relationship("User", back_populates="devices")

    organization_id = Column(Integer, ForeignKey("organizations.id"))
    organization = relationship("Organization", back_populates="devices")

    esp_module_id = Column(Integer, ForeignKey("esp_modules.id"), nullable=True)
    esp_module = relationship("EspModule", back_populates="devices")

    telemetry = relationship("DeviceTelemetry", back_populates="device")


class EspModule(Base):
    __tablename__ = "esp_modules"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    location = Column(String, nullable=True)
    chip_id = Column(String, unique=True, index=True, nullable=True)
    firmware_version = Column(String, nullable=True)
    esp_uid = Column(String, unique=True, index=True, nullable=False)
    esp_token = Column(String, unique=True, nullable=False)
    is_active = Column(Boolean, default=True)
    last_seen = Column(DateTime, default=datetime.utcnow)
    created_at = Column(DateTime, default=datetime.utcnow)

    owner_id = Column(Integer, ForeignKey("users.id"))
    organization_id = Column(Integer, ForeignKey("organizations.id"))
    organization = relationship("Organization", back_populates="esp_modules")
    devices = relationship("Device", back_populates="esp_module")


class DeviceTelemetry(Base):
    __tablename__ = "device_telemetry"

    id = Column(Integer, primary_key=True, index=True)

    device_id = Column(Integer, ForeignKey("devices.id"))
    organization_id = Column(Integer, ForeignKey("organizations.id"))

    temperature = Column(String)
    humidity = Column(String)
    motion_detected = Column(Boolean)
    power_w = Column(String, default="0")
    energy_wh = Column(String, default="0")

    created_at = Column(DateTime, default=datetime.utcnow)

    device = relationship("Device", back_populates="telemetry")


class Camera(Base):
    __tablename__ = "cameras"

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(Integer, ForeignKey("organizations.id"), nullable=False)
    esp_module_id = Column(Integer, ForeignKey("esp_modules.id"), nullable=True)

    camera_name = Column(String, nullable=False)
    room = Column(String, nullable=True)
    camera_uid = Column(String, unique=True, index=True, nullable=False)
    camera_token = Column(String, unique=True, nullable=False)
    stream_url = Column(Text, nullable=True)
    snapshot_url = Column(Text, nullable=True)
    camera_type = Column(String, default="mjpeg")
    status = Column(String, default="offline")
    status_reason = Column(String, nullable=True)
    last_seen = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    esp_module = relationship("EspModule")


class CameraSnapshot(Base):
    __tablename__ = "camera_snapshots"

    id = Column(Integer, primary_key=True, index=True)
    camera_id = Column(Integer, ForeignKey("cameras.id"), nullable=False)
    organization_id = Column(Integer, ForeignKey("organizations.id"), nullable=False)
    motion_device_id = Column(Integer, ForeignKey("devices.id"), nullable=True)
    event_id = Column(Integer, ForeignKey("app_events.id"), nullable=True)
    file_path = Column(Text, nullable=True)
    external_url = Column(Text, nullable=True)
    reason = Column(String, default="motion")
    status = Column(String, default="captured")
    error_message = Column(Text, nullable=True)
    captured_at = Column(DateTime, default=datetime.utcnow)

    camera = relationship("Camera")


class CameraRecording(Base):
    __tablename__ = "camera_recordings"

    id = Column(Integer, primary_key=True, index=True)
    camera_id = Column(Integer, ForeignKey("cameras.id"), nullable=False)
    organization_id = Column(Integer, ForeignKey("organizations.id"), nullable=False)
    motion_device_id = Column(Integer, ForeignKey("devices.id"), nullable=True)
    event_id = Column(Integer, ForeignKey("app_events.id"), nullable=True)
    file_path = Column(Text, nullable=True)
    external_url = Column(Text, nullable=True)
    trigger_reason = Column(String, default="motion")
    status = Column(String, default="recording")
    started_at = Column(DateTime, default=datetime.utcnow)
    ended_at = Column(DateTime, nullable=True)
    duration_seconds = Column(Integer, default=30)
    error_message = Column(Text, nullable=True)

    camera = relationship("Camera")


class UserSettings(Base):
    __tablename__ = "user_settings"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), unique=True, nullable=False)
    organization_id = Column(Integer, ForeignKey("organizations.id"), nullable=False)
    home_name = Column(String, nullable=True)
    location = Column(String, nullable=True)
    temperature_unit = Column(String, default="C")
    timezone = Column(String, default="Asia/Kolkata")
    language = Column(String, default="en")
    dark_mode = Column(Boolean, default=True)
    auto_update = Column(Boolean, default=True)
    system_alerts = Column(Boolean, default=True)
    security_alerts = Column(Boolean, default=True)
    voice_feedback = Column(Boolean, default=True)
    dashboard_preferences = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("User")


class UserProfile(Base):
    __tablename__ = "user_profiles"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), unique=True, nullable=False)
    organization_id = Column(Integer, ForeignKey("organizations.id"), nullable=False)
    display_name = Column(String, nullable=True)
    photo_path = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("User")


class ProvisioningHistory(Base):
    __tablename__ = "provisioning_history"

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(Integer, ForeignKey("organizations.id"), nullable=False)
    type = Column(String, nullable=False)
    device_id = Column(Integer, ForeignKey("devices.id"), nullable=True)
    esp_module_id = Column(Integer, ForeignKey("esp_modules.id"), nullable=True)
    camera_id = Column(Integer, ForeignKey("cameras.id"), nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    name = Column(String, nullable=True)
    status = Column(String, default="created")
    payload = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    device = relationship("Device")
    esp_module = relationship("EspModule")
    camera = relationship("Camera")
    user = relationship("User")


class KnownPerson(Base):
    __tablename__ = "known_people"

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(Integer, ForeignKey("organizations.id"), nullable=False)
    name = Column(String, nullable=False)
    photo_path = Column(Text, nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class Notification(Base):
    __tablename__ = "notifications"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    organization_id = Column(Integer, ForeignKey("organizations.id"), nullable=False)
    title = Column(String, nullable=False)
    message = Column(Text, nullable=False)
    read = Column(Boolean, default=False)
    event_type = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    read_at = Column(DateTime, nullable=True)

    user = relationship("User")


class DeviceCommand(Base):
    """
    Lifecycle status values:
      pending   – created, waiting for ESP to poll
      delivered – ESP has polled and received the command
      executed  – ESP confirmed successful execution  ← only now does Device.current_state change
      failed    – ESP reported failure
      expired   – never picked up within the timeout window
    """
    __tablename__ = "device_commands"

    id = Column(Integer, primary_key=True, index=True)

    device_id = Column(Integer, ForeignKey("devices.id"))
    organization_id = Column(Integer, ForeignKey("organizations.id"))

    command_type = Column(String, nullable=False)
    payload = Column(Text, nullable=True)

    # Status: pending → delivered → executed | failed | expired
    status = Column(String, default="pending")
    created_at = Column(DateTime, default=datetime.utcnow)
    delivered_at = Column(DateTime, nullable=True)   # when ESP polled it
    executed_at = Column(DateTime, nullable=True)    # when ESP confirmed success
    failure_reason = Column(Text, nullable=True)     # set on failed status

    device = relationship("Device")


class Room(Base):
    __tablename__ = "rooms"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    organization_id = Column(Integer, ForeignKey("organizations.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class AppEvent(Base):
    __tablename__ = "app_events"

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(Integer, ForeignKey("organizations.id"), nullable=True)
    event_type = Column(String, nullable=False)
    message = Column(String, nullable=True)
    payload = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class Scene(Base):
    __tablename__ = "scenes"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    organization_id = Column(Integer, ForeignKey("organizations.id"))
    created_at = Column(DateTime, default=datetime.utcnow)


class SceneAction(Base):
    __tablename__ = "scene_actions"

    id = Column(Integer, primary_key=True, index=True)
    scene_id = Column(Integer, ForeignKey("scenes.id"))
    device_id = Column(Integer, ForeignKey("devices.id"))
    command_type = Column(String, nullable=False)
    payload = Column(Text, nullable=True)


class RepeatType(str, Enum):
    once = "once"
    daily = "daily"
    weekly = "weekly"
    monthly = "monthly"


class Schedule(Base):
    __tablename__ = "schedules"

    id = Column(Integer, primary_key=True, index=True)
    organization_id = Column(Integer, ForeignKey("organizations.id"), nullable=False)
    scene_id = Column(Integer, ForeignKey("scenes.id"), nullable=False)

    name = Column(String, nullable=False)
    enabled = Column(Boolean, default=True)
    repeat_type = Column(String, default=RepeatType.daily.value, nullable=False)
    days_of_week = Column(String, nullable=True)
    execution_time = Column(String, nullable=False)
    start_date = Column(DateTime, nullable=True)
    end_date = Column(DateTime, nullable=True)
    timezone = Column(String, default="Asia/Kolkata", nullable=False)
    next_run = Column(DateTime, nullable=True)
    last_run = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    scene = relationship("Scene")
    executions = relationship("ScheduleExecution", back_populates="schedule")


class ScheduleExecution(Base):
    __tablename__ = "schedule_executions"

    id = Column(Integer, primary_key=True, index=True)
    schedule_id = Column(Integer, ForeignKey("schedules.id"), nullable=False)
    organization_id = Column(Integer, ForeignKey("organizations.id"), nullable=False)
    scene_id = Column(Integer, ForeignKey("scenes.id"), nullable=False)
    scene_name = Column(String, nullable=True)
    executed_at = Column(DateTime, default=datetime.utcnow)
    success = Column(Boolean, default=True)
    commands_created = Column(Integer, default=0)
    error_message = Column(Text, nullable=True)

    schedule = relationship("Schedule", back_populates="executions")


class AutomationRule(Base):
    __tablename__ = "automation_rules"

    id = Column(Integer, primary_key=True, index=True)

    name = Column(String, nullable=False)
    organization_id = Column(Integer, ForeignKey("organizations.id"))

    device_id = Column(Integer, ForeignKey("devices.id"))  # sensor device

    condition_type = Column(String, nullable=False)  
    # "motion", "temperature", "humidity"

    operator = Column(String, nullable=True)  
    # ">", "<", "="

    value = Column(String, nullable=True)  
    # threshold value

    action_device_id = Column(Integer, ForeignKey("devices.id"))
    action_command = Column(String, nullable=False)

    is_active = Column(Boolean, default=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    

class AutomationRuleActivity(Base):
    __tablename__ = "automation_rule_activity"

    id = Column(Integer, primary_key=True, index=True)

    rule_id = Column(Integer, ForeignKey("automation_rules.id"))
    organization_id = Column(Integer, ForeignKey("organizations.id"))

    sensor_device_id = Column(Integer, ForeignKey("devices.id"))
    action_device_id = Column(Integer, ForeignKey("devices.id"))
    command_id = Column(Integer, ForeignKey("device_commands.id"))

    trigger_type = Column(String, nullable=False)
    observed_value = Column(String, nullable=True)
    action_command = Column(String, nullable=False)

    created_at = Column(DateTime, default=datetime.utcnow)