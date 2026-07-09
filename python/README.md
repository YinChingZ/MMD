# mmd-litellm

`mmd-litellm` 是 MMD 的 LiteLLM custom-provider 包，暴露 `mmd/fusion`。

从源码安装：

```bash
pip install './python[litellm]'
```

运行测试：

```bash
uv run --project python --extra test pytest
```

完整的 Proxy 配置、handler shim、返回契约、限制和真实 smoke 命令以仓库的 [架构与运行参考](../docs/architecture.md) 为准；开发优先级以 [统一开发路径](../docs/development.md) 为准。本文件仅作为 Python 包的发布元数据 README，不是独立的项目文档。
