from __future__ import annotations

import asyncio
import http.client
import ipaddress
import json
import os
import socket
import ssl
import time
from dataclasses import dataclass
from typing import Any, Literal
from urllib.parse import urlsplit

WEB_FETCH_TOOL_SCHEMA: dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "web_fetch",
        "description": (
            "Fetch a public web page over HTTP(S) and return truncated text "
            "content. Only public http/https URLs are allowed; private, "
            "loopback, link-local, and other internal addresses are blocked."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "url": {
                    "type": "string",
                    "description": "Absolute http:// or https:// URL to fetch.",
                }
            },
            "required": ["url"],
        },
    },
}

MAX_WEB_FETCH_BYTES = 20_000
ALLOWED_SCHEMES = {"http", "https"}
DEFAULT_TIMEOUT_SECONDS = 10.0

# Operator/process-level override for tests only (e.g. pointing web_fetch at a
# real local HTTP server bound to 127.0.0.1). Never read from the request or
# `optional_params` - a remote caller has no way to influence this, since it
# would otherwise defeat the whole point of the SSRF checks below.
_ALLOW_PRIVATE_HOSTS_ENV = "MMD_WEB_FETCH_ALLOW_PRIVATE_HOSTS"

Status = Literal["ok", "error", "blocked"]


@dataclass
class WebFetchResult:
    status: Status
    content: str
    truncated: bool = False
    error: str | None = None


@dataclass
class ToolExecutionResult:
    tool_name: str
    arguments: str
    status: Status
    content: str
    error: str | None = None
    duration_seconds: float = 0.0


def _allowed_private_hosts() -> set[str]:
    raw = os.environ.get(_ALLOW_PRIVATE_HOSTS_ENV, "")
    return {host.strip() for host in raw.split(",") if host.strip()}


def _is_blocked_ip(ip_text: str) -> bool:
    try:
        address = ipaddress.ip_address(ip_text)
    except ValueError:
        return True
    return (
        address.is_private
        or address.is_loopback
        or address.is_link_local
        or address.is_multicast
        or address.is_reserved
        or address.is_unspecified
    )


class _AddressBlocked(Exception):
    pass


def _resolve_pinned_address(hostname: str, port: int) -> str:
    """Resolve `hostname` to a single safe IP, or raise `_AddressBlocked`.

    Rejects the whole hostname if ANY resolved address is private/internal -
    a multi-A-record host that resolves to both a public and a private IP is
    treated as unsafe rather than picking-and-hoping. `hostname` may bypass
    this check only via the test-only `MMD_WEB_FETCH_ALLOW_PRIVATE_HOSTS` env
    var (see module docstring above `_ALLOW_PRIVATE_HOSTS_ENV`).
    """
    infos = socket.getaddrinfo(hostname, port, type=socket.SOCK_STREAM)
    if not infos:
        raise _AddressBlocked("DNS resolution returned no addresses")
    if hostname not in _allowed_private_hosts():
        for info in infos:
            if _is_blocked_ip(info[4][0]):
                raise _AddressBlocked(f"address for {hostname!r} is not a public host")
    return infos[0][4][0]


class _PinnedHTTPConnection(http.client.HTTPConnection):
    """HTTP connection that connects to a pre-validated IP, not the hostname.

    Prevents a DNS-rebinding TOCTOU: the IP used to connect is exactly the one
    already checked by `_resolve_pinned_address`, never re-resolved.
    """

    def __init__(self, hostname: str, resolved_ip: str, port: int, *, timeout: float) -> None:
        super().__init__(hostname, port, timeout=timeout)
        self._resolved_ip = resolved_ip

    def connect(self) -> None:
        self.sock = socket.create_connection((self._resolved_ip, self.port), self.timeout)


class _PinnedHTTPSConnection(http.client.HTTPSConnection):
    """HTTPS connection that connects to a pre-validated IP, using the original
    hostname for TLS SNI and certificate hostname verification."""

    def __init__(self, hostname: str, resolved_ip: str, port: int, *, timeout: float) -> None:
        super().__init__(hostname, port, timeout=timeout)
        self._resolved_ip = resolved_ip

    def connect(self) -> None:
        sock = socket.create_connection((self._resolved_ip, self.port), self.timeout)
        context = self._context or ssl.create_default_context()
        self.sock = context.wrap_socket(sock, server_hostname=self.host)


