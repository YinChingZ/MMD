# mmd-litellm

`mmd-litellm` 是 MMD 的 LiteLLM custom-provider 暂存包，暴露
`mmd/fusion` 并只为新执行写入 `mmd.trace.v3`。

从源码安装：

```bash
pip install './python[litellm]'
```

运行测试：

```bash
uv run --project python --extra test pytest
```

完整的 Proxy 配置、handler shim、返回契约和限制以仓库的
[架构参考](../docs/architecture.md) 为准；贡献拆分见
[upstream RFC](../docs/upstream-rfc.md)。
