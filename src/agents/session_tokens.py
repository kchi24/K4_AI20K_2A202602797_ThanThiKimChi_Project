"""Opaque, signed session tokens for the standalone agent API."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from uuid import uuid4


class InvalidSessionTokenError(ValueError):
    pass


def _encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _decode(data: str) -> bytes:
    return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4))


def create_session_token(secret: str, ttl_seconds: int = 86400) -> tuple[str, str]:
    thread_id = f"agent_{uuid4().hex}"
    payload = {"thread_id": thread_id, "iat": int(time.time()), "exp": int(time.time()) + ttl_seconds}
    encoded = _encode(json.dumps(payload, separators=(",", ":")).encode())
    signature = _encode(hmac.new(secret.encode(), encoded.encode(), hashlib.sha256).digest())
    return f"{encoded}.{signature}", thread_id


def verify_session_token(token: str, secret: str) -> str:
    try:
        encoded, supplied_signature = token.split(".", 1)
        expected_signature = _encode(hmac.new(secret.encode(), encoded.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(supplied_signature, expected_signature):
            raise InvalidSessionTokenError("invalid signature")
        payload = json.loads(_decode(encoded))
        if int(payload["exp"]) < int(time.time()):
            raise InvalidSessionTokenError("expired token")
        thread_id = str(payload["thread_id"])
        if not thread_id.startswith("agent_"):
            raise InvalidSessionTokenError("invalid thread")
        return thread_id
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        if isinstance(exc, InvalidSessionTokenError):
            raise
        raise InvalidSessionTokenError("malformed token") from exc
