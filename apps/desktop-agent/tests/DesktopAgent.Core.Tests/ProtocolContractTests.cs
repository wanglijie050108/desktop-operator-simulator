using System.Text.Json;
using System.Text;
using DesktopAgent.Core.Contracts;

namespace DesktopAgent.Core.Tests;

public sealed class ProtocolContractTests
{
    [Fact]
    public async Task SharedFixturesDeserializeWithStrictContracts()
    {
        var fixturePath = Path.Combine(
            AppContext.BaseDirectory,
            "Fixtures",
            "websocket-v1",
            "messages.json");
        await using var stream = File.OpenRead(fixturePath);
        using var document = await JsonDocument.ParseAsync(stream);

        foreach (var element in document.RootElement.EnumerateArray())
        {
            var json = JsonSerializer.SerializeToUtf8Bytes(element);
            var type = element.GetProperty("type").GetString();

            object parsed = type switch
            {
                MessageTypes.AgentHello => ProtocolSerializer.Deserialize<AgentHelloPayload>(
                    json,
                    MessageTypes.AgentHello),
                MessageTypes.AgentHeartbeat => ProtocolSerializer.Deserialize<AgentHeartbeatPayload>(
                    json,
                    MessageTypes.AgentHeartbeat),
                MessageTypes.ChatMessageReceived =>
                    ProtocolSerializer.Deserialize<ChatMessageReceivedPayload>(
                        json,
                        MessageTypes.ChatMessageReceived),
                MessageTypes.ServerWelcome => ProtocolSerializer.Deserialize<ServerWelcomePayload>(
                    json,
                    MessageTypes.ServerWelcome),
                MessageTypes.DesktopCommand => ProtocolSerializer.Deserialize<DesktopCommandPayload>(
                    json,
                    MessageTypes.DesktopCommand),
                MessageTypes.DesktopCommandResult =>
                    ProtocolSerializer.Deserialize<DesktopCommandResultPayload>(
                        json,
                        MessageTypes.DesktopCommandResult),
                MessageTypes.TaskCancel => ProtocolSerializer.Deserialize<TaskCancelPayload>(
                    json,
                    MessageTypes.TaskCancel),
                MessageTypes.EmergencyStop => ProtocolSerializer.Deserialize<EmergencyStopPayload>(
                    json,
                    MessageTypes.EmergencyStop),
                _ => throw new Xunit.Sdk.XunitException($"Unexpected fixture type '{type}'."),
            };
            Assert.NotNull(parsed);
        }
    }

    [Fact]
    public void UnknownPropertiesAreRejected()
    {
        const string json = """
            {
              "schemaVersion": "1.0",
              "type": "agent.hello",
              "messageId": "11111111-1111-4111-8111-111111111111",
              "timestamp": "2026-09-24T04:00:00Z",
              "payload": {
                "agentId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                "name": "fixture-agent",
                "version": "0.1.0",
                "capabilities": [],
                "arbitraryScript": "not allowed"
              }
            }
            """;

        Assert.Throws<JsonException>(() =>
            ProtocolSerializer.Deserialize<AgentHelloPayload>(
                Encoding.UTF8.GetBytes(json),
                MessageTypes.AgentHello));
    }

    [Fact]
    public void MissingRequiredPropertiesAreRejected()
    {
        const string json = """
            {
              "schemaVersion": "1.0",
              "type": "agent.hello",
              "messageId": "11111111-1111-4111-8111-111111111111",
              "timestamp": "2026-09-24T04:00:00Z"
            }
            """;

        Assert.Throws<JsonException>(() =>
            ProtocolSerializer.Deserialize<AgentHelloPayload>(
                Encoding.UTF8.GetBytes(json),
                MessageTypes.AgentHello));
    }

    [Theory]
    [InlineData("2.0", "agent.hello", "2026-09-24T04:00:00Z")]
    [InlineData("1.0", "wrong.type", "2026-09-24T04:00:00Z")]
    [InlineData("1.0", "agent.hello", "2026-09-24T12:00:00+08:00")]
    public void InvalidEnvelopeIsRejected(string schemaVersion, string type, string timestamp)
    {
        var json = $$"""
            {
              "schemaVersion": "{{schemaVersion}}",
              "type": "{{type}}",
              "messageId": "11111111-1111-4111-8111-111111111111",
              "timestamp": "{{timestamp}}",
              "payload": {
                "agentId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                "name": "fixture-agent",
                "version": "0.1.0",
                "capabilities": []
              }
            }
            """;

        Assert.Throws<JsonException>(() =>
            ProtocolSerializer.Deserialize<AgentHelloPayload>(
                Encoding.UTF8.GetBytes(json),
                MessageTypes.AgentHello));
    }

    [Fact]
    public void EmptyMessageIdIsRejected()
    {
        var message = new ProtocolMessage<AgentHelloPayload>(
            ProtocolConstants.SchemaVersion,
            MessageTypes.AgentHello,
            Guid.Empty,
            DateTimeOffset.UtcNow,
            new AgentHelloPayload(
                Guid.NewGuid(),
                "agent",
                "0.1.0",
                []));

        Assert.Throws<JsonException>(() =>
            ProtocolSerializer.Deserialize<AgentHelloPayload>(
                ProtocolSerializer.Serialize(message),
                MessageTypes.AgentHello));
    }

    [Fact]
    public void OptionalNullsAreOmittedAndEnumsUseContractNames()
    {
        var message = new ProtocolMessage<AgentHeartbeatPayload>(
            ProtocolConstants.SchemaVersion,
            MessageTypes.AgentHeartbeat,
            Guid.NewGuid(),
            DateTimeOffset.UtcNow,
            new AgentHeartbeatPayload(Guid.NewGuid(), AgentStatus.Paused));

        using var document = JsonDocument.Parse(ProtocolSerializer.Serialize(message));
        var payload = document.RootElement.GetProperty("payload");

        Assert.Equal("PAUSED", payload.GetProperty("status").GetString());
        Assert.False(payload.TryGetProperty("activeCommandId", out _));
    }
}
