"""
FastAPI application for the initiatives service.

Routes are declared at bare paths ("/", "/{initiative_id}"). The /api/initiatives
prefix is stripped before routing - see function.py for why that is necessary and
how it stays correct in both local and deployed environments.
"""

import logging

from fastapi import APIRouter, FastAPI, HTTPException, Query, Response, status
from fastapi.middleware.cors import CORSMiddleware

import db
from schemas import (
    ErrorResponse,
    Initiative,
    InitiativeCreate,
    InitiativeStatusRow,
    InitiativeUpdate,
    Page,
)

logger = logging.getLogger()

app = FastAPI(
    title="ACME Initiatives Service",
    description="CRUD and portfolio reporting for initiatives.",
    version="1.0.0",
    responses={
        404: {"model": ErrorResponse},
        409: {"model": ErrorResponse},
    },
)

# CloudFront forwards the Origin header; the Lambda Function URL is also
# configured with permissive CORS in infra/lambda.tf. Tighten both before
# anything resembling production.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

router = APIRouter()

_COLUMNS = """
    id, code, name, department, description, status,
    planned_start_date, planned_end_date, actual_end_date,
    planned_budget, owner_employee_id
"""


@router.get("/health", tags=["ops"])
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


# Declared before /{initiative_id} on purpose. FastAPI matches routes in
# declaration order, and although initiative_id is typed as int, a request to
# /status would match the parameterised route first and fail validation with a
# 422 instead of reaching this handler.
@router.get("/status", response_model=list[InitiativeStatusRow], tags=["reporting"])
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
               percent_consumed, forecast_overrun, risk_status
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


