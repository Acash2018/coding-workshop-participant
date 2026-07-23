"""
Authentication and authorisation.

Password hashing uses hashlib.scrypt from the standard library rather than
bcrypt or argon2. Both of those ship compiled extensions, and this service has
already been broken twice by wheels built for the wrong interpreter - a
dependency that cannot be mis-built is worth more here than a marginally more
fashionable KDF. scrypt is memory-hard and part of Python itself.

Tokens are signed with HS256 via PyJWT, which is pure Python and therefore
carries no architecture risk either.
"""

import base64
import hashlib
import hmac
import logging
import os
import secrets
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from core import database as db

logger = logging.getLogger()

ALGORITHM = "HS256"
TOKEN_TTL = timedelta(hours=8)

# scrypt parameters. n is the cost factor; 2**14 keeps a single hash around
# 50-100ms on Lambda's CPU, which is slow enough to make guessing expensive and
# fast enough not to dominate a login request.
_SCRYPT_N = 2**14
_SCRYPT_R = 8
_SCRYPT_P = 1
_KEY_LEN = 32

ROLES = ("ADMIN", "PROJECT_MANAGER", "TEAM_LEAD", "VIEWER")

_DEV_SECRET = "dev-only-insecure-secret-change-me"


def _secret() -> str:
    """
    Returns the token signing secret.

    Falls back to a fixed development value when JWT_SECRET is absent so the
    stack runs locally out of the box. The fallback is logged loudly on every
    call rather than silently accepted, because a deployed service signing
    tokens with a published constant would let anyone mint an admin token.

    Returns:
        str: The signing secret.
    """
    configured = os.getenv("JWT_SECRET", "").strip()
    if configured:
        return configured
    if os.getenv("IS_LOCAL", "false") != "true":
        logger.error(
            "JWT_SECRET is not set. Falling back to the development secret; "
            "tokens issued here are forgeable. Set JWT_SECRET in the Lambda "
            "environment (see infra/locals.tf)."
        )
    return _DEV_SECRET


def hash_password(password: str) -> str:
    """
    Hashes a password with a fresh random salt.

    Args:
        password: The plaintext password.

    Returns:
        str: A self-describing digest of the form
            "scrypt$n$r$p$<salt-b64>$<hash-b64>", so the parameters travel with
            the hash and can be raised later without invalidating old records.
    """
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(
        password.encode(), salt=salt, n=_SCRYPT_N, r=_SCRYPT_R, p=_SCRYPT_P,
        dklen=_KEY_LEN,
    )
    return "$".join(
        [
            "scrypt",
            str(_SCRYPT_N),
            str(_SCRYPT_R),
            str(_SCRYPT_P),
            base64.b64encode(salt).decode(),
            base64.b64encode(digest).decode(),
        ]
    )


def verify_password(password: str, stored: str) -> bool:
    """
    Checks a password against a stored digest.

    Parameters are read back from the digest, so hashes written with older
    settings keep verifying after the cost factor is raised.

    Args:
        password: The plaintext password supplied at login.
        stored: The digest produced by hash_password.

    Returns:
        bool: True when the password matches.
    """
    try:
        scheme, n, r, p, salt_b64, hash_b64 = stored.split("$")
        if scheme != "scrypt":
            return False
        expected = base64.b64decode(hash_b64)
        actual = hashlib.scrypt(
            password.encode(),
            salt=base64.b64decode(salt_b64),
            n=int(n), r=int(r), p=int(p), dklen=len(expected),
        )
    except (ValueError, TypeError):
        # A malformed digest is a failed login, not a 500.
        return False
    # Constant time: a plain == leaks how much of the hash matched via timing.
    return hmac.compare_digest(actual, expected)


def create_access_token(user: dict[str, Any]) -> str:
    """
    Issues a signed token for a user.

    The role is embedded as a claim so authorisation needs no database round
    trip. The trade is that a role change only takes effect at the next login -
    acceptable for an 8 hour token, and noted here so it is a decision rather
    than an accident.

    Args:
        user: Row from app_users with id, email and role.

    Returns:
        str: The encoded JWT.
    """
    now = datetime.now(UTC)
    payload = {
        "sub": str(user["id"]),
        "email": user["email"],
        "role": user["role"],
        "name": user["display_name"],
        "iat": now,
        "exp": now + TOKEN_TTL,
    }
    return jwt.encode(payload, _secret(), algorithm=ALGORITHM)


def decode_token(token: str) -> dict[str, Any]:
    """
    Verifies a token's signature and expiry.

    Args:
        token: The encoded JWT.

    Returns:
        dict: The decoded claims.

    Raises:
        HTTPException: 401 when the token is expired, forged or malformed.
    """
    try:
        return jwt.decode(token, _secret(), algorithms=[ALGORITHM])
    except jwt.ExpiredSignatureError as exc:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "Token has expired",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc
    except jwt.InvalidTokenError as exc:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc


_bearer = HTTPBearer(auto_error=False)


def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> dict[str, Any]:
    """
    Resolves the caller from the Authorization header.

    Args:
        credentials: Bearer credentials extracted by FastAPI.

    Returns:
        dict: The token's claims.

    Raises:
        HTTPException: 401 when no usable credentials are present.
    """
    if credentials is None:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return decode_token(credentials.credentials)


CurrentUser = Annotated[dict[str, Any], Depends(get_current_user)]

# A bare authentication requirement, for use as a router-level dependency on
# read endpoints - every caller must be signed in, but any role may read.
RequireAuth = Depends(get_current_user)

# Role groups, named after what they may do rather than who they are, so a
# route reads as its intent. Mirrors the app_users comment in data/schema.sql:
# managers own initiatives; staffers additionally cover team leads, who manage
# allocations.
MANAGERS = ("ADMIN", "PROJECT_MANAGER")
STAFFERS = ("ADMIN", "PROJECT_MANAGER", "TEAM_LEAD")


def require_roles(*allowed: str):
    """
    Builds a dependency that admits only the given roles.

    Args:
        *allowed: Role names permitted to call the endpoint.

    Returns:
        Callable: A FastAPI dependency raising 403 for everyone else.
    """
    unknown = set(allowed) - set(ROLES)
    if unknown:
        # A typo here would silently lock everyone out, so fail at import time.
        raise ValueError(f"Unknown role(s): {sorted(unknown)}")

    def guard(user: CurrentUser) -> dict[str, Any]:
        """
        Rejects callers whose role is not permitted.

        Args:
            user: Claims resolved from the bearer token.

        Returns:
            dict: The caller's claims, unchanged.

        Raises:
            HTTPException: 403 when the role is not allowed.
        """
        if user.get("role") not in allowed:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                f"Requires one of: {', '.join(allowed)}",
            )
        return user

    return Depends(guard)


def authenticate(email: str, password: str) -> dict[str, Any] | None:
    """
    Verifies credentials against app_users.

    A missing user and a wrong password are deliberately indistinguishable to
    the caller, and the hash is computed either way so response timing does not
    reveal which addresses are registered.

    Args:
        email: The address supplied at login.
        password: The plaintext password supplied at login.

    Returns:
        dict | None: The user row on success, None otherwise.
    """
    row = db.query_one(
        "SELECT id, email, display_name, role, password_hash, is_active "
        "FROM app_users WHERE email = %(email)s",
        {"email": email},
    )
    stored = row["password_hash"] if row else hash_password(secrets.token_hex(16))
    if not verify_password(password, stored):
        return None
    if row is None or not row["is_active"]:
        return None

    db.query_one(
        "UPDATE app_users SET last_login_at = now() WHERE id = %(id)s RETURNING id",
        {"id": row["id"]},
    )
    return row
