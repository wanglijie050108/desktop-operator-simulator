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

        // TODO(windows-integration): Replace this class with a Windows-targeted executor after M0.
        // Each action must use FlaUI/UIA or a narrowly scoped Windows API implementation, verify
        // the foreground process and window immediately before input, and return observable failure
        // codes. Never change this placeholder to report success for an operation it did not perform.
        return Task.FromResult(CommandExecutionResult.Failed("NOT_IMPLEMENTED"));
    }

    public Task EmergencyStopAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();

        // TODO(windows-integration): The Windows implementation must release every held key/button,
        // clear its execution queue, and prove the operation completes within two seconds.
        return Task.CompletedTask;
    }
}
