using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Net.WebSockets;
using System.Text.Json;
using DesktopAgent.Core.Application;
using DesktopAgent.Core.Configuration;
using DesktopAgent.Core.Contracts;
using DesktopAgent.Core.Execution;
using DesktopAgent.Core.Safety;

namespace DesktopAgent.Core.Tests;

public sealed class AgentClientTests
{
    private static readonly TimeSpan TestTimeout = TimeSpan.FromSeconds(15);

    [Fact]
    public async Task SuccessfulCommandReturnsSucceededResult()
    {
        var executor = new ControlledExecutor(blockUntilReleased: true);
        await using var server = new TestWebSocketServer();
        await using var dispatcher = CreateDispatcher(executor);
        var client = CreateClient(server.Port, dispatcher);
        await using var run = AgentRunHandle.Start(client);

        await server.AcceptAsync();
        await CompleteHandshakeAsync(server);

        var command = CreateCommand();
        await server.SendMessageAsync(MessageTypes.DesktopCommand, command);
        await executor.Started.Task.WaitAsync(TestTimeout);

        executor.Release();

        var result = await server.ReceiveMessageAsync<DesktopCommandResultPayload>(
            MessageTypes.DesktopCommandResult);
        Assert.Equal(command.CommandId, result.Payload.CommandId);
        Assert.Equal(CommandOutcome.Succeeded, result.Payload.Outcome);
        Assert.Null(result.Payload.ErrorCode);
    }

    [Fact]
    public async Task CancelFrameInterruptsRunningCommandImmediately()
    {
        var executor = new ControlledExecutor(blockUntilReleased: true);
        await using var server = new TestWebSocketServer();
        await using var dispatcher = CreateDispatcher(executor);
        var client = CreateClient(server.Port, dispatcher);
        await using var run = AgentRunHandle.Start(client);

        await server.AcceptAsync();
        await CompleteHandshakeAsync(server);

        var command = CreateCommand();
        await server.SendMessageAsync(MessageTypes.DesktopCommand, command);
        await executor.Started.Task.WaitAsync(TestTimeout);

        var cancelSentAt = Stopwatch.GetTimestamp();
        await server.SendMessageAsync(
            MessageTypes.TaskCancel,
            new TaskCancelPayload(command.TaskId));

        // H1 regression: while the command is running the receive loop must keep
        // draining, so the cancel frame reaches the dispatcher immediately.
        await executor.CancelObserved.Task.WaitAsync(TestTimeout);
        var cancelLatency = Stopwatch.GetElapsedTime(cancelSentAt);
        Assert.True(
            cancelLatency < TimeSpan.FromSeconds(2),
            $"Cancel took {cancelLatency.TotalMilliseconds} ms to reach the executor.");

        var result = await server.ReceiveMessageAsync<DesktopCommandResultPayload>(
            MessageTypes.DesktopCommandResult);
        Assert.Equal(command.CommandId, result.Payload.CommandId);
        Assert.Equal(CommandOutcome.Rejected, result.Payload.Outcome);
        Assert.Equal("TASK_CANCELLED", result.Payload.ErrorCode);
    }

    [Fact]
    public async Task EmergencyStopFrameInterruptsCommandAndRejectsFollowUp()
    {
        var executor = new ControlledExecutor(blockUntilReleased: true);
        await using var server = new TestWebSocketServer();
        await using var dispatcher = CreateDispatcher(executor);
        var client = CreateClient(server.Port, dispatcher);
        await using var run = AgentRunHandle.Start(client);

        await server.AcceptAsync();
        await CompleteHandshakeAsync(server);

        var command = CreateCommand();
        await server.SendMessageAsync(MessageTypes.DesktopCommand, command);
        await executor.Started.Task.WaitAsync(TestTimeout);

        await server.SendMessageAsync(
            MessageTypes.EmergencyStop,
            new EmergencyStopPayload("operator triggered"));

        var activeResult = await server.ReceiveMessageAsync<DesktopCommandResultPayload>(
            MessageTypes.DesktopCommandResult);
        Assert.Equal(command.CommandId, activeResult.Payload.CommandId);
        Assert.Equal(CommandOutcome.Rejected, activeResult.Payload.Outcome);
        Assert.Equal("TASK_CANCELLED", activeResult.Payload.ErrorCode);
        Assert.Equal(1, executor.EmergencyStopCount);

        var followUp = CreateCommand();
        await server.SendMessageAsync(MessageTypes.DesktopCommand, followUp);
        var followUpResult = await server.ReceiveMessageAsync<DesktopCommandResultPayload>(
            MessageTypes.DesktopCommandResult);
        Assert.Equal(followUp.CommandId, followUpResult.Payload.CommandId);
        Assert.Equal(CommandOutcome.Rejected, followUpResult.Payload.Outcome);
        Assert.Equal("POLICY_DENIED", followUpResult.Payload.ErrorCode);
    }

    private static async Task CompleteHandshakeAsync(TestWebSocketServer server)
    {
        var hello = await server.ReceiveMessageAsync<AgentHelloPayload>(MessageTypes.AgentHello);
        Assert.Equal(ProtocolConstants.SchemaVersion, hello.SchemaVersion);
        await server.SendMessageAsync(
            MessageTypes.ServerWelcome,
            new ServerWelcomePayload(HeartbeatIntervalMs: 30_000, ServerVersion: "test"));
    }

