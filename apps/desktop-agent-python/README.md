# Python Desktop Agent

This package is the target Desktop Agent implementation (ADR-007) and replaces the retained
C# agent as the default. It provides strict WebSocket protocol models, registration, heartbeat,
bounded reconnect, serial command receipt, control-frame handling, and a fail-closed executor
that is used unless Windows automation is explicitly enabled.

With `AGENT_WINDOWS_AUTOMATION_ENABLED=true` it drives a pywinauto executor: window activation
with foreground re-validation, key chords, clipboard writes, window screenshots, WeChat
send/read, and mouse move/click/drag/scroll on semantically located controls. Window-relative
coordinate clicks stay disabled until `AGENT_COORDINATE_MOUSE_PROFILE` matches the live
resolution and DPI.

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
