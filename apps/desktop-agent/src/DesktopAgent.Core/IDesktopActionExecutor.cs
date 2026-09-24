using DesktopAgent.Core.Contracts;

namespace DesktopAgent.Core.Execution;

public sealed record CommandExecutionResult(CommandOutcome Outcome, string? ErrorCode = null)
{
    public static CommandExecutionResult Succeeded { get; } = new(CommandOutcome.Succeeded);

    public static CommandExecutionResult Failed(string errorCode)
    {
        return new CommandExecutionResult(CommandOutcome.Failed, errorCode);
    }

    public static CommandExecutionResult Rejected(string errorCode)
    {
        return new CommandExecutionResult(CommandOutcome.Rejected, errorCode);
    }
}

public interface IDesktopActionExecutor
{
    Task<CommandExecutionResult> ExecuteAsync(
        DesktopCommandPayload command,
        CancellationToken cancellationToken);

    Task EmergencyStopAsync(CancellationToken cancellationToken);
}
