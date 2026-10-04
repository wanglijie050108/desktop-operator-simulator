"""Console entry point for the Python Desktop Agent."""

from __future__ import annotations

import asyncio
import json
import signal
from datetime import UTC, datetime

from .client import AgentClient, AgentEventPump
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


def _create_wechat_pump(options: AgentOptions, read_event: asyncio.Event) -> AgentEventPump:
    # Imported lazily because the Windows backend import resolves pywinauto on Windows only.
    from .wechat_ingress import IdentityHasher, WeChatMessageEncoder, WeChatMessagePump
    from .wechat_source import WeChatUiAMessageSource
    from .windows_backend import PywinautoWindowsBackend

    hasher = IdentityHasher(options.identity_key)
    encoder = WeChatMessageEncoder(hasher)
    backend = PywinautoWindowsBackend()
    source = WeChatUiAMessageSource(backend, process_name=options.wechat_process_name)
    return WeChatMessagePump(
        source,
        encoder,
        trigger=read_event,
        log=lambda message: write_log("information", message),
    )


async def run() -> None:
    options = AgentOptions.from_environment()
    executor = (
        create_windows_executor(
            allowed_processes=options.allowed_processes,
            artifact_directory=options.artifact_directory,
            wechat_process_name=options.wechat_process_name,
            coordinate_mouse_profile=options.coordinate_mouse_profile,
        )
        if options.windows_automation_enabled
        else PlaceholderDesktopActionExecutor()
    )
    wechat_read_event = asyncio.Event()
    handler = CommandDispatcher(
        executor,
        policy=AgentCommandPolicy(options.allowed_actions),
        wechat_read_event=wechat_read_event,
    )
    message_pump = (
        _create_wechat_pump(options, wechat_read_event) if options.wechat_ingress_enabled else None
    )
    client = AgentClient(
        options,
        handler,
        message_pump=message_pump,
        log=lambda message: write_log("information", message),
    )
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
