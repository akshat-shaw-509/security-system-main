import json

from sqlalchemy.orm import Session

from . import models


def schema_payload(schema) -> dict:
    if hasattr(schema, "model_dump"):
        return schema.model_dump(exclude_unset=True)
    return schema.dict(exclude_unset=True)


def record_event(
    db: Session,
    event_type: str,
    organization_id: int | None = None,
    message: str | None = None,
    payload: dict | None = None,
) -> models.AppEvent:
    event = models.AppEvent(
        organization_id=organization_id,
        event_type=event_type,
        message=message,
        payload=json.dumps(payload or {}),
    )
    db.add(event)
    return event


def serialize_event(event: models.AppEvent) -> dict:
    try:
        payload = json.loads(event.payload or "{}")
    except json.JSONDecodeError:
        payload = {}

    return {
        "event": event.event_type,
        "message": event.message,
        "payload": payload,
        "created_at": event.created_at,
    }
