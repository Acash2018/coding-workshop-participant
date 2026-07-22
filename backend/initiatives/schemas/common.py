"""Response envelopes shared across resources."""

from pydantic import BaseModel


class Page[T](BaseModel):
    """A single page of results."""

    items: list[T]
    total: int
    limit: int
    offset: int


class ErrorResponse(BaseModel):
    """Uniform error body."""

    detail: str
