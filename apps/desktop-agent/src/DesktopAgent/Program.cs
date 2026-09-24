using System.Text.Json;
using DesktopAgent;
using DesktopAgent.Core.Application;
using DesktopAgent.Core.Configuration;
using DesktopAgent.Core.Safety;

const string defaultAgentId = "00000000-0000-4000-8000-000000000001";
var serverUri = new Uri(
    Environment.GetEnvironmentVariable("CONTROL_SERVER_WS_URL")
    ?? "ws://127.0.0.1:7070/ws/agent");
var agentId = Guid.Parse(Environment.GetEnvironmentVariable("AGENT_ID") ?? defaultAgentId);
var agentName = Environment.GetEnvironmentVariable("AGENT_NAME") ?? "placeholder-agent";

var options = new AgentOptions
{
    ServerUri = serverUri,
    AgentId = agentId,
    Name = agentName,
    Version = "0.1.0",
    Capabilities = [],
};

using var shutdown = new CancellationTokenSource();
Console.CancelKeyPress += (_, eventArgs) =>
{
    eventArgs.Cancel = true;
    shutdown.Cancel();
};

WriteLog("warning", "Desktop actions use a placeholder executor and will return NOT_IMPLEMENTED.");

var allowedActions = AgentCommandPolicy.ParseAllowedActions(
    Environment.GetEnvironmentVariable("AGENT_ALLOWED_ACTIONS"));
var policy = new AgentCommandPolicy(allowedActions);

await using var dispatcher = new CommandDispatcher(
    new PlaceholderDesktopActionExecutor(),
    new CommandDeduplicator(TimeSpan.FromHours(24), capacity: 10_000),
    policy: policy);
var client = new AgentClient(options, dispatcher, log: message => WriteLog("information", message));

try
{
    await client.RunAsync(shutdown.Token);
}
catch (OperationCanceledException) when (shutdown.IsCancellationRequested)
{
    WriteLog("information", "Desktop Agent stopped.");
}

static void WriteLog(string level, string message)
{
    Console.WriteLine(JsonSerializer.Serialize(new
    {
        timestamp = DateTimeOffset.UtcNow,
        level,
        message,
    }));
}
