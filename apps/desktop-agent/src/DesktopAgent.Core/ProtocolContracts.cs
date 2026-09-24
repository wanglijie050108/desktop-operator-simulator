using System.Text.Json;
using System.Text.Json.Serialization;

namespace DesktopAgent.Core.Contracts;

public static class ProtocolConstants
{
    public const string SchemaVersion = "1.0";
    public const int MaximumMessageBytes = 64 * 1024;
}

public static class MessageTypes
{
    public const string AgentHello = "agent.hello";
    public const string AgentHeartbeat = "agent.heartbeat";
    public const string ChatMessageReceived = "chat.message.received";
    public const string ServerWelcome = "server.welcome";
    public const string DesktopCommand = "desktop.command";
    public const string DesktopCommandResult = "desktop.command.result";
    public const string TaskCancel = "task.cancel";
    public const string EmergencyStop = "system.emergency-stop";
    public const string ServerError = "server.error";
}

[JsonConverter(typeof(JsonStringEnumConverter<AgentStatus>))]
public enum AgentStatus
{
    [JsonStringEnumMemberName("ONLINE")]
    Online,
    [JsonStringEnumMemberName("OFFLINE")]
    Offline,
    [JsonStringEnumMemberName("PAUSED")]
    Paused,
    [JsonStringEnumMemberName("BUSY")]
    Busy,
}

[JsonConverter(typeof(JsonStringEnumConverter<DesktopAction>))]
public enum DesktopAction
{
    [JsonStringEnumMemberName("WECHAT_READ_NEW_MESSAGES")]
    WeChatReadNewMessages,
    [JsonStringEnumMemberName("WECHAT_SEND_TEXT")]
    WeChatSendText,
    [JsonStringEnumMemberName("WINDOW_ACTIVATE")]
    WindowActivate,
    [JsonStringEnumMemberName("TAKE_SCREENSHOT")]
    TakeScreenshot,
    [JsonStringEnumMemberName("CLIPBOARD_SET_TEXT")]
    ClipboardSetText,
    [JsonStringEnumMemberName("INPUT_KEY_CHORD")]
    InputKeyChord,
}

[JsonConverter(typeof(JsonStringEnumConverter<CommandOutcome>))]
public enum CommandOutcome
{
    [JsonStringEnumMemberName("SUCCEEDED")]
    Succeeded,
    [JsonStringEnumMemberName("FAILED")]
    Failed,
    [JsonStringEnumMemberName("REJECTED")]
    Rejected,
}

public sealed record ProtocolMessage<TPayload>(
    string SchemaVersion,
    string Type,
    Guid MessageId,
    DateTimeOffset Timestamp,
    TPayload Payload);

public sealed record ProtocolMessageHeader(
    string SchemaVersion,
    string Type,
    Guid MessageId,
    DateTimeOffset Timestamp,
    JsonElement Payload);

public sealed record AgentHelloPayload(
    Guid AgentId,
    string Name,
    string Version,
    IReadOnlyList<string> Capabilities);

public sealed record AgentHeartbeatPayload(
    Guid AgentId,
    AgentStatus Status,
    Guid? ActiveCommandId = null);

public sealed record ChatMessageReceivedPayload(
    string Source,
    string ExternalMessageId,
    string ConversationId,
    string SenderId,
    string Content,
    DateTimeOffset ReceivedAt);

public sealed record ServerWelcomePayload(int HeartbeatIntervalMs, string ServerVersion);

public sealed record DesktopCommandPayload(
    Guid CommandId,
    Guid TaskId,
    DateTimeOffset ExpiresAt,
    DesktopAction Action,
    JsonElement Arguments);

public sealed record DesktopCommandResultPayload(
    Guid CommandId,
    Guid TaskId,
    CommandOutcome Outcome,
    string? ErrorCode = null);

public sealed record TaskCancelPayload(Guid TaskId);

public sealed record EmergencyStopPayload(string Reason);

public sealed record ProtocolErrorPayload(string Code, string Message);

public static class ProtocolSerializer
{
    public static JsonSerializerOptions Options { get; } = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = false,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        RespectNullableAnnotations = true,
        RespectRequiredConstructorParameters = true,
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
    };

    public static byte[] Serialize<TPayload>(ProtocolMessage<TPayload> message)
    {
        return JsonSerializer.SerializeToUtf8Bytes(message, Options);
    }

    public static ProtocolMessage<TPayload> Deserialize<TPayload>(
        ReadOnlySpan<byte> utf8Json,
        string expectedType)
    {
        var message = JsonSerializer.Deserialize<ProtocolMessage<TPayload>>(utf8Json, Options)
            ?? throw new JsonException("Protocol message must not be null.");

        if (!string.Equals(
                message.SchemaVersion,
                ProtocolConstants.SchemaVersion,
                StringComparison.Ordinal))
        {
            throw new JsonException($"Unsupported schema version '{message.SchemaVersion}'.");
        }

        if (!string.Equals(message.Type, expectedType, StringComparison.Ordinal))
        {
            throw new JsonException($"Expected message type '{expectedType}', got '{message.Type}'.");
        }

        if (message.MessageId == Guid.Empty)
        {
            throw new JsonException("messageId must be a non-empty UUID.");
        }

        if (message.Timestamp.Offset != TimeSpan.Zero)
        {
            throw new JsonException("timestamp must use UTC.");
        }

        return message;
    }
}
