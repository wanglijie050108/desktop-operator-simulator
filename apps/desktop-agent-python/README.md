# Python Desktop Agent

This package is the target and only Desktop Agent implementation (ADR-007/ADR-009); the C# agent has been removed. It provides strict WebSocket protocol models, registration, heartbeat,
bounded reconnect, serial command receipt, control-frame handling, and a fail-closed executor
that is used unless Windows automation is explicitly enabled.

With `AGENT_WINDOWS_AUTOMATION_ENABLED=true` it drives a pywinauto executor: window activation
with foreground re-validation, key chords, clipboard writes, window screenshots, WeChat
send/read, and mouse move/click/drag/scroll on semantically located controls. Window-relative
coordinate clicks stay disabled until `AGENT_COORDINATE_MOUSE_PROFILE` matches the live
resolution and DPI.

Validation status (see `docs/08-development-status.md`): the Windows base executor and mouse
actions have real-machine evidence on Notepad (20/20 and 19/20). The WeChat send/read paths
exist in code and pass mock-control-tree unit tests only — real control calibration is
pending, and WeChat 4.1.15.13 exposes a Qt accessibility shell that pure UIA cannot read
(ADR-011). There is no evidence yet for any business application.

## Decision-loop support (Plan B, ADR-010)

This Agent deliberately contains **no LLM and no decision logic**. The Control Server owns the
decision loop; the Agent only executes allowlisted actions. Per `docs/02` §3.2 the Agent's
role in Plan B includes observation: reporting a bounded UIA control tree
(`DESKTOP_INSPECT_TREE`, see `docs/03`) as the decision loop's "eyes", plus screenshots.

Two constraints apply to that observation path:

- Runtime node names are sent to the LLM to support decisions, but node names in persisted
  traces and logs must be redacted (the HMAC approach already used by `uia_inspection.py`).
  Transmitting and retaining are separate paths; raw names must not be stored long-term.
- Node count and per-node field length must be capped, and truncation must be reported
  explicitly (`truncated: true`) — never silent.

`uia_inspection.py` is an offline forensic tool, not the decision-loop observation interface.

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