    private static CommandDispatcher CreateDispatcher(ControlledExecutor executor)
    {
        return new CommandDispatcher(
            executor,
            new CommandDeduplicator(TimeSpan.FromHours(24), capacity: 10_000));
    }

    private static AgentClient CreateClient(int port, CommandDispatcher dispatcher)
    {
        var options = new AgentOptions
        {
            ServerUri = new Uri($"ws://127.0.0.1:{port}/"),
            AgentId = Guid.NewGuid(),
            Name = "test-agent",
            Version = "1.0.0",
            Capabilities = ["wechat.read", "input"],
        };
        return new AgentClient(options, dispatcher);
    }

    private static DesktopCommandPayload CreateCommand()
    {
        using var document = JsonDocument.Parse("{}");
        return new DesktopCommandPayload(
            Guid.NewGuid(),
            Guid.NewGuid(),
            DateTimeOffset.UtcNow.AddMinutes(5),
            DesktopAction.WeChatReadNewMessages,
            document.RootElement.Clone());
    }

    private sealed class AgentRunHandle : IAsyncDisposable
    {
        private readonly CancellationTokenSource cancellation = new();
        private Task runTask = Task.CompletedTask;

        public static AgentRunHandle Start(AgentClient client)
        {
            var handle = new AgentRunHandle();
            handle.runTask = client.RunAsync(handle.cancellation.Token);
            return handle;
        }

        public async ValueTask DisposeAsync()
        {
            await cancellation.CancelAsync();
            try
            {
                await runTask.WaitAsync(TimeSpan.FromSeconds(5));
            }
            catch (Exception)
            {
                // Behaviour is asserted through the exchanged frames; faults during
                // shutdown must not hide the test body's result.
            }

            cancellation.Dispose();
        }
    }

    private sealed class ControlledExecutor(bool blockUntilReleased) : IDesktopActionExecutor
    {
        private readonly TaskCompletionSource release =
            new(TaskCreationOptions.RunContinuationsAsynchronously);

        public TaskCompletionSource Started { get; } =
            new(TaskCreationOptions.RunContinuationsAsynchronously);

        public TaskCompletionSource CancelObserved { get; } =
            new(TaskCreationOptions.RunContinuationsAsynchronously);

        public int EmergencyStopCount { get; private set; }

        public void Release() => release.TrySetResult();

        public async Task<CommandExecutionResult> ExecuteAsync(
            DesktopCommandPayload command,
            CancellationToken cancellationToken)
        {
            Started.TrySetResult();
            if (blockUntilReleased)
            {
                cancellationToken.Register(() => CancelObserved.TrySetResult());
                var cancelled = Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken);
                await Task.WhenAny(release.Task, cancelled).ConfigureAwait(false);
                cancellationToken.ThrowIfCancellationRequested();
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

    private sealed class TestWebSocketServer : IAsyncDisposable
    {
        private readonly HttpListener listener;
        private WebSocket? webSocket;

        public TestWebSocketServer()
        {
            Port = GetFreePort();
            listener = new HttpListener();
            listener.Prefixes.Add($"http://127.0.0.1:{Port}/");
            listener.Start();
        }

        public int Port { get; }

        public async Task AcceptAsync()
        {
            var context = await listener.GetContextAsync().ConfigureAwait(false);
            var webSocketContext = await context
                .AcceptWebSocketAsync(subProtocol: null)
                .ConfigureAwait(false);
            webSocket = webSocketContext.WebSocket;
        }

        public async Task SendMessageAsync<TPayload>(
            string type,
            TPayload payload,
            CancellationToken cancellationToken = default)
        {
            var message = new ProtocolMessage<TPayload>(
                ProtocolConstants.SchemaVersion,
                type,
                Guid.NewGuid(),
                DateTimeOffset.UtcNow,
                payload);
            var bytes = ProtocolSerializer.Serialize(message);
            using var timeout = CreateTimeout(cancellationToken);
            await webSocket!
                .SendAsync(bytes, WebSocketMessageType.Text, endOfMessage: true, timeout.Token)
                .ConfigureAwait(false);
        }

        public async Task<ProtocolMessage<TPayload>> ReceiveMessageAsync<TPayload>(
            string expectedType,
            CancellationToken cancellationToken = default)
        {
            using var timeout = CreateTimeout(cancellationToken);
            var buffer = new byte[8 * 1024];
            using var message = new MemoryStream();
            while (true)
            {
                var result = await webSocket!
                    .ReceiveAsync(buffer, timeout.Token)
                    .ConfigureAwait(false);
                if (result.MessageType == WebSocketMessageType.Close)
                {
                    throw new WebSocketException("Server received an unexpected close frame.");
                }

                message.Write(buffer, 0, result.Count);
                if (result.EndOfMessage)
                {
                    return ProtocolSerializer.Deserialize<TPayload>(
                        message.ToArray(),
                        expectedType);
                }
            }
        }

        private static CancellationTokenSource CreateTimeout(CancellationToken cancellationToken)
        {
            var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeout.CancelAfter(TestTimeout);
            return timeout;
        }

        private static int GetFreePort()
        {
            var portProbe = new TcpListener(IPAddress.Loopback, 0);
            portProbe.Start();
            var port = ((IPEndPoint)portProbe.LocalEndpoint).Port;
            portProbe.Stop();
            return port;
        }

        public ValueTask DisposeAsync()
        {
            webSocket?.Dispose();
            listener.Stop();
            listener.Close();
            return ValueTask.CompletedTask;
        }
    }
}
