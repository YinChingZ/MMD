import asyncio
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from mmd_litellm import tools


def test_is_blocked_ip_blocks_private_and_special_ranges():
    for ip_text in (
        "10.0.0.1",
        "172.16.0.5",
        "192.168.1.1",
        "127.0.0.1",
        "169.254.169.254",  # cloud metadata endpoint
        "224.0.0.1",  # multicast
        "0.0.0.0",  # unspecified
        "::1",
        "fc00::1",
        "fe80::1",
    ):
        assert tools._is_blocked_ip(ip_text) is True, ip_text


def test_is_blocked_ip_allows_public_shaped_addresses():
    for ip_text in ("93.184.216.34", "8.8.8.8", "2606:4700:4700::1111"):
        assert tools._is_blocked_ip(ip_text) is False, ip_text


def test_is_blocked_ip_blocks_unparseable_input():
    assert tools._is_blocked_ip("not-an-ip") is True


def test_execute_web_fetch_rejects_disallowed_scheme():
    result = asyncio.run(tools.execute_web_fetch("ftp://example.com/file"))
    assert result.status == "blocked"
    assert "scheme" in result.error


def test_execute_web_fetch_blocks_loopback_without_env_override(monkeypatch):
    monkeypatch.delenv(tools._ALLOW_PRIVATE_HOSTS_ENV, raising=False)
    result = asyncio.run(tools.execute_web_fetch("http://127.0.0.1:1/anything"))
    assert result.status == "blocked"
    assert "not a public host" in result.error


def test_execute_web_fetch_blocks_cloud_metadata_address():
    result = asyncio.run(
        tools.execute_web_fetch("http://169.254.169.254/latest/meta-data/")
    )
    assert result.status == "blocked"


class _Handler(BaseHTTPRequestHandler):
    def do_GET(self):  # noqa: N802 - required BaseHTTPRequestHandler name
        if self.path == "/ok":
            body = b"hello from local test server"
            self.send_response(200)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif self.path == "/redirect":
            self.send_response(302)
            self.send_header("Location", "/ok")
            self.end_headers()
        elif self.path == "/big":
            body = b"x" * 100_000
            self.send_response(200)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif self.path == "/slow":
            import time

            time.sleep(1.0)
            self.send_response(200)
            self.send_header("Content-Length", "2")
            self.end_headers()
            self.wfile.write(b"ok")
        elif self.path == "/not-found":
            self.send_response(404)
            self.end_headers()
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, *args):  # silence test output
        pass


@pytest.fixture
def local_http_server(monkeypatch):
    server = ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    monkeypatch.setenv(tools._ALLOW_PRIVATE_HOSTS_ENV, "127.0.0.1")
    try:
        yield f"http://127.0.0.1:{server.server_address[1]}"
    finally:
        server.shutdown()
        thread.join(timeout=5)


def test_execute_web_fetch_returns_ok_content_from_real_local_server(local_http_server):
    result = asyncio.run(tools.execute_web_fetch(f"{local_http_server}/ok"))
    assert result.status == "ok"
    assert result.content == "hello from local test server"
    assert result.truncated is False


def test_execute_web_fetch_does_not_follow_redirects(local_http_server):
    result = asyncio.run(tools.execute_web_fetch(f"{local_http_server}/redirect"))
    assert result.status == "error"
    assert "redirect" in result.error


def test_execute_web_fetch_truncates_oversized_response(local_http_server):
    result = asyncio.run(
        tools.execute_web_fetch(f"{local_http_server}/big", max_bytes=100)
    )
    assert result.status == "ok"
    assert result.truncated is True
    assert len(result.content) == 100


def test_execute_web_fetch_degrades_gracefully_on_timeout(local_http_server):
    result = asyncio.run(
        tools.execute_web_fetch(f"{local_http_server}/slow", timeout=0.2)
    )
    assert result.status == "error"
    assert result.error


def test_execute_web_fetch_reports_http_error_status(local_http_server):
    result = asyncio.run(tools.execute_web_fetch(f"{local_http_server}/not-found"))
    assert result.status == "error"
    assert "404" in result.error


def test_execute_tool_call_dispatches_web_fetch(local_http_server):
    call = {
        "id": "call_1",
        "type": "function",
        "function": {
            "name": "web_fetch",
            "arguments": f'{{"url": "{local_http_server}/ok"}}',
        },
    }
    result = asyncio.run(tools.execute_tool_call(call))
    assert result.tool_name == "web_fetch"
    assert result.status == "ok"
    assert result.content == "hello from local test server"
    assert result.error is None


def test_execute_tool_call_rejects_unknown_tool_name():
    call = {"function": {"name": "not_web_fetch", "arguments": "{}"}}
    result = asyncio.run(tools.execute_tool_call(call))
    assert result.status == "error"
    assert "unknown tool" in result.error


def test_execute_tool_call_handles_malformed_arguments_gracefully():
    call = {"function": {"name": "web_fetch", "arguments": "{not valid json"}}
    result = asyncio.run(tools.execute_tool_call(call))
    assert result.status == "error"
    assert "invalid arguments JSON" in result.error


def test_execute_tool_call_handles_missing_url_argument():
    call = {"function": {"name": "web_fetch", "arguments": "{}"}}
    result = asyncio.run(tools.execute_tool_call(call))
    assert result.status == "error"
    assert "url" in result.error
