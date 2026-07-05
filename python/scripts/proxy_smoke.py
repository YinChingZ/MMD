from __future__ import annotations

import json
import os
import shutil
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / "examples" / "litellm_mock_config.yaml"


def main() -> None:
    litellm_cli = shutil.which("litellm")
    if litellm_cli is None:
        raise RuntimeError("litellm CLI not found; install the litellm extra first")

    port = _free_port()
    env = os.environ.copy()
    env["PYTHONPATH"] = (
        str(ROOT)
        if not env.get("PYTHONPATH")
        else f"{ROOT}{os.pathsep}{env['PYTHONPATH']}"
    )
    env.setdefault("LITELLM_TELEMETRY", "False")

    process = subprocess.Popen(
        [
            litellm_cli,
            "--config",
            str(CONFIG),
            "--host",
            "127.0.0.1",
            "--port",
            str(port),
            "--telemetry",
            "False",
        ],
        cwd=ROOT.parent,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    try:
        response = _wait_for_completion(port, process)
    finally:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)

    content = response["choices"][0]["message"]["content"]
    if "LiteLLM-shaped Python provider" not in content:
        raise AssertionError(f"unexpected response content: {content}")
    trace = response.get("mmd")
    if not isinstance(trace, dict):
        raise AssertionError(f"missing mmd trace metadata: {response}")
    if trace.get("trace_version") != 1 or trace.get("protocol") != "mmd.v1":
        raise AssertionError(f"unexpected mmd trace contract: {trace}")
    if trace.get("mode") != "standard":
        raise AssertionError(f"unexpected mmd mode in trace: {trace.get('mode')}")
    print(
        json.dumps(
            {
                "ok": True,
                "model": response["model"],
                "content": content,
                "trace_version": trace["trace_version"],
                "mode": trace["mode"],
            }
        )
    )


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _wait_for_completion(port: int, process: subprocess.Popen[str]) -> dict:
    deadline = time.time() + 45
    last_error: str | None = None
    url = f"http://127.0.0.1:{port}/chat/completions"
    payload = json.dumps(
        {
            "model": "mmd-fusion-mock",
            "messages": [
                {
                    "role": "user",
                    "content": "Run the MMD LiteLLM proxy smoke test.",
                }
            ],
        }
    ).encode()

    while time.time() < deadline:
        if process.poll() is not None:
            output = process.stdout.read() if process.stdout else ""
            raise RuntimeError(
                f"LiteLLM proxy exited early with code {process.returncode}\n{output}"
            )
        request = urllib.request.Request(
            url,
            data=payload,
            headers={
                "Content-Type": "application/json",
                "Authorization": "Bearer sk-local-smoke",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=2) as response:
                return json.loads(response.read().decode())
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
            last_error = str(error)
            time.sleep(0.5)

    output = process.stdout.read() if process.stdout else ""
    raise TimeoutError(
        f"LiteLLM proxy did not answer before timeout. Last error: {last_error}\n{output}"
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"proxy smoke failed: {error}", file=sys.stderr)
        raise
