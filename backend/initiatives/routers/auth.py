"""
Authentication: exchanging credentials for a bearer token.

There is deliberately no registration endpoint. Accounts are created by an
administrator (see data/create_admin.py for bootstrapping the first one) - an
open sign-up route on an internal delivery tool would be a way in, not a
feature.
"""

import logging

from fastapi import APIRouter, HTTPException, status

from core import security
from schemas import CurrentUserResponse, LoginRequest, TokenResponse

logger = logging.getLogger()

router = APIRouter(tags=["auth"])


@router.post("/auth/login", response_model=TokenResponse)
def login(payload: LoginRequest) -> TokenResponse:
    """
    Exchanges an email and password for an access token.

    Args:
        payload: The supplied credentials.

    Returns:
        TokenResponse: The signed token and the caller's role.

    Raises:
        HTTPException: 401 when the credentials do not match an active account.
    """
    user = security.authenticate(payload.email, payload.password)
    if user is None:
        # One message for both "no such user" and "wrong password": telling
        # them apart hands an attacker a way to enumerate valid addresses.
        logger.warning("Failed login for %s", payload.email)
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return TokenResponse(
        access_token=security.create_access_token(user),
        expires_in=int(security.TOKEN_TTL.total_seconds()),
        role=user["role"],
        display_name=user["display_name"],
    )


@router.get("/auth/me", response_model=CurrentUserResponse)
def read_current_user(user: security.CurrentUser) -> CurrentUserResponse:
    """
    Describes the caller, as a way for a client to validate a stored token.

    Args:
        user: Claims resolved from the bearer token.

    Returns:
        CurrentUserResponse: The caller's identity and role.
    """
    return CurrentUserResponse(
        id=int(user["sub"]),
        email=user["email"],
        display_name=user["name"],
        role=user["role"],
    )
