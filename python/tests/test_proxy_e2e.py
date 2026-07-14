from __future__ import annotations

import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

EXAMPLES_DIR = Path(__file__).resolve().parents[1] / "examples"
SCRIPTED_ANSWER = "Use the LiteLLM-shaped Python provider as the integration path."

NORMAL_HANDLER_PY = "from mmd_litellm.mock_handler import mmd_custom_llm\n"

BASE_CONFIG = """\
model_list:
  - model_name: mmd-fusion-mock
    litellm_params:
      model: mmd/fusion
      analysis_models: [scripted/model-a, scripted/model-b]
      coordinator_model: scripted/model-a
      mmd_mode: standard
      quorum_ratio: 0.66
      per_model_timeout: 10
      max_run_timeout: 30
      max_total_calls: 12
      max_repair_attempts: 1
      return_trace: true
{extra_litellm_params}
litellm_settings:
  custom_provider_map:
    - provider: mmd
      custom_handler: handler.mmd_custom_llm
{extra_litellm_settings}
{extra_sections}
"""

NORMAL_MESSAGES = [{"role": "user", "content": "What should we build next?"}]


def _config(extra_litellm_params="", extra_litellm_settings="", extra_sections=""):
    return BASE_CONFIG.format(
        extra_litellm_params=extra_litellm_params,
        extra_litellm_settings=extra_litellm_settings,
        extra_sections=extra_sections,
    )


def test_proxy_normal_scripted_completion_returns_trace(start_proxy):
    proxy = start_proxy(EXAMPLES_DIR, config_filename="litellm_mock_config.yaml")

    status, body = proxy.request(
        "/chat/completions",
        {"model": "mmd-fusion-mock", "messages": NORMAL_MESSAGES},
    )

    assert status == 200
    payload = json.loads(body)
    assert payload["choices"][0]["message"]["content"] == SCRIPTED_ANSWER
    assert payload["mmd"]["trace_version"] == 1
    assert payload["mmd"]["mode"] == "standard"


def test_proxy_streaming_returns_incremental_chunks_matching_non_streaming_content(
    start_proxy,
):
    """Exercises item 3's real wire behavior end-to-end. Requires
    stream_options.include_usage=true in the request body -- verified that litellm
    strips usage from the SSE stream otherwise (see docs/development.md note)."""
    proxy = start_proxy(EXAMPLES_DIR, config_filename="litellm_mock_config.yaml")

    with proxy.open_stream(
        "/chat/completions",
        {
            "model": "mmd-fusion-mock",
            "stream": True,
            "stream_options": {"include_usage": True},
            "messages": NORMAL_MESSAGES,
        },
    ) as resp:
        raw = resp.read().decode()

    frames = []
    for line in raw.splitlines():
        line = line.strip()
        if not line.startswith("data:"):
            continue
        data = line[len("data:"):].strip()
        if data == "[DONE]":
            continue
        frames.append(json.loads(data))

    assert frames, f"no SSE frames parsed from raw body:\n{raw}"

    content_parts = [
        frame["choices"][0]["delta"].get("content", "")
        for frame in frames
        if frame.get("choices")
    ]
    assert "".join(content_parts) == SCRIPTED_ANSWER

    finish_reasons = [
        frame["choices"][0].get("finish_reason")
        for frame in frames
        if frame.get("choices")
    ]
    assert "stop" in finish_reasons

    usage_frames = [frame["usage"] for frame in frames if frame.get("usage")]
    assert usage_frames, f"no usage frame found in stream:\n{frames}"

    mmd_frames = [frame["mmd"] for frame in frames if frame.get("mmd")]
    assert mmd_frames, f"no mmd trace frame found in stream:\n{frames}"
    assert mmd_frames[0]["trace_version"] == 1


def test_proxy_success_callback_fires_exactly_once_per_outer_request(
    start_proxy, write_scenario, tmp_path
):
    """Tests the invariant _attach_trace_to_litellm_logging's code comment claims:
    MMD avoids double-invoking LiteLLM's global success callback for the same outer
    request. The scripted panel's inner calls never touch litellm.acompletion, so
    this test is unambiguous about what it's proving (it does not, and cannot,
    prove anything about a real-model configuration's inner-call callback count)."""
    callback_log = tmp_path / "callback_events.log"
    config_dir = write_scenario(
        {
            "handler.py": NORMAL_HANDLER_PY,
            "callback.py": (
                "import os\n"
                "from litellm.integrations.custom_logger import CustomLogger\n\n"
                "class _CountingLogger(CustomLogger):\n"
                "    async def async_log_success_event(self, kwargs, response_obj, start_time, end_time):\n"
                "        with open(os.environ['MMD_TEST_CALLBACK_LOG_PATH'], 'a', encoding='utf-8') as fh:\n"
                "            fh.write('event\\n')\n\n"
                "mmd_test_callback_logger = _CountingLogger()\n"
            ),
            "config.yaml": _config(
                extra_litellm_settings='  callbacks: ["callback.mmd_test_callback_logger"]\n'
            ),
        }
    )
    proxy = start_proxy(
        config_dir, env={"MMD_TEST_CALLBACK_LOG_PATH": str(callback_log)}
    )

    status, _ = proxy.request(
        "/chat/completions",
        {"model": "mmd-fusion-mock", "messages": NORMAL_MESSAGES},
    )
    assert status == 200

    deadline = time.time() + 5.0
    while time.time() < deadline and not callback_log.exists():
        time.sleep(0.1)

    assert callback_log.exists(), "callback never fired"
    time.sleep(0.5)  # grace period: make sure no late duplicate arrives
    lines = callback_log.read_text(encoding="utf-8").splitlines()
    assert lines == ["event"]


