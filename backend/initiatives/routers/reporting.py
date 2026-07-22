"""
Read-only projections that answer portfolio-level questions.

These endpoints do not compute anything. Risk, progress and budget consumption
are derived in database views so every consumer sees the same judgement.
"""

from fastapi import APIRouter, Query

from core import database as db
from schemas import InitiativeStatusRow

router = APIRouter(tags=["reporting"])


@router.get("/health")
def health() -> dict[str, str]:
    """
    Reports service and database reachability.

    Returns:
        dict: Status payload naming the connected database.
    """
    row = db.query_one("SELECT current_database() AS database, version() AS version")
    return {
        "status": "ok",
        "database": row["database"],
        "version": row["version"].split(",")[0],
    }


@router.get("/status", response_model=list[InitiativeStatusRow])
def portfolio_status(
    risk_status: str | None = Query(None, description="Filter by computed risk"),
    department: str | None = Query(None),
) -> list[dict]:
    """
    Returns the portfolio dashboard projection from v_initiative_status.

    Args:
        risk_status: Optional filter, one of ON_TRACK, AT_RISK, OVERDUE, CLOSED.
        department: Optional department filter.

    Returns:
        list[dict]: One row per initiative, ordered worst risk first.
    """
    return db.query_all(
        """
        SELECT id, code, name, department, status, planned_end_date, days_remaining,
               headcount, fte_committed, milestone_count, milestones_complete,
               milestones_behind, milestones_blocked, percent_complete,
               planned_budget, total_consumed, percent_consumed, forecast_overrun,
               risk_status
          FROM v_initiative_status
         -- The ::text casts are required, not cosmetic. A bare parameter that
         -- only ever appears next to NULL gives PostgreSQL nothing to infer a
         -- type from, and it raises AmbiguousParameter (42P08).
         WHERE (%(risk_status)s::text IS NULL OR risk_status = %(risk_status)s::text)
           AND (%(department)s::text IS NULL OR department = %(department)s::text)
         ORDER BY CASE risk_status
                      WHEN 'OVERDUE'  THEN 1
                      WHEN 'AT_RISK'  THEN 2
                      WHEN 'ON_TRACK' THEN 3
                      ELSE 4
                  END,
                  planned_end_date
        """,
        {"risk_status": risk_status, "department": department},
    )
