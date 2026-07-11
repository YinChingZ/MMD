from __future__ import annotations

import json
import os
import shutil
import socket
import subprocess
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

import pytest

REPO_PYTHON_ROOT = Path(__file__).resolve().parents[1]  # .../python


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


@pytest.fixture(scope="session")
def litellm_cli() -> str:
    cli = shutil.which("litellm")
    if cli is None:
        pytest.skip(
            "litellm CLI not found; install mmd-litellm[proxy] to run Proxy e2e tests"
        )
    return cli


@dataclass
class ProxyHandle:
    port: int
    process: subprocess.Popen
    config_dir: Path

    @property
    def base_url(self) -> str:
        return f"http://127.0.0.1:{self.port}"

    def request(
        self,
        path: str,
        payload: dict[str, Any],
        *,
        headers: dict[str, str] | None = None,
        timeout: float = 10.0,
    ) -> tuple[int, bytes]:
        req = urllib.request.Request(
            f"{self.base_url}{path}",
            data=json.dumps(payload).encode(),
            headers={
                "Content-Type": "application/json",
                "Authorization": "Bearer sk-local-smoke",
                **(headers or {}),
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.status, resp.read()
        except urllib.error.HTTPError as error:
            return error.code, error.read()

    def open_stream(
        self,
        path: str,
        payload: dict[str, Any],
        *,
        headers: dict[str, str] | None = None,
        timeout: float = 10.0,
    ):
        req = urllib.request.Request(
            f"{self.base_url}{path}",
            data=json.dumps(payload).encode(),
            headers={
                "Content-Type": "application/json",
                "Authorization": "Bearer sk-local-smoke",
                **(headers or {}),
            },
            method="POST",
        )
        return urllib.request.urlopen(req, timeout=timeout)


@pytest.fixture
def write_scenario(tmp_path) -> Callable[[dict[str, str]], Path]:
    """Returns write(files) -> Path: writes a {relative_path: content} mapping into a
    fresh subdirectory of tmp_path and returns that directory. Co-locating config.yaml
    with generated handler/callback modules matches how LiteLLM's file-based dotted
    module loader (get_instance_fn, used for both custom_provider_map.custom_handler
    and success_callback entries) resolves them relative to the config file's directory.
    """
    counter = {"n": 0}

    def _write(files: dict[str, str]) -> Path:
        counter["n"] += 1
        directory = tmp_path / f"scenario_{counter['n']}"
        directory.mkdir(parents=True, exist_ok=True)
        for name, content in files.items():
            (directory / name).write_text(content, encoding="utf-8")
        return directory

    return _write


@pytest.fixture
def start_proxy(litellm_cli: str) -> Callable[..., ProxyHandle]:
    """Returns start(config_dir, *, config_filename="config.yaml", env=None,
    startup_timeout=30.0) -> ProxyHandle. Launches a real `litellm` Proxy subprocess
    pointed at the given config, polls the unauthenticated GET /health/liveliness
    endpoint for readiness, and tears every started process down at test end.
    """
    started: list[subprocess.Popen] = []

    def _start(
        config_dir: Path,
        *,
        config_filename: str = "config.yaml",
        env: dict[str, str] | None = None,
        startup_timeout: float = 30.0,
    ) -> ProxyHandle:
        port = _free_port()
        proc_env = os.environ.copy()
        proc_env["PYTHONPATH"] = (
            str(REPO_PYTHON_ROOT)
            if not proc_env.get("PYTHONPATH")
            else f"{REPO_PYTHON_ROOT}{os.pathsep}{proc_env['PYTHONPATH']}"
        )
        proc_env.setdefault("LITELLM_TELEMETRY", "False")
        proc_env.update(env or {})

        process = subprocess.Popen(
            [
                litellm_cli,
                "--config",
                str(config_dir / config_filename),
                "--host",
                "127.0.0.1",
                "--port",
                str(port),
                "--telemetry",
                "False",
            ],
            cwd=REPO_PYTHON_ROOT.parent,
            env=proc_env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )
        started.append(process)

        handle = ProxyHandle(port=port, process=process, config_dir=config_dir)
        deadline = time.time() + startup_timeout
        last_error: str | None = None
        while time.time() < deadline:
            if process.poll() is not None:
                output = process.stdout.read() if process.stdout else ""
                raise RuntimeError(
                    f"litellm proxy exited early (code {process.returncode})\n{output}"
                )
            try:
                with urllib.request.urlopen(
                    f"{handle.base_url}/health/liveliness", timeout=2
                ):
                    return handle
            except (urllib.error.URLError, TimeoutError) as error:
                last_error = str(error)
                time.sleep(0.3)
        output = process.stdout.read() if process.stdout else ""
        raise TimeoutError(f"proxy did not become live: {last_error}\n{output}")

    yield _start

    for process in started:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)
