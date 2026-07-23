"""
HTTP routers, one per domain concern.

Import order matters and is asserted in app.py rather than here - see the note
on route precedence there.
"""

from routers import (
    allocations,
    auth,
    costs,
    employees,
    initiatives,
    milestones,
    reporting,
)

__all__ = [
    "allocations",
    "auth",
    "costs",
    "employees",
    "initiatives",
    "milestones",
    "reporting",
]
