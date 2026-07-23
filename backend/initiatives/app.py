"""
FastAPI application for the initiatives service.

Assembles the routers and turns database constraint violations into HTTP
responses. All business logic lives in routers/; all connectivity in core/.

Routes are declared at bare paths ("/", "/{initiative_id}"). The
/api/initiatives prefix is stripped before routing - see function.py for why
that is necessary and how it stays correct in both local and deployed
environments.
"""

import logging

from fastapi import FastAPI, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from core import database as db
from routers import (
    allocations,
    auth,
    costs,
    employees,
    initiatives,
    milestones,
    reporting,
)
from schemas import ErrorResponse

logger = logging.getLogger()

app = FastAPI(
    title="ACME Initiatives Service",
    description="CRUD, staffing and portfolio reporting for initiatives.",
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

# ORDER IS SIGNIFICANT. FastAPI matches routes in registration order, so any
# router with literal paths must be registered before one with a greedy
# parameter at the same depth. "/status" and "/health" would otherwise be
# captured by "/{initiative_id}" and fail as a 422 rather than reaching their
# handlers. The initiatives router goes last because its patterns are the
# greediest.
app.include_router(auth.router)
app.include_router(reporting.router)
app.include_router(employees.router)
app.include_router(milestones.router)
app.include_router(costs.router)
app.include_router(allocations.router)
app.include_router(initiatives.router)


def _json(code: int, detail: str) -> Response:
    """
    Builds a JSON error response.

    Args:
        code: HTTP status code.
        detail: Human-readable explanation.

    Returns:
        Response: The encoded body.
    """
    return JSONResponse(status_code=code, content={"detail": detail})


@app.exception_handler(db.ConflictError)
def handle_conflict(_request, exc: db.ConflictError) -> Response:
    """
    Turns a database constraint rejection into a 409 carrying its message.

    This is how the 40-hour capacity rule reaches the user: the trigger's own
    text names the person, the percentage and the date it would be breached.

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
