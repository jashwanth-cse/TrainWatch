"""Minimal in-process ASGI request harness for offline API tests."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlsplit

from fastapi import FastAPI
from starlette.types import Message, Scope


@dataclass(frozen=True, slots=True)
class AsgiResponse:
    """Collected HTTP response from one direct ASGI invocation."""

    status_code: int
    headers: dict[str, str]
    body: bytes

    @property
    def text(self) -> str:
        """Decode the UTF-8 response body."""
        return self.body.decode("utf-8")

    def json(self) -> Any:
        """Decode a JSON response body."""
        return json.loads(self.body)


async def request(
    app: FastAPI,
    method: str,
    target: str,
    *,
    headers: dict[str, str] | None = None,
    json_body: object | None = None,
    raise_app_exceptions: bool = True,
) -> AsgiResponse:
    """Invoke an ASGI app without opening sockets or creating client threads."""
    url = urlsplit(target)
    body = b"" if json_body is None else json.dumps(json_body).encode("utf-8")
    raw_headers = [(key.lower().encode(), value.encode()) for key, value in (headers or {}).items()]
    if json_body is not None:
        raw_headers.append((b"content-type", b"application/json"))
    scope: Scope = {
        "type": "http",
        "asgi": {"version": "3.0", "spec_version": "2.4"},
        "http_version": "1.1",
        "method": method.upper(),
        "scheme": "http",
        "path": url.path,
        "raw_path": url.path.encode(),
        "query_string": url.query.encode(),
        "root_path": "",
        "headers": raw_headers,
        "client": ("127.0.0.1", 12345),
        "server": ("testserver", 80),
    }
    request_sent = False
    messages: list[Message] = []

    async def receive() -> Message:
        nonlocal request_sent
        if not request_sent:
            request_sent = True
            return {"type": "http.request", "body": body, "more_body": False}
        return {"type": "http.disconnect"}

    async def send(message: Message) -> None:
        messages.append(message)

    try:
        await app(scope, receive, send)
    except Exception:
        if raise_app_exceptions or not messages:
            raise
    start = next(message for message in messages if message["type"] == "http.response.start")
    response_body = b"".join(
        message.get("body", b"") for message in messages if message["type"] == "http.response.body"
    )
    response_headers = {
        key.decode("latin-1"): value.decode("latin-1") for key, value in start["headers"]
    }
    return AsgiResponse(start["status"], response_headers, response_body)
