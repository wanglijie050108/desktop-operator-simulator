# Python Desktop Agent

This package is the staged replacement for the C# Desktop Agent. The first migration
slice contains only strict WebSocket protocol models and cross-language fixture tests.
It does not connect to the Control Server or perform Windows desktop actions yet.

## Development

Python 3.11 and `uv` are required:

```bash
uv sync --project apps/desktop-agent-python
uv run --project apps/desktop-agent-python ruff check apps/desktop-agent-python
uv run --project apps/desktop-agent-python mypy \
  apps/desktop-agent-python/src apps/desktop-agent-python/tests
uv run --project apps/desktop-agent-python pytest apps/desktop-agent-python
```

`pywinauto` is installed only on Windows. Do not import it from protocol, policy, or
transport modules so those layers remain testable on macOS and Linux.
