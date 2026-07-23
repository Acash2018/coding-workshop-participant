"""Request and response models for authentication."""

from typing import Annotated, Literal

from pydantic import BaseModel, Field

Role = Literal["ADMIN", "PROJECT_MANAGER", "TEAM_LEAD", "VIEWER"]


class LoginRequest(BaseModel):
    """Credentials supplied at login."""

    email: Annotated[str, Field(min_length=3, max_length=200)]
    password: Annotated[str, Field(min_length=1, max_length=200)]


class TokenResponse(BaseModel):
    """
    An issued access token.

    expires_in is seconds, matching the OAuth2 convention, so a client can
    schedule a refresh without parsing the token itself.
    """

    access_token: str
    token_type: Literal["bearer"] = "bearer"
    expires_in: int
    role: Role
    display_name: str


class CurrentUserResponse(BaseModel):
    """The caller as described by their token."""

    id: int
    email: str
    display_name: str
    role: Role
