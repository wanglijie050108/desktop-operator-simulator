namespace DesktopAgent.Core.Configuration;

public sealed record AgentOptions
{
    private static readonly HashSet<string> AllowedCapabilities =
    [
        "wechat.read",
        "wechat.send",
        "input",
        "clipboard",
        "screenshot",
    ];

    public required Uri ServerUri { get; init; }

    public required Guid AgentId { get; init; }

    public required string Name { get; init; }

    public required string Version { get; init; }

    public required IReadOnlyList<string> Capabilities { get; init; }

    public TimeSpan InitialReconnectDelay { get; init; } = TimeSpan.FromMilliseconds(250);

    public TimeSpan MaximumReconnectDelay { get; init; } = TimeSpan.FromSeconds(30);

    public void Validate()
    {
        if (ServerUri.Scheme is not ("ws" or "wss"))
        {
            throw new ArgumentException("ServerUri must use ws or wss.", nameof(ServerUri));
        }

        if (!ServerUri.IsLoopback)
        {
            throw new ArgumentException(
                "ServerUri must be loopback until authenticated remote access is implemented.",
                nameof(ServerUri));
        }

        if (AgentId == Guid.Empty)
        {
            throw new ArgumentException("AgentId must not be empty.", nameof(AgentId));
        }

        if (string.IsNullOrWhiteSpace(Name))
        {
            throw new ArgumentException("Name must not be empty.", nameof(Name));
        }

        if (string.IsNullOrWhiteSpace(Version))
        {
            throw new ArgumentException("Version must not be empty.", nameof(Version));
        }

        if (Capabilities.Any(capability => !AllowedCapabilities.Contains(capability)))
        {
            throw new ArgumentException(
                "Capabilities must contain only allowlisted values.",
                nameof(Capabilities));
        }

        if (InitialReconnectDelay <= TimeSpan.Zero ||
            MaximumReconnectDelay < InitialReconnectDelay)
        {
            throw new ArgumentException("Reconnect delay range is invalid.");
        }
    }
}
