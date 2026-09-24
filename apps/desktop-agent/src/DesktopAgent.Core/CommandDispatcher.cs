using DesktopAgent.Core.Contracts;
using DesktopAgent.Core.Execution;
using DesktopAgent.Core.Safety;

namespace DesktopAgent.Core.Application;

public sealed class CommandDispatcher : IAsyncDisposable
{
    private readonly IDesktopActionExecutor executor;
    private readonly CommandDeduplicator deduplicator;
    private readonly TimeProvider timeProvider;
    private readonly SemaphoreSlim executionGate = new(1, 1);
    private readonly Lock stateGate = new();
    private readonly HashSet<Guid> cancelledTasks = [];
    private readonly Dictionary<Guid, ActiveCommand> activeCommands = [];
    private bool emergencyStopped;

    public CommandDispatcher(
        IDesktopActionExecutor executor,
        CommandDeduplicator deduplicator,
        TimeProvider? timeProvider = null)
    {
        this.executor = executor;
        this.deduplicator = deduplicator;
        this.timeProvider = timeProvider ?? TimeProvider.System;
    }

    public bool IsEmergencyStopped
    {
        get
        {
            lock (stateGate)
            {
                return emergencyStopped;
            }
        }
    }

    public async Task<CommandExecutionResult> DispatchAsync(
        DesktopCommandPayload command,
        CancellationToken cancellationToken)
    {
        if (!DesktopCommandValidator.IsValid(command))
        {
            return CommandExecutionResult.Rejected("INVALID_ARGUMENTS");
        }

        var now = timeProvider.GetUtcNow();
        if (command.ExpiresAt <= now)
        {
            return CommandExecutionResult.Rejected("COMMAND_EXPIRED");
        }

        if (!deduplicator.TryRegister(command.CommandId, now))
        {
            return CommandExecutionResult.Rejected("DUPLICATE_COMMAND");
        }

        CancellationTokenSource commandCancellation;
        lock (stateGate)
        {
            if (emergencyStopped)
            {
                return CommandExecutionResult.Rejected("POLICY_DENIED");
            }

            if (cancelledTasks.Contains(command.TaskId))
            {
                return CommandExecutionResult.Rejected("TASK_CANCELLED");
            }

            commandCancellation = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            activeCommands.Add(
                command.CommandId,
                new ActiveCommand(command.TaskId, commandCancellation));
        }

        var enteredExecutionGate = false;
        try
        {
            await executionGate.WaitAsync(commandCancellation.Token).ConfigureAwait(false);
            enteredExecutionGate = true;
            return await executor
                .ExecuteAsync(command, commandCancellation.Token)
                .ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (commandCancellation.IsCancellationRequested)
        {
            return CommandExecutionResult.Rejected("TASK_CANCELLED");
        }
        finally
        {
            if (enteredExecutionGate)
            {
                executionGate.Release();
            }

            lock (stateGate)
            {
                activeCommands.Remove(command.CommandId);
            }
            commandCancellation.Dispose();
        }
    }

    public void CancelTask(Guid taskId)
    {
        CancellationTokenSource[] matchingCommands;
        lock (stateGate)
        {
            cancelledTasks.Add(taskId);
            matchingCommands = activeCommands.Values
                .Where(active => active.TaskId == taskId)
                .Select(active => active.Cancellation)
                .ToArray();
        }

        foreach (var command in matchingCommands)
        {
            command.Cancel();
        }
    }

    public async Task EmergencyStopAsync(CancellationToken _)
    {
        CancellationTokenSource[] commands;
        lock (stateGate)
        {
            emergencyStopped = true;
            commands = activeCommands.Values.Select(active => active.Cancellation).ToArray();
        }

        foreach (var command in commands)
        {
            command.Cancel();
        }

        using var stopTimeout = new CancellationTokenSource(TimeSpan.FromSeconds(2));
        await executor.EmergencyStopAsync(stopTimeout.Token).ConfigureAwait(false);
    }

    public void ResetEmergencyStop()
    {
        lock (stateGate)
        {
            emergencyStopped = false;
        }
    }

    public async ValueTask DisposeAsync()
    {
        CancellationTokenSource[] commands;
        lock (stateGate)
        {
            commands = activeCommands.Values.Select(active => active.Cancellation).ToArray();
            activeCommands.Clear();
        }

        foreach (var command in commands)
        {
            command.Cancel();
        }

        if (await executionGate.WaitAsync(TimeSpan.FromSeconds(2)).ConfigureAwait(false))
        {
            executionGate.Release();
            executionGate.Dispose();
        }
    }

    private sealed record ActiveCommand(Guid TaskId, CancellationTokenSource Cancellation);
}
