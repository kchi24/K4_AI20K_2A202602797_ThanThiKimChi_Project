import logging
import time
import uuid

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from src.config import get_settings
from src.observability import observe_http

logger = logging.getLogger("pacewise.http")


class ProductionSecurityMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        settings = get_settings()
        started = time.perf_counter()
        request_id = request.headers.get("x-request-id") or str(uuid.uuid4())
        request.state.request_id = request_id
        proto = request.headers.get("x-forwarded-proto", request.url.scheme).split(",")[0].strip()
        if settings.force_https and request.url.path != "/health" and proto != "https":
            return JSONResponse({"detail": "HTTPS is required"}, status_code=400)
        response = await call_next(request)
        duration = time.perf_counter() - started
        if settings.metrics_enabled:
            observe_http(request.method, request.url.path, response.status_code, duration)
        logger.info(
            "request_complete method=%s path=%s status=%s duration_ms=%.2f request_id=%s",
            request.method,
            request.url.path,
            response.status_code,
            duration * 1000,
            request_id,
        )
        response.headers["X-Request-ID"] = request_id
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        response.headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"
        if proto == "https":
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        return response