@router.get("/", response_model=Page[Initiative], tags=["initiatives"])
def list_initiatives(
    q: str | None = Query(None, description="Case-insensitive search on code and name"),
    status_filter: str | None = Query(None, alias="status"),
    department: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> Page[Initiative]:
    """
    Lists initiatives with search, filtering and pagination.

    Args:
        q: Optional substring matched against code and name.
        status_filter: Optional lifecycle status filter.
        department: Optional department filter.
        limit: Maximum rows to return.
        offset: Rows to skip.

    Returns:
        Page[Initiative]: The matching page plus the unpaginated total.
    """
    params = {
        "q": f"%{q}%" if q else None,
        "status": status_filter,
        "department": department,
        "limit": limit,
        "offset": offset,
    }
    # See the note in portfolio_status: the ::text casts stop PostgreSQL
    # raising AmbiguousParameter on the "filter is optional" comparisons.
    predicate = """
         WHERE (%(q)s::text IS NULL
                OR code ILIKE %(q)s::text OR name ILIKE %(q)s::text)
           AND (%(status)s::text IS NULL OR status = %(status)s::text)
           AND (%(department)s::text IS NULL OR department = %(department)s::text)
    """
    rows = db.query_all(
        f"SELECT {_COLUMNS} FROM initiatives {predicate} "
        "ORDER BY planned_start_date DESC, id "
        "LIMIT %(limit)s OFFSET %(offset)s",
        params,
    )
    total = db.query_one(f"SELECT COUNT(*) AS n FROM initiatives {predicate}", params)
    return Page[Initiative](
        items=[Initiative(**row) for row in rows],
        total=total["n"],
        limit=limit,
        offset=offset,
    )


@router.get("/{initiative_id}", response_model=Initiative, tags=["initiatives"])
def get_initiative(initiative_id: int) -> Initiative:
    """
    Fetches a single initiative.

    Args:
        initiative_id: Primary key.

    Returns:
        Initiative: The stored record.

    Raises:
        HTTPException: 404 if no such initiative exists.
    """
    row = db.query_one(
        f"SELECT {_COLUMNS} FROM initiatives WHERE id = %(id)s",
        {"id": initiative_id},
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"No initiative {initiative_id}")
    return Initiative(**row)


@router.get("/{initiative_id}/team", tags=["initiatives"])
def get_team(initiative_id: int) -> list[dict]:
    """
    Lists everyone allocated to an initiative, past and present.

    Allocations that have ended are included rather than filtered out - they
    explain historic budget consumption, and hiding them makes a stalled
    initiative look like it never had anyone on it. `active_today` distinguishes
    current staffing from past.

    Args:
        initiative_id: Primary key of the initiative.

    Returns:
        list[dict]: One row per allocation, current allocations first.
    """
    return db.query_all(
        """
        SELECT a.id,
               e.id AS employee_id,
               e.full_name,
               e.department,
               e.employment_type,
               e.weekly_capacity_hours,
               a.allocation_percent,
               a.role_on_initiative,
               a.start_date,
               a.end_date,
               (a.period @> current_date) AS active_today,
               ROUND(a.allocation_percent / 100.0 * e.weekly_capacity_hours, 1)
                   AS hours_per_week
          FROM allocations a
          JOIN employees e ON e.id = a.employee_id
         WHERE a.initiative_id = %(id)s
         ORDER BY (a.period @> current_date) DESC, e.full_name
        """,
        {"id": initiative_id},
    )


@router.get("/{initiative_id}/milestones", tags=["initiatives"])
def get_milestones(initiative_id: int) -> list[dict]:
    """
    Lists an initiative's milestones with derived health and slippage.

    Reads v_milestone_health so BEHIND / AT_RISK are computed in one place
    rather than re-derived from planned_date in the UI.

    Args:
        initiative_id: Primary key of the initiative.

    Returns:
        list[dict]: Milestones in delivery order.
    """
    return db.query_all(
        """
        SELECT m.id,
               m.name,
               m.sequence_no,
               m.status,
               m.health,
               m.planned_date,
               m.actual_date,
               m.days_until_due,
               -- Days late is only meaningful once a milestone has landed.
               CASE WHEN m.actual_date IS NOT NULL
                    THEN m.actual_date - m.planned_date END AS days_variance,
               COALESCE(
                   (SELECT array_agg(p.name ORDER BY p.name)
                      FROM milestone_dependencies d
                      JOIN milestones p ON p.id = d.depends_on_milestone_id
                     WHERE d.milestone_id = m.id),
                   ARRAY[]::text[]
               ) AS depends_on
          FROM v_milestone_health m
         WHERE m.initiative_id = %(id)s
         ORDER BY m.sequence_no, m.planned_date
        """,
        {"id": initiative_id},
    )


@router.post(
    "/",
    response_model=Initiative,
    status_code=status.HTTP_201_CREATED,
    tags=["initiatives"],
)
def create_initiative(payload: InitiativeCreate) -> Initiative:
    """
    Creates an initiative.

    Args:
        payload: The new initiative.

    Returns:
        Initiative: The stored record, including its generated id.
    """
    row = db.query_one(
        f"""
        INSERT INTO initiatives (
            code, name, department, description, status,
            planned_start_date, planned_end_date, planned_budget, owner_employee_id
        ) VALUES (
            %(code)s, %(name)s, %(department)s, %(description)s, %(status)s,
            %(planned_start_date)s, %(planned_end_date)s, %(planned_budget)s,
            %(owner_employee_id)s
        )
        RETURNING {_COLUMNS}
        """,
        payload.model_dump(),
    )
    return Initiative(**row)


@router.patch("/{initiative_id}", response_model=Initiative, tags=["initiatives"])
def update_initiative(initiative_id: int, payload: InitiativeUpdate) -> Initiative:
    """
    Applies a partial update. Fields omitted from the body are left unchanged.

    Args:
        initiative_id: Primary key.
        payload: Fields to change.

    Returns:
        Initiative: The updated record.

    Raises:
        HTTPException: 400 if the body is empty, 404 if the row does not exist.
    """
    changes = payload.model_dump(exclude_unset=True)
    if not changes:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No fields to update")

    assignments = ", ".join(f"{column} = %({column})s" for column in changes)
    row = db.query_one(
        f"UPDATE initiatives SET {assignments} WHERE id = %(id)s RETURNING {_COLUMNS}",
        {**changes, "id": initiative_id},
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"No initiative {initiative_id}")
    return Initiative(**row)


@router.delete(
    "/{initiative_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    tags=["initiatives"],
)
def delete_initiative(initiative_id: int) -> Response:
    """
    Deletes an initiative and, by cascade, its milestones, allocations and costs.

    Args:
        initiative_id: Primary key.

    Returns:
        Response: An empty 204.

    Raises:
        HTTPException: 404 if the row does not exist.
    """
    row = db.query_one(
        "DELETE FROM initiatives WHERE id = %(id)s RETURNING id",
        {"id": initiative_id},
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"No initiative {initiative_id}")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


app.include_router(router)


@app.exception_handler(db.ConflictError)
def handle_conflict(_request, exc: db.ConflictError) -> Response:
    """
    Turns a database constraint rejection into a 409 carrying its message.

    Args:
        _request: Unused, required by the handler signature.
        exc: The raised conflict.

    Returns:
        Response: A 409 whose body is the database's own explanation.
    """
    logger.warning("Conflict: %s", exc)
    return _json(status.HTTP_409_CONFLICT, str(exc))


@app.exception_handler(db.NotFoundError)
def handle_not_found(_request, exc: db.NotFoundError) -> Response:
    """
    Turns a foreign key violation into a 404.

    Args:
        _request: Unused, required by the handler signature.
        exc: The raised reference failure.

    Returns:
        Response: A 404 naming the missing reference.
    """
    logger.warning("Missing reference: %s", exc)
    return _json(status.HTTP_404_NOT_FOUND, str(exc))


def _json(code: int, detail: str) -> Response:
    """
    Builds a JSON error response.

    Args:
        code: HTTP status code.
        detail: Human-readable explanation.

    Returns:
        Response: The encoded body.
    """
    from fastapi.responses import JSONResponse

    return JSONResponse(status_code=code, content={"detail": detail})
