"""Console entry point for the Python Desktop Agent."""

from __future__ import annotations

import asyncio
import json
import signal
from datetime import UTC, datetime

from .client import AgentClient
from .config import AgentOptions
from .execution import CommandDispatcher, PlaceholderDesktopActionExecutor
from .policy import AgentCommandPolicy
from .redaction import redact_text
from .windows_executor import create_windows_executor


def write_log(level: str, message: str) -> None:
    print(
        json.dumps(
            {
                "timestamp": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
                "level": level,
                "message": redact_text(message),
            },
            ensure_ascii=True,
        ),
        flush=True,
    )


async def run() -> None:
    options = AgentOptions.from_environment()
    executor = (
        create_windows_executor(
            allowed_processes=options.allowed_processes,
            artifact_directory=options.artifact_directory,
        )
        if options.windows_automation_enabled
        else PlaceholderDesktopActionExecutor()
    )
    handler = CommandDispatcher(
        executor,
        policy=AgentCommandPolicy(options.allowed_actions),
    )
    client = AgentClient(options, handler, log=lambda message: write_log("information", message))
    stop_event = asyncio.Event()
    loop = asyncio.get_running_loop()
    for shutdown_signal in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(shutdown_signal, stop_event.set)
        except NotImplementedError:
            pass

    if not options.windows_automation_enabled:
        write_log(
            "warning",
            "Desktop actions use a placeholder executor and will return NOT_IMPLEMENTED.",
        )
    await client.run(stop_event)


def main() -> int:
    try:
        asyncio.run(run())
    except KeyboardInterrupt:
        write_log("information", "Python Desktop Agent stopped.")
    except ValueError as error:
        write_log("error", str(error))
        return 1
    return 0
