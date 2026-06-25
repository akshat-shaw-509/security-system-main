from pydantic import BaseModel


class RuleCreate(BaseModel):
    name: str
    device_id: int
    condition_type: str
    operator: str | None = None
    value: str | None = None
    action_device_id: int
    action_command: str


class RuleUpdate(BaseModel):
    name: str | None = None
    device_id: int | None = None
    condition_type: str | None = None
    operator: str | None = None
    value: str | None = None
    action_device_id: int | None = None
    action_command: str | None = None
    is_active: bool | None = None
