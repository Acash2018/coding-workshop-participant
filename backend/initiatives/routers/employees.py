"""
The resource pool: people who can be committed to initiatives.

NOTE ON PLACEMENT. Employees are their own domain and would ideally be their own
service. They live here because Terraform derives each Lambda's URL from its
folder name (backend/<name> serves /api/<name>), so a separate service means a
new function, its own dependency install and a redeploy. These routes are
mounted under /api/initiatives/employees as a deliberate trade: staffing an
initiative is unusable without them. Split them out when the deploy cost is
affordable.
"""

from fastapi import APIRouter, HTTPException, Query, status

from core import database as db, security
from schemas import Employee, EmployeeCreate

router = APIRouter(tags=["employees"], dependencies=[security.RequireAuth])

COLUMNS = """
    id, employee_number, full_name, email, department, job_title,
    employment_type, weekly_capacity_hours, hourly_rate, is_active
"""


@router.get("/employees", response_model=list[Employee])
def list_employees(
    q: str | None = Query(None, description="Case-insensitive search on name and number"),
) -> list[dict]:
    """
    Lists active employees.

    Args:
        q: Optional substring matched against full name and employee number.

    Returns:
        list[dict]: Active employees in name order.
    """
    return db.query_all(
        f"""
        SELECT {COLUMNS} FROM employees
         WHERE is_active
           AND (%(q)s::text IS NULL
                OR full_name ILIKE %(q)s::text
                OR employee_number ILIKE %(q)s::text)
         ORDER BY full_name
        """,
        {"q": f"%{q}%" if q else None},
    )


@router.post("/employees", response_model=Employee, status_code=status.HTTP_201_CREATED)
def create_employee(
    payload: EmployeeCreate,
    _auth: dict = security.require_roles(*security.MANAGERS),
) -> dict:
    """
    Adds a person to the resource pool.

    A duplicate employee number or email is rejected by a unique constraint and
    surfaces as a 409 rather than being checked here, so two concurrent requests
    cannot both pass a check and then both insert.

    Args:
        payload: The new employee.

    Returns:
        dict: The stored record, including its generated id.
    """
    return db.query_one(
        f"""
        INSERT INTO employees (
            employee_number, full_name, email, department, job_title,
            employment_type, weekly_capacity_hours, hourly_rate
        ) VALUES (
            %(employee_number)s, %(full_name)s, %(email)s, %(department)s,
            %(job_title)s, %(employment_type)s, %(weekly_capacity_hours)s,
            %(hourly_rate)s
        )
        RETURNING {COLUMNS}
        """,
        payload.model_dump(mode="json"),
    )


@router.get("/employees/{employee_id}", response_model=Employee)
def get_employee(employee_id: int) -> dict:
    """
    Fetches a single employee.

    Args:
        employee_id: Primary key.

    Returns:
        dict: The stored record.

    Raises:
        HTTPException: 404 if no such employee exists.
    """
    row = db.query_one(
        f"SELECT {COLUMNS} FROM employees WHERE id = %(id)s", {"id": employee_id}
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"No employee {employee_id}")
    return row
