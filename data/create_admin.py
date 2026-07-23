#!/usr/bin/env python3
"""
Bootstraps the first administrator account.

Deliberately a script and not an endpoint. An HTTP route that mints an admin is
a way into the system whether or not it is guarded, and it would still be there
long after the one time it was needed.

Password hashing is imported from the service rather than reimplemented, so
this script and the login endpoint can never disagree about the digest format.

Usage:
    python data/create_admin.py --email admin@acme.test --name "Ada Admin"

The password may be supplied with --password, but is read interactively when
omitted so it does not land in shell history.
"""

import argparse
import getpass
import os
import sys

SERVICE_DIR = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "backend", "initiatives"
)
sys.path.insert(0, os.path.abspath(SERVICE_DIR))

import psycopg  # noqa: E402  (import after sys.path is extended)
from psycopg.rows import dict_row  # noqa: E402

from core.security import ROLES, hash_password  # noqa: E402


def parse_args() -> argparse.Namespace:
    """
    Reads command line arguments.

    Returns:
        argparse.Namespace: The parsed arguments.
    """
    parser = argparse.ArgumentParser(description="Create or update an app user.")
    parser.add_argument("--email", required=True)
    parser.add_argument("--name", required=True, help="Display name")
    parser.add_argument("--role", default="ADMIN", choices=ROLES)
    parser.add_argument("--password", help="Prompted for when omitted")
    parser.add_argument("--host", default=os.getenv("POSTGRES_HOST", "localhost"))
    parser.add_argument("--port", default=os.getenv("POSTGRES_PORT", "5432"))
    parser.add_argument("--dbname", default=os.getenv("POSTGRES_NAME", "postgres"))
    parser.add_argument("--user", default=os.getenv("POSTGRES_USER", "postgres"))
    parser.add_argument("--dbpassword", default=os.getenv("POSTGRES_PASS", "postgres123"))
    return parser.parse_args()


def main() -> int:
    """
    Creates the account, or resets its password if the email already exists.

    Returns:
        int: Process exit code.
    """
    args = parse_args()
    password = args.password or getpass.getpass("Password: ")
    if not args.password:
        if password != getpass.getpass("Confirm password: "):
            print("Passwords do not match.", file=sys.stderr)
            return 1
    if len(password) < 8:
        print("Password must be at least 8 characters.", file=sys.stderr)
        return 1

    conninfo = (
        f"host={args.host} port={args.port} dbname={args.dbname} "
        f"user={args.user} password={args.dbpassword}"
    )
    with psycopg.connect(conninfo, row_factory=dict_row, autocommit=True) as conn:
        with conn.cursor() as cur:
            # ON CONFLICT makes this safe to re-run: the same command creates
            # the account the first time and resets the password afterwards.
            cur.execute(
                """
                INSERT INTO app_users (email, password_hash, display_name, role)
                VALUES (%(email)s, %(hash)s, %(name)s, %(role)s)
                ON CONFLICT (email) DO UPDATE
                    SET password_hash = EXCLUDED.password_hash,
                        display_name  = EXCLUDED.display_name,
                        role          = EXCLUDED.role,
                        is_active     = true
                RETURNING id, email, display_name, role
                """,
                {
                    "email": args.email,
                    "hash": hash_password(password),
                    "name": args.name,
                    "role": args.role,
                },
            )
            row = cur.fetchone()

    print(f"OK  id={row['id']}  {row['email']}  {row['display_name']}  {row['role']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
