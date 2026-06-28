from __future__ import annotations

import json
from datetime import datetime

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from . import models
from .schedule_schemas import ScheduleCreate, ScheduleUpdate
from .scheduler_service import compute_next_run, now_utc


def _schema_updates(schema) -> dict:
    if hasattr(schema, "model_dump"):
        return schema.model_dump(exclude_unset=True)
    return schema.dict(exclude_unset=True)


def _serialize_schedule(schedule: models.Schedule) -> dict:
    return {
        "schedule_id": schedule.id,
        "scene_id": schedule.scene_id,
        "scene_name": schedule.scene.name if schedule.scene else None,
        "name": schedule.name,
        "enabled": schedule.enabled,
        "repeat_type": schedule.repeat_type,
        "days_of_week": schedule.days_of_week,
        "execution_time": schedule.execution_time,
        "start_date": schedule.start_date,
        "end_date": schedule.end_date,
        "timezone": schedule.timezone,
        "next_run": schedule.next_run,
        "last_run": schedule.last_run,
        "created_at": schedule.created_at,
        "updated_at": schedule.updated_at,
    }


def _serialize_execution(execution: models.ScheduleExecution) -> dict:
    return {
        "execution_id": execution.id,
        "schedule_id": execution.schedule_id,
        "scene_id": execution.scene_id,
        "scene_name": execution.scene_name,
        "executed_at": execution.executed_at,
        "success": execution.success,
        "commands_created": execution.commands_created,
        "error_message": execution.error_message,
    }


def _get_or_404(db: Session, schedule_id: int, organization_id: int) -> models.Schedule:
    schedule = db.query(models.Schedule).filter(
        models.Schedule.id == schedule_id,
        models.Schedule.organization_id == organization_id,
    ).first()
    if not schedule:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Schedule not found")
    return schedule


def _get_scene_or_404(db: Session, scene_id: int, organization_id: int) -> models.Scene:
    scene = db.query(models.Scene).filter(
        models.Scene.id == scene_id,
        models.Scene.organization_id == organization_id,
    ).first()
    if not scene:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Scene not found")
    return scene


def _validate_execution_time(value: str | None) -> None:
    if not value:
        raise HTTPException(status_code=400, detail="execution_time is required")
    try:
        hour, minute = (int(part) for part in value.split(":", 1))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="execution_time must use HH:MM format")
    if hour < 0 or hour > 23 or minute < 0 or minute > 59:
        raise HTTPException(status_code=400, detail="execution_time must be a valid 24-hour time")


def _record_event(
    db: Session,
    event_type: str,
    organization_id: int,
    message: str,
    payload: dict | None = None,
) -> None:
    db.add(models.AppEvent(
        organization_id=organization_id,
        event_type=event_type,
        message=message,
        payload=json.dumps(payload or {}, default=str),
    ))


def create_schedule(db: Session, payload: ScheduleCreate, organization_id: int) -> dict:
    _get_scene_or_404(db, payload.scene_id, organization_id)
    _validate_execution_time(payload.execution_time)

    schedule = models.Schedule(
        organization_id=organization_id,
        scene_id=payload.scene_id,
        name=payload.name.strip(),
        enabled=payload.enabled,
        repeat_type=payload.repeat_type,
        days_of_week=payload.days_of_week,
        execution_time=payload.execution_time,
        start_date=payload.start_date,
        end_date=payload.end_date,
        timezone=payload.timezone,
    )
    schedule.next_run = compute_next_run(schedule) if schedule.enabled else None
    db.add(schedule)
    db.flush()
    _record_event(
        db,
        "schedule_created",
        organization_id,
        f"{schedule.name} schedule created",
        {"schedule_id": schedule.id, "scene_id": schedule.scene_id},
    )
    db.commit()
    db.refresh(schedule)
    return _serialize_schedule(schedule)


def list_schedules(
    db: Session,
    organization_id: int,
    enabled: bool | None = None,
    skip: int = 0,
    limit: int = 100,
) -> list[dict]:
    query = db.query(models.Schedule).filter(models.Schedule.organization_id == organization_id)
    if enabled is not None:
        query = query.filter(models.Schedule.enabled == enabled)
    schedules = query.order_by(
        models.Schedule.next_run.is_(None),
        models.Schedule.next_run.asc(),
        models.Schedule.created_at.desc(),
    ).offset(skip).limit(limit).all()
    return [_serialize_schedule(schedule) for schedule in schedules]


def get_schedule(db: Session, schedule_id: int, organization_id: int) -> dict:
    return _serialize_schedule(_get_or_404(db, schedule_id, organization_id))


