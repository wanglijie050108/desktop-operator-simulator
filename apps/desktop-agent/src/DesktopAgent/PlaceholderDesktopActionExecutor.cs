using DesktopAgent.Core.Contracts;
using DesktopAgent.Core.Execution;

namespace DesktopAgent;

internal sealed class PlaceholderDesktopActionExecutor : IDesktopActionExecutor
{
    public Task<CommandExecutionResult> ExecuteAsync(
        DesktopCommandPayload command,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();

        // This C# agent is the retained migration-period reference and fallback (docs/06 ADR-007);
        // Windows desktop automation is implemented in Python with pywinauto and FlaUI work is not
        // planned. Keep returning a stable failure code for every action: never report success for
        // an operation that was not performed, and never weaken this placeholder to satisfy a test.
        return Task.FromResult(CommandExecutionResult.Failed("NOT_IMPLEMENTED"));
    }

    public Task EmergencyStopAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();

        // Emergency input release is owned by the Python executor, which must release every held
        // key and mouse button within two seconds (docs/05 AT-10). This fallback performs no input,
        // so it has nothing to release.
        return Task.CompletedTask;
    }
}
