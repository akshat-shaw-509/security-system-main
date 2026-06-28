from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from . import models
from .auth import get_current_user, get_db
from .schedule_schemas import (
    ScheduleCreate,
    ScheduleExecutionOut,
    ScheduleListOut,
    ScheduleOut,
    ScheduleRunOut,
    ScheduleUpdate,
)
from . import schedule_service
from .websocket_manager import manager

router = APIRouter()


def _org(current_user: models.User) -> int:
    return current_user.organization_id


@router.post("", response_model=ScheduleOut, status_code=status.HTTP_201_CREATED)
async def create_schedule(
    payload: ScheduleCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    schedule = schedule_service.create_schedule(db, payload, _org(current_user))
    await manager.broadcast({
        "event": "schedule_created",
        "schedule_id": schedule["schedule_id"],
        "schedule_name": schedule["name"],
        "scene_id": schedule["scene_id"],
    })
    return schedule


@router.get("", response_model=ScheduleListOut)
def list_schedules(
    enabled: Optional[bool] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    schedules = schedule_service.list_schedules(
        db,
        _org(current_user),
        enabled=enabled,
        skip=skip,
        limit=limit,
    )
    return {"schedules": schedules, "total": len(schedules)}


@router.get("/{schedule_id}", response_model=ScheduleOut)
def get_schedule(
    schedule_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    return schedule_service.get_schedule(db, schedule_id, _org(current_user))


@router.patch("/{schedule_id}", response_model=ScheduleOut)
async def update_schedule(
    schedule_id: int,
    payload: ScheduleUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    schedule = schedule_service.update_schedule(db, schedule_id, _org(current_user), payload)
    await manager.broadcast({
        "event": "schedule_updated",
        "schedule_id": schedule["schedule_id"],
        "schedule_name": schedule["name"],
        "scene_id": schedule["scene_id"],
    })
    return schedule


@router.delete("/{schedule_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_schedule(
    schedule_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    schedule_service.delete_schedule(db, schedule_id, _org(current_user))
    await manager.broadcast({"event": "schedule_deleted", "schedule_id": schedule_id})


@router.post("/{schedule_id}/enable", response_model=ScheduleOut)
async def enable_schedule(
    schedule_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    schedule = schedule_service.enable_schedule(db, schedule_id, _org(current_user))
    await manager.broadcast({
        "event": "schedule_updated",
        "schedule_id": schedule["schedule_id"],
        "schedule_name": schedule["name"],
        "enabled": True,
    })
    return schedule


@router.post("/{schedule_id}/disable", response_model=ScheduleOut)
async def disable_schedule(
    schedule_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    schedule = schedule_service.disable_schedule(db, schedule_id, _org(current_user))
    await manager.broadcast({
        "event": "schedule_updated",
        "schedule_id": schedule["schedule_id"],
        "schedule_name": schedule["name"],
        "enabled": False,
    })
    return schedule


@router.post("/{schedule_id}/run", response_model=ScheduleRunOut)
async def run_schedule_now(
    schedule_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    result = schedule_service.run_schedule_now(db, schedule_id, _org(current_user))
    await manager.broadcast({
        "event": "schedule_executed",
        "schedule_id": result["schedule_id"],
        "scene_id": result["scene_id"],
        "commands_created": result["commands_created"],
        "triggered_by": "manual",
    })
    return result


@router.get("/{schedule_id}/history", response_model=list[ScheduleExecutionOut])
def get_schedule_history(
    schedule_id: int,
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    return schedule_service.list_executions(db, schedule_id, _org(current_user), limit)
