"""Request models for milestones (deliverable checkpoints)."""

from datetime import date
from typing import Annotated, Literal

from pydantic import BaseModel, Field

MilestoneStatus = Literal[
    "NOT_STARTED", "STARTED", "IN_PROGRESS", "COMPLETED", "BLOCKED"
]


class MilestoneUpdate(BaseModel):
    """
    Payload for editing a milestone.

    Only what a delivery review actually revises: its status, the date it was
    planned for, and the date it landed. Omitted fields are left unchanged.

    The rule that a COMPLETED milestone must carry an actual date is enforced
    in the handler (with the stored values merged in) and by a database CHECK,
    so it holds whether the date arrives in this request or is already stored.
    """

    name: Annotated[str, Field(min_length=1, max_length=200)] | None = None
    status: MilestoneStatus | None = None
    planned_date: date | None = None
    actual_date: date | None = None
