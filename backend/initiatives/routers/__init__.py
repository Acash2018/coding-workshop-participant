"""
HTTP routers, one per domain concern.

Import order matters and is asserted in app.py rather than here - see the note
on route precedence there.
"""

from routers import (
    allocations,
    auth,
    employees,
    initiatives,
    milestones,
    reporting,
)

__all__ = [
    "allocations",
    "auth",
    "employees",
    "initiatives",
    "milestones",
    "reporting",
]
