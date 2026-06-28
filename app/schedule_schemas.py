from datetime import datetime
from typing import Literal

from pydantic import BaseModel


RepeatTypeValue = Literal["once", "daily", "weekly", "monthly"]


class ScheduleCreate(BaseModel):
    scene_id: int
    name: str
    enabled: bool = True
    repeat_type: RepeatTypeValue = "daily"
    days_of_week: str | None = None
    execution_time: str
    start_date: datetime | None = None
    end_date: datetime | None = None
    timezone: str = "Asia/Kolkata"


class ScheduleUpdate(BaseModel):
    scene_id: int | None = None
    name: str | None = None
    enabled: bool | None = None
    repeat_type: RepeatTypeValue | None = None
    days_of_week: str | None = None
    execution_time: str | None = None
    start_date: datetime | None = None
    end_date: datetime | None = None
    timezone: str | None = None


class ScheduleOut(BaseModel):
    schedule_id: int
    scene_id: int
    scene_name: str | None = None
    name: str
    enabled: bool
    repeat_type: str
    days_of_week: str | None = None
    execution_time: str
    start_date: datetime | None = None
    end_date: datetime | None = None
    timezone: str
    next_run: datetime | None = None
    last_run: datetime | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class ScheduleListOut(BaseModel):
    schedules: list[ScheduleOut]
    total: int


class ScheduleRunOut(BaseModel):
    schedule_id: int
    scene_id: int
    commands_created: int
    message: str


class ScheduleExecutionOut(BaseModel):
    execution_id: int
    schedule_id: int
    scene_id: int
    scene_name: str | None = None
    executed_at: datetime
    success: bool
    commands_created: int
    error_message: str | None = None
