using System.Text.Json;
using DesktopAgent.Core.Application;
using DesktopAgent.Core.Contracts;
using DesktopAgent.Core.Execution;

namespace DesktopAgent.Core.Tests;

public sealed class CommandDispatcherTests
{
    private static readonly DateTimeOffset Now =
        new(2026, 9, 24, 4, 0, 0, TimeSpan.Zero);

    [Fact]
    public async Task DispatchesAllowedCommandOnce()
    {
        var executor = new RecordingExecutor();
        await using var dispatcher = CreateDispatcher(executor);
        var command = CreateCommand();

        var first = await dispatcher.DispatchAsync(command, CancellationToken.None);
        var duplicate = await dispatcher.DispatchAsync(command, CancellationToken.None);

        Assert.Equal(CommandOutcome.Succeeded, first.Outcome);
        Assert.Equal(CommandOutcome.Rejected, duplicate.Outcome);
        Assert.Equal("DUPLICATE_COMMAND", duplicate.ErrorCode);
        Assert.Single(executor.ExecutedCommands);
    }

    [Fact]
    public async Task RejectsExpiredCommandWithoutCallingExecutor()
    {
        var executor = new RecordingExecutor();
        await using var dispatcher = CreateDispatcher(executor);
        var command = CreateCommand(expiresAt: Now);

        var result = await dispatcher.DispatchAsync(command, CancellationToken.None);

        Assert.Equal(CommandOutcome.Rejected, result.Outcome);
        Assert.Equal("COMMAND_EXPIRED", result.ErrorCode);
        Assert.Empty(executor.ExecutedCommands);
    }

    [Fact]
    public async Task RejectsInvalidArgumentsWithoutCallingExecutor()
    {
        var executor = new RecordingExecutor();
        await using var dispatcher = CreateDispatcher(executor);
        using var document = JsonDocument.Parse("""{"unexpected":true}""");
        var command = CreateCommand() with { Arguments = document.RootElement.Clone() };

        var result = await dispatcher.DispatchAsync(command, CancellationToken.None);

        Assert.Equal(CommandOutcome.Rejected, result.Outcome);
        Assert.Equal("INVALID_ARGUMENTS", result.ErrorCode);
        Assert.Empty(executor.ExecutedCommands);
    }

    [Fact]
    public async Task CancelledTaskCannotExecute()
    {
        var executor = new RecordingExecutor();
        await using var dispatcher = CreateDispatcher(executor);
        var command = CreateCommand();
        dispatcher.CancelTask(command.TaskId);

        var result = await dispatcher.DispatchAsync(command, CancellationToken.None);

        Assert.Equal("TASK_CANCELLED", result.ErrorCode);
        Assert.Empty(executor.ExecutedCommands);
    }

    [Fact]
    public async Task EmergencyStopCancelsActiveCommandAndPausesNewCommands()
    {
        var executor = new RecordingExecutor(blockUntilCancelled: true);
        await using var dispatcher = CreateDispatcher(executor);
        var activeCommand = CreateCommand();
        var activeTask = dispatcher.DispatchAsync(
            activeCommand,
            CancellationToken.None);
        await executor.Started.Task.WaitAsync(TimeSpan.FromSeconds(2));

        using var alreadyCancelled = new CancellationTokenSource();
        alreadyCancelled.Cancel();
        await dispatcher.EmergencyStopAsync(alreadyCancelled.Token);
        var activeResult = await activeTask;
        var pausedResult = await dispatcher.DispatchAsync(
            CreateCommand(),
            CancellationToken.None);

        Assert.True(dispatcher.IsEmergencyStopped);
        Assert.Equal("TASK_CANCELLED", activeResult.ErrorCode);
        Assert.Equal("POLICY_DENIED", pausedResult.ErrorCode);
        Assert.Equal(1, executor.EmergencyStopCount);

        dispatcher.ResetEmergencyStop();
        Assert.False(dispatcher.IsEmergencyStopped);
    }

    [Fact]
    public void DeduplicatorExpiresAndEvictsEntries()
    {
        var deduplicator = new CommandDeduplicator(TimeSpan.FromMinutes(1), capacity: 1);
        var first = Guid.NewGuid();
        var second = Guid.NewGuid();

        Assert.True(deduplicator.TryRegister(first, Now));
        Assert.True(deduplicator.TryRegister(second, Now.AddSeconds(1)));
        Assert.True(deduplicator.TryRegister(first, Now.AddSeconds(2)));
        Assert.True(deduplicator.TryRegister(first, Now.AddMinutes(2)));
    }

    [Fact]
    public void DeduplicatorRejectsInvalidConfigurationAndIds()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() =>
            new CommandDeduplicator(TimeSpan.Zero, capacity: 1));
        Assert.Throws<ArgumentOutOfRangeException>(() =>
            new CommandDeduplicator(TimeSpan.FromMinutes(1), capacity: 0));

        var deduplicator = new CommandDeduplicator(TimeSpan.FromMinutes(1), capacity: 1);
        Assert.Throws<ArgumentException>(() => deduplicator.TryRegister(Guid.Empty, Now));
    }

    private static CommandDispatcher CreateDispatcher(RecordingExecutor executor)
    {
        return new CommandDispatcher(
            executor,
            new CommandDeduplicator(TimeSpan.FromHours(1), capacity: 100),
            new FixedTimeProvider(Now));
    }

    private static DesktopCommandPayload CreateCommand(DateTimeOffset? expiresAt = null)
    {
        using var document = JsonDocument.Parse("{}");
        return new DesktopCommandPayload(
            Guid.NewGuid(),
            Guid.NewGuid(),
            expiresAt ?? Now.AddMinutes(1),
            DesktopAction.WeChatReadNewMessages,
            document.RootElement.Clone());
    }

    private sealed class FixedTimeProvider(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }

    private sealed class RecordingExecutor(bool blockUntilCancelled = false) : IDesktopActionExecutor
    {
        public List<DesktopCommandPayload> ExecutedCommands { get; } = [];

        public TaskCompletionSource Started { get; } =
            new(TaskCreationOptions.RunContinuationsAsynchronously);

        public int EmergencyStopCount { get; private set; }

        public async Task<CommandExecutionResult> ExecuteAsync(
            DesktopCommandPayload command,
            CancellationToken cancellationToken)
        {
            ExecutedCommands.Add(command);
            Started.TrySetResult();
            if (blockUntilCancelled)
            {
                await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken);
            }
            return CommandExecutionResult.Succeeded;
        }

        public Task EmergencyStopAsync(CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            EmergencyStopCount += 1;
            return Task.CompletedTask;
        }
    }
}