def _fetch_sync(
    url: str, *, timeout: float = DEFAULT_TIMEOUT_SECONDS, max_bytes: int = MAX_WEB_FETCH_BYTES
) -> WebFetchResult:
    try:
        parts = urlsplit(url)
    except ValueError as error:
        return WebFetchResult(status="error", content="", error=f"invalid URL: {error}")

    scheme = parts.scheme.lower()
    if scheme not in ALLOWED_SCHEMES:
        return WebFetchResult(
            status="blocked", content="", error=f"scheme {scheme!r} is not allowed"
        )
    hostname = parts.hostname
    if not hostname:
        return WebFetchResult(status="error", content="", error="URL has no hostname")
    port = parts.port or (443 if scheme == "https" else 80)
    path = parts.path or "/"
    if parts.query:
        path = f"{path}?{parts.query}"

    try:
        resolved_ip = _resolve_pinned_address(hostname, port)
    except _AddressBlocked as error:
        return WebFetchResult(status="blocked", content="", error=str(error))
    except OSError as error:
        return WebFetchResult(status="error", content="", error=f"DNS resolution failed: {error}")

    connection_cls = _PinnedHTTPSConnection if scheme == "https" else _PinnedHTTPConnection
    conn = connection_cls(hostname, resolved_ip, port, timeout=timeout)
    try:
        conn.request(
            "GET",
            path,
            headers={"Host": hostname, "User-Agent": "mmd-litellm/web_fetch"},
        )
        response = conn.getresponse()
        if 300 <= response.status < 400:
            return WebFetchResult(
                status="error",
                content="",
                error=(
                    f"redirect not followed (HTTP {response.status}); "
                    "fetch the target URL directly"
                ),
            )
        if response.status >= 400:
            return WebFetchResult(
                status="error", content="", error=f"HTTP {response.status}"
            )
        body = response.read(max_bytes + 1)
    except (OSError, TimeoutError, http.client.HTTPException) as error:
        return WebFetchResult(status="error", content="", error=str(error))
    finally:
        conn.close()

    truncated = len(body) > max_bytes
    if truncated:
        body = body[:max_bytes]
    text = body.decode("utf-8", errors="replace")
    return WebFetchResult(status="ok", content=text, truncated=truncated)


async def execute_web_fetch(
    url: str, *, timeout: float = DEFAULT_TIMEOUT_SECONDS, max_bytes: int = MAX_WEB_FETCH_BYTES
) -> WebFetchResult:
    return await asyncio.to_thread(_fetch_sync, url, timeout=timeout, max_bytes=max_bytes)


async def execute_tool_call(call: dict[str, Any]) -> ToolExecutionResult:
    """Execute one OpenAI-shaped tool call. Never raises - always returns a
    result object with `status`/`error` set, consistent with the rest of this
    codebase's degrade-not-crash philosophy for model/tool-facing failures."""
    function = call.get("function") if isinstance(call, dict) else None
    name = function.get("name") if isinstance(function, dict) else None
    arguments_raw = function.get("arguments", "") if isinstance(function, dict) else ""
    if not isinstance(arguments_raw, str):
        arguments_raw = json.dumps(arguments_raw)

    started = time.monotonic()
    if name != "web_fetch":
        return ToolExecutionResult(
            tool_name=str(name or "unknown"),
            arguments=arguments_raw,
            status="error",
            content=f"Error: unknown tool {name!r}",
            error=f"unknown tool: {name!r}",
            duration_seconds=time.monotonic() - started,
        )

    try:
        arguments = json.loads(arguments_raw) if arguments_raw else {}
    except (TypeError, ValueError) as error:
        return ToolExecutionResult(
            tool_name="web_fetch",
            arguments=arguments_raw,
            status="error",
            content=f"Error: invalid arguments JSON ({error})",
            error=f"invalid arguments JSON: {error}",
            duration_seconds=time.monotonic() - started,
        )

    url = arguments.get("url") if isinstance(arguments, dict) else None
    if not isinstance(url, str) or not url:
        return ToolExecutionResult(
            tool_name="web_fetch",
            arguments=arguments_raw,
            status="error",
            content="Error: missing required 'url' argument",
            error="missing required 'url' argument",
            duration_seconds=time.monotonic() - started,
        )

    result = await execute_web_fetch(url)
    duration = time.monotonic() - started
    if result.status == "ok":
        content = result.content
        if result.truncated:
            content += "\n\n[content truncated]"
        return ToolExecutionResult(
            tool_name="web_fetch",
            arguments=arguments_raw,
            status="ok",
            content=content,
            duration_seconds=duration,
        )
    return ToolExecutionResult(
        tool_name="web_fetch",
        arguments=arguments_raw,
        status=result.status,
        content=f"Error: {result.error}",
        error=result.error,
        duration_seconds=duration,
    )
