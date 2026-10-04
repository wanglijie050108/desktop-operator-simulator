# C# Desktop Agent (frozen reference baseline)

This project is **not** the Windows automation implementation. Since `docs/06` ADR-007 the
target Desktop Agent is [`apps/desktop-agent-python`](../desktop-agent-python) (Python 3.11 +
pywinauto); this C# agent is frozen as a protocol/safety reference and an executable fallback
(`docs/06` ADR-008).

Do not:

- add desktop actions, UIA/FlaUI implementations, or any other Windows automation here;
- use this agent for real desktop automation: `PlaceholderDesktopActionExecutor` returns
  `NOT_IMPLEMENTED` for every action by design, and must keep doing so;
- add these projects back into the default `npm run check` gate.

It is still kept for:

- cross-language contract parity: the shared fixtures in `contracts/fixtures/websocket-v1/` are
  deserialized by `DesktopAgent.Core.Tests`, so Node, Python and C# keep agreeing on message
  versions, enums, UUIDs and timestamps;
- a runnable fallback agent for the M1 reconnect integration test
  (`npm run test:integration:m1:csharp`).

Where it runs: the `dotnet` job in `.github/workflows/ci.yml`, and `npm run check:all`.
Both require the .NET SDK version pinned by `global.json` (10.0.x).
