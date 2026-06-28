from __future__ import annotations

import asyncio
import calendar
import logging
from datetime import datetime, timedelta, timezone
from typing import Awaitable, Callable
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy.orm import Session

from .database import SessionLocal
from . import models

logger = logging.getLogger(__name__)

TICK_SECONDS = 30


def now_utc() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _timezone(name: str | None) -> ZoneInfo:
    try:
        return ZoneInfo(name or "Asia/Kolkata")
    except ZoneInfoNotFoundError:
        return ZoneInfo("UTC")


def _repeat_value(schedule: models.Schedule) -> str:
    return str(schedule.repeat_type or models.RepeatType.daily.value).lower()


def _parse_execution_time(value: str | None) -> tuple[int, int] | None:
    if not value:
        return None
    try:
        hour, minute = (int(part) for part in value.split(":", 1))
    except (TypeError, ValueError):
        return None
    if hour < 0 or hour > 23 or minute < 0 or minute > 59:
        return None
    return hour, minute


def _local_to_utc(local_dt: datetime, tzinfo: ZoneInfo) -> datetime:
    return local_dt.replace(tzinfo=tzinfo).astimezone(timezone.utc).replace(tzinfo=None)


def _base_local(after: datetime, tzinfo: ZoneInfo) -> datetime:
    aware = after.replace(tzinfo=timezone.utc)
    return aware.astimezone(tzinfo).replace(tzinfo=None)


def _month_candidate(local_base: datetime, hour: int, minute: int) -> datetime:
    day = min(local_base.day, calendar.monthrange(local_base.year, local_base.month)[1])
    return local_base.replace(day=day, hour=hour, minute=minute, second=0, microsecond=0)


def _next_month(local_dt: datetime) -> datetime:
    month = local_dt.month + 1
    year = local_dt.year
    if month > 12:
        month = 1
        year += 1
    day = min(local_dt.day, calendar.monthrange(year, month)[1])
    return local_dt.replace(year=year, month=month, day=day)


def compute_next_run(
    schedule: models.Schedule,
    after: datetime | None = None,
) -> datetime | None:
    base = after or now_utc()
    parsed_time = _parse_execution_time(schedule.execution_time)
    if parsed_time is None:
        return None

    hour, minute = parsed_time
    tzinfo = _timezone(schedule.timezone)
    local_base = _base_local(base, tzinfo)
    repeat_type = _repeat_value(schedule)

    if repeat_type == models.RepeatType.once.value:
        start_local = schedule.start_date.replace(tzinfo=None) if schedule.start_date else local_base
        candidate_local = start_local.replace(hour=hour, minute=minute, second=0, microsecond=0)
        candidate_utc = _local_to_utc(candidate_local, tzinfo)
        if candidate_utc <= base:
            return None
        if schedule.end_date:
            end_utc = _local_to_utc(schedule.end_date.replace(tzinfo=None), tzinfo)
            if candidate_utc > end_utc:
                return None
        return candidate_utc

    if repeat_type == models.RepeatType.daily.value:
        candidate_local = local_base.replace(hour=hour, minute=minute, second=0, microsecond=0)
        if candidate_local <= local_base:
            candidate_local += timedelta(days=1)
        candidate_utc = _local_to_utc(candidate_local, tzinfo)

    elif repeat_type == models.RepeatType.weekly.value:
        days = [
            int(day)
            for day in (schedule.days_of_week or "").split(",")
            if day.strip().isdigit() and 0 <= int(day) <= 6
        ]
        if not days:
            return None
        candidate_utc = None
        for offset in range(0, 8):
            candidate_day = local_base + timedelta(days=offset)
            if candidate_day.weekday() not in days:
                continue
            candidate_local = candidate_day.replace(hour=hour, minute=minute, second=0, microsecond=0)
            if candidate_local > local_base:
                candidate_utc = _local_to_utc(candidate_local, tzinfo)
                break
        if candidate_utc is None:
            return None

    elif repeat_type == models.RepeatType.monthly.value:
        candidate_local = _month_candidate(local_base, hour, minute)
        if candidate_local <= local_base:
            candidate_local = _next_month(candidate_local)
        candidate_utc = _local_to_utc(candidate_local, tzinfo)

    else:
        return None

    if schedule.end_date:
        end_utc = _local_to_utc(schedule.end_date.replace(tzinfo=None), tzinfo)
        if candidate_utc > end_utc:
            return None
    return candidate_utc


def run_due_schedules(db: Session) -> list[dict]:
    due = db.query(models.Schedule).filter(
        models.Schedule.enabled == True,  # noqa: E712
        models.Schedule.next_run.isnot(None),
        models.Schedule.next_run <= now_utc(),
    ).all()

    results = []
    for schedule in due:
        from .schedule_service import execute_schedule

        results.append(execute_schedule(db, schedule, triggered_by="scheduler", advance_schedule=True))
    return results


async def schedule_runner_loop(
    broadcast: Callable[[dict], Awaitable[None]] | None = None,
) -> None:
    while True:
        try:
            db = SessionLocal()
            try:
                results = run_due_schedules(db)
            finally:
                db.close()

            if broadcast:
                for result in results:
                    await broadcast({
                        "event": "schedule_executed",
                        "schedule_id": result.get("schedule_id"),
                        "schedule_name": result.get("schedule_name"),
                        "scene_id": result.get("scene_id"),
                        "success": result.get("success"),
                        "commands_created": result.get("commands_created"),
                        "triggered_by": "scheduler",
                    })
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Schedule runner tick failed")
        await asyncio.sleep(TICK_SECONDS)
