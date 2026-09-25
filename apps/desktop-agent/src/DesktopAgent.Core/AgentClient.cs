using System.Buffers;
using System.Net.WebSockets;
using System.Text.Json;
using System.Threading.Channels;
using DesktopAgent.Core.Configuration;
using DesktopAgent.Core.Contracts;
using DesktopAgent.Core.Execution;
using DesktopAgent.Core.Safety;

namespace DesktopAgent.Core.Application;

public sealed class AgentClient
{
    private readonly AgentOptions options;
    private readonly CommandDispatcher dispatcher;
    private readonly TimeProvider timeProvider;
    private readonly Action<string> log;

    public AgentClient(
        AgentOptions options,
        CommandDispatcher dispatcher,
        TimeProvider? timeProvider = null,
        Action<string>? log = null)
    {
        options.Validate();
        this.options = options;
        this.dispatcher = dispatcher;
        this.timeProvider = timeProvider ?? TimeProvider.System;
        this.log = log ?? (_ => { });
    }

    public async Task RunAsync(CancellationToken cancellationToken)
    {
        var reconnectDelay = options.InitialReconnectDelay;

        while (!cancellationToken.IsCancellationRequested)
        {
            try
            {
                await RunSessionAsync(cancellationToken).ConfigureAwait(false);
                reconnectDelay = options.InitialReconnectDelay;
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception exception)
            {
                log($"Agent connection failed: {FormatDiagnostic(exception)}");
            }

            // A session can end because the run token was cancelled (for example while
            // a command was executing); stop without entering the reconnect backoff.
            if (cancellationToken.IsCancellationRequested)
            {
                return;
            }

            try
            {
                await Task.Delay(reconnectDelay, timeProvider, cancellationToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                // Cancellation may also arrive while the backoff is running.
                return;
            }

            reconnectDelay = TimeSpan.FromMilliseconds(
                Math.Min(reconnectDelay.TotalMilliseconds * 2, options.MaximumReconnectDelay.TotalMilliseconds));
        }
    }

    private async Task RunSessionAsync(CancellationToken cancellationToken)
    {
        using var socket = new ClientWebSocket();
        await socket.ConnectAsync(options.ServerUri, cancellationToken).ConfigureAwait(false);

        using var sendGate = new SemaphoreSlim(1, 1);
        await SendAsync(socket, CreateHello(), sendGate, cancellationToken).ConfigureAwait(false);

        var welcomeBytes = await ReceiveMessageAsync(socket, cancellationToken).ConfigureAwait(false);
        var welcome = ProtocolSerializer.Deserialize<ServerWelcomePayload>(
            welcomeBytes,
            MessageTypes.ServerWelcome);
        if (welcome.Payload.HeartbeatIntervalMs is < 1_000 or > 60_000)
        {
            throw new JsonException("Server heartbeat interval is outside the supported range.");
        }

        using var sessionCancellation =
            CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);

        // Desktop commands are queued and executed by a single serial worker so the
        // receive loop keeps draining: control frames (cancel/emergency-stop) must be
        // honoured even while a command is running.
        var commandChannel = Channel.CreateUnbounded<DesktopCommandPayload>(
            new UnboundedChannelOptions
            {
                SingleReader = true,
                SingleWriter = true,
            });

        var receiveTask = ReceiveLoopAsync(
            socket,
            commandChannel,
            sessionCancellation.Token);
        var heartbeatTask = HeartbeatLoopAsync(
            socket,
            sendGate,
            TimeSpan.FromMilliseconds(welcome.Payload.HeartbeatIntervalMs),
            sessionCancellation.Token);
        var commandTask = CommandLoopAsync(
            socket,
            sendGate,
            commandChannel.Reader,
            sessionCancellation.Token);

        await Task.WhenAny(receiveTask, heartbeatTask, commandTask).ConfigureAwait(false);
        await sessionCancellation.CancelAsync().ConfigureAwait(false);
        commandChannel.Writer.TryComplete();

        try
        {
            await Task.WhenAll(receiveTask, heartbeatTask, commandTask).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (sessionCancellation.IsCancellationRequested)
        {
        }
    }

    private async Task ReceiveLoopAsync(
        ClientWebSocket socket,
        Channel<DesktopCommandPayload> commandChannel,
        CancellationToken cancellationToken)
    {
        while (socket.State == WebSocketState.Open)
        {
            var messageBytes = await ReceiveMessageAsync(socket, cancellationToken).ConfigureAwait(false);
            var header = JsonSerializer.Deserialize<ProtocolMessageHeader>(
                messageBytes,
                ProtocolSerializer.Options) ?? throw new JsonException("Message header is missing.");

            switch (header.Type)
            {
                case MessageTypes.DesktopCommand:
                    var command = ProtocolSerializer.Deserialize<DesktopCommandPayload>(
                        messageBytes,
                        MessageTypes.DesktopCommand);
                    commandChannel.Writer.TryWrite(command.Payload);
                    break;
                case MessageTypes.TaskCancel:
                    var cancel = ProtocolSerializer.Deserialize<TaskCancelPayload>(
                        messageBytes,
                        MessageTypes.TaskCancel);
                    dispatcher.CancelTask(cancel.Payload.TaskId);
                    break;
                case MessageTypes.EmergencyStop:
                    _ = ProtocolSerializer.Deserialize<EmergencyStopPayload>(
                        messageBytes,
                        MessageTypes.EmergencyStop);
                    await dispatcher.EmergencyStopAsync(cancellationToken).ConfigureAwait(false);
                    break;
                case MessageTypes.ServerError:
                    var error = ProtocolSerializer.Deserialize<ProtocolErrorPayload>(
                        messageBytes,
                        MessageTypes.ServerError);
                    throw new InvalidOperationException($"Server rejected Agent message: {error.Payload.Code}");
                default:
                    throw new JsonException($"Unsupported server message type '{header.Type}'.");
            }
        }
    }

    private async Task CommandLoopAsync(
        ClientWebSocket socket,
        SemaphoreSlim sendGate,
        ChannelReader<DesktopCommandPayload> commands,
        CancellationToken cancellationToken)
    {
        try
        {
            while (await commands.WaitToReadAsync(cancellationToken).ConfigureAwait(false))
            {
                while (commands.TryRead(out var command))
                {
                    await ProcessCommandAsync(
                        socket,
                        sendGate,
                        command,
                        cancellationToken).ConfigureAwait(false);
                }
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
        }
    }

    private async Task ProcessCommandAsync(
        ClientWebSocket socket,
        SemaphoreSlim sendGate,
        DesktopCommandPayload command,
        CancellationToken cancellationToken)
    {
        CommandExecutionResult result;
        try
        {
            result = await dispatcher
                .DispatchAsync(command, cancellationToken)
                .ConfigureAwait(false);
        }
        catch (Exception exception)
        {
            log($"Desktop command failed unexpectedly: {FormatDiagnostic(exception)}");
            result = CommandExecutionResult.Failed("DESKTOP_ACTION_FAILED");
        }

        // The session is ending; the result can no longer be delivered.
        if (socket.State != WebSocketState.Open)
        {
            return;
        }

        var response = new ProtocolMessage<DesktopCommandResultPayload>(
            ProtocolConstants.SchemaVersion,
            MessageTypes.DesktopCommandResult,
            Guid.NewGuid(),
            timeProvider.GetUtcNow(),
            new DesktopCommandResultPayload(
                command.CommandId,
                command.TaskId,
                result.Outcome,
                result.ErrorCode));

        try
        {
            await SendAsync(socket, response, sendGate, cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
        }
    }

    private async Task HeartbeatLoopAsync(
        ClientWebSocket socket,
        SemaphoreSlim sendGate,
        TimeSpan interval,
        CancellationToken cancellationToken)
    {
        using var timer = new PeriodicTimer(interval, timeProvider);
        while (await timer.WaitForNextTickAsync(cancellationToken).ConfigureAwait(false))
        {
            var status = dispatcher.IsEmergencyStopped ? AgentStatus.Paused : AgentStatus.Online;
            var heartbeat = new ProtocolMessage<AgentHeartbeatPayload>(
                ProtocolConstants.SchemaVersion,
                MessageTypes.AgentHeartbeat,
                Guid.NewGuid(),
                timeProvider.GetUtcNow(),
                new AgentHeartbeatPayload(options.AgentId, status));
            await SendAsync(socket, heartbeat, sendGate, cancellationToken).ConfigureAwait(false);
        }
    }

    private ProtocolMessage<AgentHelloPayload> CreateHello()
    {
        return new ProtocolMessage<AgentHelloPayload>(
            ProtocolConstants.SchemaVersion,
            MessageTypes.AgentHello,
            Guid.NewGuid(),
            timeProvider.GetUtcNow(),
            new AgentHelloPayload(
                options.AgentId,
                options.Name,
                options.Version,
                options.Capabilities));
    }

    private static async Task SendAsync<TPayload>(
        ClientWebSocket socket,
        ProtocolMessage<TPayload> message,
        SemaphoreSlim sendGate,
        CancellationToken cancellationToken)
    {
        var bytes = ProtocolSerializer.Serialize(message);
        await sendGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            await socket.SendAsync(
                bytes,
                WebSocketMessageType.Text,
                endOfMessage: true,
                cancellationToken).ConfigureAwait(false);
        }
        finally
        {
            sendGate.Release();
        }
    }

    private static async Task<byte[]> ReceiveMessageAsync(
        ClientWebSocket socket,
        CancellationToken cancellationToken)
    {
        var rentedBuffer = ArrayPool<byte>.Shared.Rent(8 * 1024);
        try
        {
            using var message = new MemoryStream();
            while (true)
            {
                var result = await socket
                    .ReceiveAsync(rentedBuffer, cancellationToken)
                    .ConfigureAwait(false);
                if (result.MessageType == WebSocketMessageType.Close)
                {
                    throw new WebSocketException("Server closed the Agent connection.");
                }

                if (result.MessageType != WebSocketMessageType.Text)
                {
                    throw new WebSocketException("Only text WebSocket messages are supported.");
                }

                message.Write(rentedBuffer, 0, result.Count);
                if (message.Length > ProtocolConstants.MaximumMessageBytes)
                {
                    throw new WebSocketException("WebSocket message exceeds the size limit.");
                }

                if (result.EndOfMessage)
                {
                    return message.ToArray();
                }
            }
        }
        finally
        {
            ArrayPool<byte>.Shared.Return(rentedBuffer);
        }
    }

    private static string FormatDiagnostic(Exception exception)
    {
        var message = LogRedactor.Redact(exception.Message)
            .Replace('\r', ' ')
            .Replace('\n', ' ');
        if (message.Length > 200)
        {
            message = message[..200];
        }
        return $"{exception.GetType().Name}: {message}";
    }
}