def test_proxy_router_alias_resolves_to_underlying_model_group(
    start_proxy, write_scenario
):
    """Scope note: this only proves that wrapping MMD's model group in the Proxy's
    own Router.model_group_alias mechanism does not break MMD. It does NOT test
    MMD's *inner* panel/coordinator calls going through a Router -- that would
    require MMDLiteLLMProvider(router=...), which no handler here uses. MMD does
    not reimplement Router fallback itself (see docs/development.md's "暂不进入
    主线的工作" list); this test validates the outer model layer only."""
    config_dir = write_scenario(
        {
            "handler.py": NORMAL_HANDLER_PY,
            "config.yaml": _config(
                extra_sections=(
                    "router_settings:\n"
                    "  model_group_alias:\n"
                    "    mmd-alias: mmd-fusion-mock\n"
                )
            ),
        }
    )
    proxy = start_proxy(config_dir)

    status, body = proxy.request(
        "/chat/completions",
        {"model": "mmd-alias", "messages": NORMAL_MESSAGES},
    )

    assert status == 200
    payload = json.loads(body)
    assert payload["choices"][0]["message"]["content"] == SCRIPTED_ANSWER


def test_proxy_native_bad_request_error_returns_400_with_error_envelope(
    start_proxy, write_scenario
):
    config_dir = write_scenario(
        {"handler.py": NORMAL_HANDLER_PY, "config.yaml": _config()}
    )
    proxy = start_proxy(config_dir)

    status, body = proxy.request(
        "/chat/completions",
        {
            "model": "mmd-fusion-mock",
            "messages": [{"role": "assistant", "content": "No user prompt."}],
        },
    )

    assert status == 400
    payload = json.loads(body)
    assert payload["error"]["type"] == "bad_request_error"
    assert "user message" in payload["error"]["message"]


def test_proxy_recursion_guard_rejects_with_400(start_proxy, write_scenario):
    config_dir = write_scenario(
        {
            "handler.py": NORMAL_HANDLER_PY,
            "config.yaml": _config(
                extra_litellm_params="      mmd_deliberation_depth: 1\n"
            ),
        }
    )
    proxy = start_proxy(config_dir)

    status, body = proxy.request(
        "/chat/completions",
        {"model": "mmd-fusion-mock", "messages": NORMAL_MESSAGES},
    )

    assert status == 400
    payload = json.loads(body)
    assert "recursive MMD invocation is not allowed" in payload["error"]["message"]


def test_proxy_call_budget_exceeded_returns_429(start_proxy, write_scenario):
    config_dir = write_scenario(
        {
            "handler.py": NORMAL_HANDLER_PY,
            "config.yaml": _config(extra_litellm_params="      max_total_calls: 1\n"),
        }
    )
    proxy = start_proxy(config_dir)

    status, body = proxy.request(
        "/chat/completions",
        {"model": "mmd-fusion-mock", "messages": NORMAL_MESSAGES},
    )

    assert status == 429
    payload = json.loads(body)
    assert "max_total_calls" in payload["error"]["message"]


def test_proxy_run_timeout_returns_504(start_proxy, write_scenario):
    config_dir = write_scenario(
        {
            "handler.py": (
                "from mmd_litellm.litellm_provider import MMDLiteLLMProvider\n"
                "from tests.test_orchestrator import SlowScriptedClient\n\n"
                "mmd_custom_llm = MMDLiteLLMProvider(client=SlowScriptedClient())\n"
            ),
            "config.yaml": _config(
                extra_litellm_params="      max_run_timeout: 0.01\n"
            ),
        }
    )
    proxy = start_proxy(config_dir)

    status, body = proxy.request(
        "/chat/completions",
        {"model": "mmd-fusion-mock", "messages": NORMAL_MESSAGES},
        timeout=15.0,
    )

    assert status == 504
    payload = json.loads(body)
    assert "max_run_timeout" in payload["error"]["message"]


MARKER_CONTENT = "MMD_TOOL_LOOP_E2E_MARKER_CONTENT"


