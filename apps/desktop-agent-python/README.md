# Python Desktop Agent

This package is the staged replacement for the C# Desktop Agent. It currently provides
strict WebSocket protocol models, registration, heartbeat, bounded reconnect, serial
command receipt, control-frame handling, and a fail-closed placeholder executor.
It does not perform Windows desktop actions yet.

## Development

Python 3.11 and `uv` are required:

```bash
uv sync --project apps/desktop-agent-python
uv run --directory apps/desktop-agent-python ruff check .
uv run --directory apps/desktop-agent-python mypy src tests
uv run --directory apps/desktop-agent-python pytest
```

Start the placeholder Agent after the Control Server is listening:

```bash
uv run --directory apps/desktop-agent-python desktop-agent-python
```

`pywinauto` is installed only on Windows. Do not import it from protocol, policy, or
transport modules so those layers remain testable on macOS and Linux.
