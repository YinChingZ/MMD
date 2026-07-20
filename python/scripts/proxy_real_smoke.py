from __future__ import annotations

import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EXAMPLES = ROOT / "examples"
KNOWN_LITELLM_PROVIDERS = {
    "ai21",
    "aleph_alpha",
    "anthropic",
    "azure",
    "bedrock",
    "cohere",
    "deepseek",
    "fireworks_ai",
    "gemini",
    "groq",
    "huggingface",
    "mistral",
    "ollama",
    "openai",
    "openrouter",
    "perplexity",
    "together_ai",
    "vertex_ai",
    "xai",
}
OPENROUTER_CATALOG_PREFIXES = {
    "alibaba",
    "anthropic",
    "deepseek",
    "google",
    "meta-llama",
    "mistralai",
    "moonshotai",
    "openai",
    "qwen",
    "z-ai",
}


def main() -> None:
    analysis_models = _csv_env("MMD_SMOKE_ANALYSIS_MODELS")
    if not analysis_models:
        print(
            json.dumps(
                {
                    "skipped": True,
                    "reason": "set MMD_SMOKE_ANALYSIS_MODELS to run real-model proxy smoke",
                }
            )
        )
        return

    model_name = os.environ.get("MMD_SMOKE_MODEL_NAME", "mmd-fusion-real")
    coordinator_model = os.environ.get("MMD_SMOKE_COORDINATOR_MODEL") or analysis_models[0]
    _validate_models(analysis_models, coordinator_model)

    litellm_cli = shutil.which("litellm")
    if litellm_cli is None:
        raise RuntimeError("litellm CLI not found; install the litellm proxy extra first")
    mode = os.environ.get("MMD_SMOKE_MODE", "quick")
    if mode not in {"quick", "standard", "planning"}:
        raise ValueError("MMD_SMOKE_MODE must be quick, standard, or planning")
    preset = os.environ.get("MMD_SMOKE_PRESET")
    if preset is not None and preset not in {"cheap", "balanced", "strong"}:
        raise ValueError("MMD_SMOKE_PRESET must be cheap, balanced, or strong")

    per_model_timeout = _optional_float_env("MMD_SMOKE_PER_MODEL_TIMEOUT")
    if per_model_timeout is None and preset is None:
        per_model_timeout = 120
    max_run_timeout = _optional_float_env("MMD_SMOKE_MAX_RUN_TIMEOUT")
    max_total_calls = _optional_int_env("MMD_SMOKE_MAX_TOTAL_CALLS")
    max_repair_attempts = _int_env("MMD_SMOKE_MAX_REPAIR_ATTEMPTS", 2)
    quorum_ratio = _float_env("MMD_SMOKE_QUORUM_RATIO", 2 / 3)
    max_topics = _int_env("MMD_SMOKE_MAX_TOPICS", 3)
    max_completion_tokens = _optional_int_env("MMD_SMOKE_MAX_COMPLETION_TOKENS")
    temperature = _optional_float_env("MMD_SMOKE_TEMPERATURE")
    coordinator_temperature = _optional_float_env("MMD_SMOKE_COORDINATOR_TEMPERATURE")
    expected_partial = _optional_bool_env("MMD_SMOKE_EXPECT_PARTIAL")
    request_timeout = _float_env("MMD_SMOKE_HTTP_TIMEOUT", 600)
    question = os.environ.get(
        "MMD_SMOKE_QUESTION",
        "Compare Python FastAPI and Node.js NestJS for a small internal API.",
    )

    port = _free_port()
    env = os.environ.copy()
    pythonpath_parts = [str(ROOT), str(EXAMPLES)]
    if env.get("PYTHONPATH"):
        pythonpath_parts.append(env["PYTHONPATH"])
    env["PYTHONPATH"] = os.pathsep.join(pythonpath_parts)
    env.setdefault("LITELLM_TELEMETRY", "False")

    config_text = _config_yaml(
        model_name=model_name,
        analysis_models=analysis_models,
        coordinator_model=coordinator_model,
        preset=preset,
        mode=mode,
        quorum_ratio=quorum_ratio,
        per_model_timeout=per_model_timeout,
        max_run_timeout=max_run_timeout,
        max_total_calls=max_total_calls,
        max_repair_attempts=max_repair_attempts,
        max_topics=max_topics,
        max_completion_tokens=max_completion_tokens,
        temperature=temperature,
        coordinator_temperature=coordinator_temperature,
    )
    with tempfile.TemporaryDirectory(prefix="mmd-real-smoke-") as temp_dir:
        config_path = Path(temp_dir) / "litellm_real_smoke.yaml"
        handler_path = Path(temp_dir) / "mmd_handler.py"
        config_path.write_text(config_text)
        shutil.copyfile(EXAMPLES / "mmd_handler.py", handler_path)

        process = subprocess.Popen(
            [
                litellm_cli,
                "--config",
                str(config_path),
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
            response = _wait_for_completion(
                port=port,
                process=process,
                model_name=model_name,
                question=question,
                request_timeout=request_timeout,
            )
        finally:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)

    content = response["choices"][0]["message"]["content"]
    if not isinstance(content, str) or not content.strip():
        raise AssertionError(f"empty response content: {response}")
    trace = response.get("mmd")
    if not isinstance(trace, dict):
        raise AssertionError(f"missing mmd trace metadata: {response}")
    if (
        trace.get("trace_version") != "mmd.trace.v3"
        or trace.get("protocol_version") != "mmd.v3"
    ):
        raise AssertionError(f"unexpected mmd trace contract: {trace}")
    if trace.get("mode") != mode:
        raise AssertionError(f"unexpected mmd mode in trace: {trace.get('mode')}")
    if expected_partial is not None:
        _assert_expected_partial(trace, expected_partial)

    print(
        json.dumps(
            {
                "ok": True,
                "model": response["model"],
                "mode": trace["mode"],
                "analysis_models": analysis_models,
                "coordinator_model": coordinator_model,
                "content_preview": content[:240],
                "trace_version": trace["trace_version"],
            },
            ensure_ascii=False,
        )
    )


def _csv_env(name: str) -> list[str]:
    value = os.environ.get(name, "")
    return [part.strip() for part in value.split(",") if part.strip()]


def _validate_models(analysis_models: list[str], coordinator_model: str) -> None:
    models = [*analysis_models, coordinator_model]
    likely_missing_openrouter = sorted(
        {
            model
            for model in models
            if _provider_prefix(model) in OPENROUTER_CATALOG_PREFIXES
            and _provider_prefix(model) not in KNOWN_LITELLM_PROVIDERS
        }
    )
    if likely_missing_openrouter:
        suggested = [f"openrouter/{model}" for model in likely_missing_openrouter]
        raise ValueError(
            "these look like OpenRouter catalog model ids but are missing the "
            "`openrouter/` LiteLLM provider prefix: "
            + ", ".join(likely_missing_openrouter)
            + ". Use: "
            + ",".join(suggested)
        )


def _provider_prefix(model: str) -> str:
    return model.split("/", maxsplit=1)[0] if "/" in model else ""


def _float_env(name: str, default: float) -> float:
    value = os.environ.get(name)
    if value is None:
        return default
    return float(value)


def _int_env(name: str, default: int) -> int:
    value = os.environ.get(name)
    if value is None:
        return default
    return int(value)


def _optional_float_env(name: str) -> float | None:
    value = os.environ.get(name)
    if value is None:
        return None
    return float(value)


def _optional_int_env(name: str) -> int | None:
    value = os.environ.get(name)
    if value is None:
        return None
    return int(value)


def _optional_bool_env(name: str) -> bool | None:
    value = os.environ.get(name)
    if value is None:
        return None
    normalized = value.strip().lower()
    if normalized in {"1", "true", "yes"}:
        return True
    if normalized in {"0", "false", "no"}:
        return False
    raise ValueError(f"{name} must be true or false")


def _assert_expected_partial(trace: dict, expected_partial: bool) -> None:
    propose_quorum = next(
        (
            item
            for item in trace.get("quorum") or []
            if item.get("phase") == "propose" and item.get("topic_id") is None
        ),
        None,
    )
    if not isinstance(propose_quorum, dict):
        raise AssertionError(
            "MMD_SMOKE_EXPECT_PARTIAL requires a root propose quorum entry"
        )
    actual_partial = propose_quorum.get("partial")
    if actual_partial is not expected_partial:
        raise AssertionError(
            f"expected propose partial={expected_partial}, got {actual_partial}: {trace}"
        )


def _yaml_list(values: list[str], indent: int) -> list[str]:
    prefix = " " * indent
    return [f"{prefix}- {_yaml_scalar(value)}" for value in values]


def _yaml_scalar(value: str) -> str:
    return json.dumps(value)


def _config_yaml(
    *,
    model_name: str,
    analysis_models: list[str],
    coordinator_model: str,
    preset: str | None,
    mode: str,
    quorum_ratio: float,
    per_model_timeout: float | None,
    max_run_timeout: float | None,
    max_total_calls: int | None,
    max_repair_attempts: int,
    max_topics: int,
    max_completion_tokens: int | None,
    temperature: float | None,
    coordinator_temperature: float | None,
) -> str:
    lines = [
        "model_list:",
        f"  - model_name: {_yaml_scalar(model_name)}",
        "    litellm_params:",
        "      model: mmd/fusion",
        "      analysis_models:",
        *_yaml_list(analysis_models, 8),
        f"      coordinator_model: {_yaml_scalar(coordinator_model)}",
        *([f"      preset: {_yaml_scalar(preset)}"] if preset is not None else []),
        f"      mmd_mode: {_yaml_scalar(mode)}",
        f"      quorum_ratio: {quorum_ratio}",
        *(
            [f"      per_model_timeout: {per_model_timeout}"]
            if per_model_timeout is not None
            else []
        ),
        *(
            [f"      max_run_timeout: {max_run_timeout}"]
            if max_run_timeout is not None
            else []
        ),
        *(
            [f"      max_total_calls: {max_total_calls}"]
            if max_total_calls is not None
            else []
        ),
        f"      max_repair_attempts: {max_repair_attempts}",
        f"      max_topics: {max_topics}",
        *(
            [f"      max_completion_tokens: {max_completion_tokens}"]
            if max_completion_tokens is not None
            else []
        ),
        *([f"      temperature: {temperature}"] if temperature is not None else []),
        *(
            [f"      coordinator_temperature: {coordinator_temperature}"]
            if coordinator_temperature is not None
            else []
        ),
        "      return_trace: true",
        "",
        "litellm_settings:",
        "  custom_provider_map:",
        "    - provider: mmd",
        "      custom_handler: mmd_handler.mmd_custom_llm",
        "",
    ]
    return "\n".join(lines)


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _wait_for_completion(
    *,
    port: int,
    process: subprocess.Popen[str],
    model_name: str,
    question: str,
    request_timeout: float,
) -> dict:
    deadline = time.time() + 45
    last_error: str | None = None
    url = f"http://127.0.0.1:{port}/chat/completions"
    payload = json.dumps(
        {
            "model": model_name,
            "messages": [
                {
                    "role": "user",
                    "content": question,
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
                "Authorization": "Bearer sk-local-real-smoke",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=request_timeout) as response:
                return json.loads(response.read().decode())
        except urllib.error.HTTPError as error:
            body = error.read().decode(errors="replace")
            raise RuntimeError(
                f"LiteLLM proxy returned HTTP {error.code}: {_error_summary(body)}"
            )
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
            last_error = str(error)
            time.sleep(0.5)

    output = process.stdout.read() if process.stdout else ""
    raise TimeoutError(
        f"LiteLLM proxy did not answer before timeout. Last error: {last_error}\n{output}"
    )


def _error_summary(body: str) -> str:
    try:
        payload = json.loads(body)
    except json.JSONDecodeError:
        return body[:2000]
    error = payload.get("error") if isinstance(payload, dict) else None
    message = error.get("message") if isinstance(error, dict) else None
    if isinstance(message, str):
        summary = message.split("\nTraceback", maxsplit=1)[0].strip()
        return summary[:2000]
    return body[:2000]


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"real-model proxy smoke failed: {error}", file=sys.stderr)
        sys.exit(1)
