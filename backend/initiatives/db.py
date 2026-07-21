"""

SQL connectivity and error translation for the initiatives service.

The connection is held in a module-level variable so it survives between Lambda
invocations within the same container, which avoids paying connection setup on
every warm request.

NOTE: Terraform bundles each folder under backend/ independently, so this module
cannot be imported from a shared package - it is duplicated per service by
design. Keep edits in sync across services.
"""

import logging
import os
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

import psycopg
from psycopg.rows import dict_row

logger = logging.getLogger()
logger.setLevel(logging.INFO)

IS_LOCAL = os.getenv("IS_LOCAL", "false") == "true"

# Aurora requires SSL; the local development instance does not offer it.
_SSL_MODE = "prefer" if IS_LOCAL else "require"

PG_CONFIG = (
    f"host={os.getenv('POSTGRES_HOST', 'localhost')} "
    f"port={os.getenv('POSTGRES_PORT', '5432')} "
    f"user={os.getenv('POSTGRES_USER', 'postgres')} "
    f"password={os.getenv('POSTGRES_PASS', 'postgres123')} "
    f"dbname={os.getenv('POSTGRES_NAME', 'postgres')} "
    f"sslmode={_SSL_MODE} "
    f"connect_timeout=15"
)

# Reused across invocations within one Lambda container.
_CONNECTION: psycopg.Connection | None = None


class ConflictError(Exception):
    """A database constraint rejected the write. Maps to HTTP 409."""


class NotFoundError(Exception):
    """A referenced row does not exist. Maps to HTTP 404."""


def _connect() -> psycopg.Connection:
    """
    Returns a live connection, reconnecting if the pooled one has been closed.

    Returns:
        psycopg.Connection: An open connection with dict row factory.
    """
    global _CONNECTION
    if _CONNECTION is None or _CONNECTION.closed:
        logger.info("Opening new PostgreSQL connection")
        _CONNECTION = psycopg.connect(PG_CONFIG, row_factory=dict_row, autocommit=True)
    return _CONNECTION


@contextmanager
def cursor() -> Iterator[psycopg.Cursor]:
    """
    Yields a cursor, translating database constraint errors into domain errors.

    This is where the schema's guarantees become HTTP semantics. In particular
    the allocation capacity trigger raises with SQLSTATE 23514, which surfaces
    here as a ConflictError carrying the trigger's own message - so the API
    returns a usable "Dana Reyes would be committed at 120% on 2026-03-01"
    rather than an opaque 500.

    Yields:
        psycopg.Cursor: A cursor on the pooled connection.

    Raises:
        ConflictError: On unique or check constraint violations.
        NotFoundError: On foreign key violations.
    """
    global _CONNECTION
    conn = _connect()
    try:
        with conn.cursor() as cur:
            yield cur
    except psycopg.errors.UniqueViolation as exc:
        raise ConflictError(_clean(exc)) from exc
    except psycopg.errors.CheckViolation as exc:
        raise ConflictError(_clean(exc)) from exc
    except psycopg.errors.ForeignKeyViolation as exc:
        raise NotFoundError(_clean(exc)) from exc
    except psycopg.OperationalError:
        # Connection is unusable; drop it so the next invocation reconnects.
        _CONNECTION = None
        raise


def _clean(exc: psycopg.Error) -> str:
    """
    Extracts the human-readable portion of a psycopg error.

    Args:
        exc: The raised database error.

    Returns:
        str: The primary message, without the CONTEXT and DETAIL noise.
    """
    diag = exc.diag
    message = (diag.message_primary or str(exc)).strip()
    if diag.message_hint:
        message = f"{message} ({diag.message_hint.strip()})"
    return message


def query_all(sql: str, params: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    """
    Runs a SELECT and returns every row.

    Args:
        sql: The statement to execute.
        params: Named parameters referenced as %(name)s in the statement.

    Returns:
        list[dict]: Rows as dictionaries, empty if none matched.
    """
    with cursor() as cur:
        cur.execute(sql, params or {})
        return cur.fetchall()


def query_one(sql: str, params: dict[str, Any] | None = None) -> dict[str, Any] | None:
    """
    Runs a statement and returns the first row, if any.

    Args:
        sql: The statement to execute.
        params: Named parameters referenced as %(name)s in the statement.

    Returns:
        dict | None: The first row, or None if the statement matched nothing.
    """
    with cursor() as cur:
        cur.execute(sql, params or {})
        return cur.fetchone()
