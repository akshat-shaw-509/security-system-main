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


class DeviceCommand(Base):
    __tablename__ = "device_commands"

    id = Column(Integer, primary_key=True, index=True)

    device_id = Column(Integer, ForeignKey("devices.id"))
    organization_id = Column(Integer, ForeignKey("organizations.id"))

    command_type = Column(String, nullable=False)
    payload = Column(Text, nullable=True)

    status = Column(String, default="pending")
    created_at = Column(DateTime, default=datetime.utcnow)
    executed_at = Column(DateTime, nullable=True)

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
        
