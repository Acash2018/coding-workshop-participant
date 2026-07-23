"""
Pydantic models, grouped by resource.

Re-exported here so routers import from one place rather than reaching into
individual modules.
"""

from schemas.allocation import AllocationCreate, AllocationUpdate
from schemas.auth import CurrentUserResponse, LoginRequest, Role, TokenResponse
from schemas.common import ErrorResponse, Page
from schemas.employee import Employee, EmployeeCreate, EmploymentType
from schemas.milestone import MilestoneStatus, MilestoneUpdate
from schemas.initiative import (
    Initiative,
    InitiativeCreate,
    InitiativeStatus,
    InitiativeStatusRow,
    InitiativeUpdate,
    RiskStatus,
)

__all__ = [
    "AllocationCreate",
    "AllocationUpdate",
    "Employee",
    "EmployeeCreate",
    "EmploymentType",
    "CurrentUserResponse",
    "ErrorResponse",
    "LoginRequest",
    "Role",
    "TokenResponse",
    "Initiative",
    "InitiativeCreate",
    "InitiativeStatus",
    "InitiativeStatusRow",
    "InitiativeUpdate",
    "MilestoneStatus",
    "MilestoneUpdate",
    "Page",
    "RiskStatus",
]
