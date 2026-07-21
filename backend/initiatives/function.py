"""
Lambda entrypoint for the initiatives service.

Terraform hardcodes the Python handler as "function.handler" (see
infra/locals.tf), so this module must expose a symbol by that name. Mangum
adapts the ASGI application to the Lambda event/response shape.

Path handling
-------------
The same code sees two different request paths depending on where it runs:

    deployed  CloudFront routes /api/initiatives* to this function's URL and
              forwards the full URI, so the event path is
              /api/initiatives/42

    local     bin/proxy-server.js splits on /api/{service} and forwards only
              what follows, so the event path is
              /42

Setting api_gateway_base_path reconciles the two. Mangum strips the prefix only
when the path actually starts with it, so the deployed path is trimmed to /42
and the already-trimmed local path passes through untouched. Routes in app.py
are therefore declared once, at bare paths.
"""

from typing import Any

from mangum import Mangum

from app import app

BASE_PATH = "/api/initiatives"

_adapter = Mangum(app, api_gateway_base_path=BASE_PATH, lifespan="off")


def _normalise_path(event: dict[str, Any]) -> None:
    """
    Ensures the request path is still non-empty once the base path is stripped.

    Mangum returns "/" for an empty *input* path but does not re-check after
    stripping, so a collection request to /api/initiatives becomes "" and
    matches no route - a 404 that appears only once deployed, because the local
    proxy strips the prefix itself and never produces this shape. Appending the
    trailing slash keeps both environments on the same route.

    Args:
        event: The Lambda event, modified in place.
    """
    for container, key in ((event, "rawPath"), (event, "path")):
        if container.get(key) == BASE_PATH:
            container[key] = f"{BASE_PATH}/"

    http = event.get("requestContext", {}).get("http", {})
    if http.get("path") == BASE_PATH:
        http["path"] = f"{BASE_PATH}/"


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """
    Lambda entrypoint.

    Args:
        event: API Gateway or Function URL event.
        context: Lambda context object.

    Returns:
        dict: The HTTP response in Lambda's expected shape.
    """
    _normalise_path(event)
    return _adapter(event, context)