def update_schedule(
    db: Session,
    schedule_id: int,
    organization_id: int,
    payload: ScheduleUpdate,
) -> dict:
    schedule = _get_or_404(db, schedule_id, organization_id)
    update_data = _schema_updates(payload)
    if "scene_id" in update_data and update_data["scene_id"] is not None:
        _get_scene_or_404(db, update_data["scene_id"], organization_id)
    if "execution_time" in update_data and update_data["execution_time"] is not None:
        _validate_execution_time(update_data["execution_time"])
    if "name" in update_data and update_data["name"] is not None:
        update_data["name"] = update_data["name"].strip()

    timing_fields = {
        "enabled",
        "repeat_type",
        "days_of_week",
        "execution_time",
        "start_date",
        "end_date",
        "timezone",
    }
    changed_timing = any(field in update_data for field in timing_fields)
    for field, value in update_data.items():
        setattr(schedule, field, value)
    schedule.updated_at = datetime.utcnow()
    if changed_timing:
        schedule.next_run = compute_next_run(schedule) if schedule.enabled else None

    _record_event(
        db,
        "schedule_updated",
        organization_id,
        f"{schedule.name} schedule updated",
        {"schedule_id": schedule.id, "changes": update_data},
    )
    db.commit()
    db.refresh(schedule)
    return _serialize_schedule(schedule)


def delete_schedule(db: Session, schedule_id: int, organization_id: int) -> None:
    schedule = _get_or_404(db, schedule_id, organization_id)
    schedule_name = schedule.name
    db.query(models.ScheduleExecution).filter(
        models.ScheduleExecution.schedule_id == schedule.id,
    ).delete()
    db.delete(schedule)
    _record_event(
        db,
        "schedule_deleted",
        organization_id,
        f"{schedule_name} schedule deleted",
        {"schedule_id": schedule_id},
    )
    db.commit()


def enable_schedule(db: Session, schedule_id: int, organization_id: int) -> dict:
    schedule = _get_or_404(db, schedule_id, organization_id)
    schedule.enabled = True
    schedule.next_run = compute_next_run(schedule)
    schedule.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(schedule)
    return _serialize_schedule(schedule)


def disable_schedule(db: Session, schedule_id: int, organization_id: int) -> dict:
    schedule = _get_or_404(db, schedule_id, organization_id)
    schedule.enabled = False
    schedule.next_run = None
    schedule.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(schedule)
    return _serialize_schedule(schedule)


def execute_schedule(
    db: Session,
    schedule: models.Schedule,
    triggered_by: str,
    advance_schedule: bool,
) -> dict:
    now = now_utc()
    commands_created = 0
    success = False
    error_message = None
    created_commands = []

    try:
        scene = _get_scene_or_404(db, schedule.scene_id, schedule.organization_id)
        actions = db.query(models.SceneAction).filter(
            models.SceneAction.scene_id == scene.id,
        ).all()

        for action in actions:
            device = db.query(models.Device).filter(
                models.Device.id == action.device_id,
                models.Device.organization_id == schedule.organization_id,
            ).first()
            if not device:
                continue
            command = models.DeviceCommand(
                device_id=device.id,
                organization_id=device.organization_id,
                command_type=action.command_type,
                payload=action.payload,
            )
            db.add(command)
            db.flush()
            commands_created += 1
            created_commands.append({
                "device_id": device.id,
                "device_name": device.name,
                "command_id": command.id,
                "command_type": command.command_type,
                "payload": command.payload,
                "status": command.status,
            })
        success = True
    except Exception as exc:
        error_message = str(exc)

    execution = models.ScheduleExecution(
        schedule_id=schedule.id,
        organization_id=schedule.organization_id,
        scene_id=schedule.scene_id,
        scene_name=schedule.scene.name if schedule.scene else None,
        executed_at=now,
        success=success,
        commands_created=commands_created,
        error_message=error_message,
    )
    db.add(execution)

    if advance_schedule:
        schedule.last_run = now
        if schedule.repeat_type == models.RepeatType.once.value:
            schedule.enabled = False
            schedule.next_run = None
        else:
            schedule.next_run = compute_next_run(schedule, after=now)
        schedule.updated_at = datetime.utcnow()

    _record_event(
        db,
        "schedule_executed",
        schedule.organization_id,
        f"{schedule.name} schedule executed",
        {
            "schedule_id": schedule.id,
            "scene_id": schedule.scene_id,
            "commands": created_commands,
            "triggered_by": triggered_by,
            "success": success,
            "error": error_message,
        },
    )
    db.commit()
    db.refresh(schedule)

    return {
        "schedule_id": schedule.id,
        "schedule_name": schedule.name,
        "scene_id": schedule.scene_id,
        "success": success,
        "commands_created": commands_created,
        "error_message": error_message,
        "commands": created_commands,
    }


def run_schedule_now(db: Session, schedule_id: int, organization_id: int) -> dict:
    schedule = _get_or_404(db, schedule_id, organization_id)
    result = execute_schedule(db, schedule, triggered_by="manual", advance_schedule=False)
    if not result["success"]:
        raise HTTPException(status_code=500, detail=result["error_message"] or "Schedule failed")
    return {
        "schedule_id": schedule_id,
        "scene_id": schedule.scene_id,
        "commands_created": result["commands_created"],
        "message": f"Scene executed immediately - {result['commands_created']} command(s) queued",
    }


def list_executions(
    db: Session,
    schedule_id: int,
    organization_id: int,
    limit: int = 50,
) -> list[dict]:
    _get_or_404(db, schedule_id, organization_id)
    executions = db.query(models.ScheduleExecution).filter(
        models.ScheduleExecution.schedule_id == schedule_id,
        models.ScheduleExecution.organization_id == organization_id,
    ).order_by(models.ScheduleExecution.executed_at.desc()).limit(limit).all()
    return [_serialize_execution(execution) for execution in executions]