class _MarkerHandler(BaseHTTPRequestHandler):
    def do_GET(self):  # noqa: N802 - required BaseHTTPRequestHandler name
        body = MARKER_CONTENT.encode()
        self.send_response(200)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):  # silence test output
        pass


class _MarkerServer:
    """A real local HTTP server the Proxy subprocess's `web_fetch` tool call
    actually fetches over the network - proves the whole tool-execution loop
    end to end, not just against a scripted/mocked HTTP layer."""

    def __enter__(self) -> str:
        self._server = ThreadingHTTPServer(("127.0.0.1", 0), _MarkerHandler)
        self._thread = threading.Thread(
            target=self._server.serve_forever, daemon=True
        )
        self._thread.start()
        port = self._server.server_address[1]
        return f"http://127.0.0.1:{port}/marker"

    def __exit__(self, *exc_info) -> None:
        self._server.shutdown()
        self._thread.join(timeout=5)


TOOL_LOOP_HANDLER_TEMPLATE = (
    "from mmd_litellm.litellm_provider import MMDLiteLLMProvider\n"
    "from tests.test_orchestrator import ToolLoopScriptedClient\n\n"
    "mmd_custom_llm = MMDLiteLLMProvider(\n"
    "    client=ToolLoopScriptedClient(fetch_url={fetch_url!r})\n"
    ")\n"
)


def test_proxy_tool_loop_executes_real_web_fetch_and_records_trace(
    start_proxy, write_scenario
):
    """The end-to-end P1 "tool/web path" scenario: a real litellm Proxy subprocess,
    a real local HTTP server fetched over real sockets by MMD's own web_fetch tool
    execution loop, and a real audit trace produced from that real fetch."""
    with _MarkerServer() as fetch_url:
        config_dir = write_scenario(
            {
                "handler.py": TOOL_LOOP_HANDLER_TEMPLATE.format(fetch_url=fetch_url),
                "config.yaml": _config(
                    extra_litellm_params=(
                        "      tool_mode: mmd_native_web\n"
                        "      max_tool_calls: 2\n"
                    )
                ),
            }
        )
        proxy = start_proxy(
            config_dir, env={"MMD_WEB_FETCH_ALLOW_PRIVATE_HOSTS": "127.0.0.1"}
        )

        status, body = proxy.request(
            "/chat/completions",
            {"model": "mmd-fusion-mock", "messages": NORMAL_MESSAGES},
        )

    assert status == 200
    payload = json.loads(body)
    assert (
        payload["choices"][0]["message"]["content"]
        == "Use a small TypeScript monorepo for this project."
    )
    tooling = payload["mmd"]["tooling"]
    assert tooling["tool_mode"] == "mmd_native_web"
    assert tooling["tool_calls_executed"] >= 1
    assert tooling["tool_calls_failed"] == 0
    events = tooling["tool_call_events"]
    assert events, "expected at least one recorded tool call event"
    assert all(event["status"] == "ok" for event in events)
    assert all(event["tool_name"] == "web_fetch" for event in events)
    assert any(MARKER_CONTENT in (event["result_preview"] or "") for event in events)


def test_proxy_tool_loop_blocks_ssrf_target_and_still_degrades_gracefully(
    start_proxy, write_scenario
):
    """Negative companion: without the private-hosts allowlist env var, MMD's
    SSRF protection must block a loopback fetch target server-side - and the
    run must still complete (degrade, not crash), recording the block in the
    trace rather than failing the whole request."""
    with _MarkerServer() as fetch_url:
        config_dir = write_scenario(
            {
                "handler.py": TOOL_LOOP_HANDLER_TEMPLATE.format(fetch_url=fetch_url),
                "config.yaml": _config(
                    extra_litellm_params=(
                        "      tool_mode: mmd_native_web\n"
                        "      max_tool_calls: 2\n"
                    )
                ),
            }
        )
        # Explicitly override to empty: the Proxy subprocess env is a copy of
        # this test-runner's environment, which must not accidentally inherit
        # an allowlist set by another test in the same session.
        proxy = start_proxy(
            config_dir, env={"MMD_WEB_FETCH_ALLOW_PRIVATE_HOSTS": ""}
        )

        status, body = proxy.request(
            "/chat/completions",
            {"model": "mmd-fusion-mock", "messages": NORMAL_MESSAGES},
        )

    assert status == 200
    payload = json.loads(body)
    assert (
        payload["choices"][0]["message"]["content"]
        == "Use a small TypeScript monorepo for this project."
    )
    events = payload["mmd"]["tooling"]["tool_call_events"]
    assert events, "expected at least one recorded tool call event"
    assert all(event["status"] == "blocked" for event in events)
    assert all(event["error"] for event in events)
    assert all(
        MARKER_CONTENT not in (event["result_preview"] or "") for event in events
    )
