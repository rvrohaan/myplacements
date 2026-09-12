from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel


class NotificationOut(BaseModel):
    id: int
    type: str
    priority: str
    title: str
    body: Optional[str] = None
    link: Optional[str] = None
    entity_type: Optional[str] = None
    entity_id: Optional[int] = None
    meta: Optional[dict[str, Any]] = None
    # Both are model properties, not columns: `is_read` derives from read_at, and
    # `actor_name` comes off the eager-loaded actor relationship.
    is_read: bool
    actor_name: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


class UnreadCountOut(BaseModel):
    unread: int


class MarkAllReadOut(BaseModel):
    updated: int
    unread: int
