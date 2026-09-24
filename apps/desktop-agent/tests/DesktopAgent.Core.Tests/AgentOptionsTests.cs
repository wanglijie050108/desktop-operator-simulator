using DesktopAgent.Core.Configuration;

namespace DesktopAgent.Core.Tests;

public sealed class AgentOptionsTests
{
    [Fact]
    public void AcceptsLoopbackWebSocketWithAllowlistedCapabilities()
    {
        var options = CreateOptions();

        options.Validate();
    }

    [Theory]
    [InlineData("https://127.0.0.1:7070/ws/agent")]
    [InlineData("ws://192.168.1.20:7070/ws/agent")]
    public void RejectsUnsupportedOrRemoteEndpoint(string uri)
    {
        var options = CreateOptions() with { ServerUri = new Uri(uri) };

        Assert.Throws<ArgumentException>(options.Validate);
    }

    [Fact]
    public void RejectsUnknownCapability()
    {
        var options = CreateOptions() with { Capabilities = ["shell.execute"] };

        Assert.Throws<ArgumentException>(options.Validate);
    }

    [Fact]
    public void RejectsInvalidIdentityAndReconnectConfiguration()
    {
        Assert.Throws<ArgumentException>((CreateOptions() with { AgentId = Guid.Empty }).Validate);
        Assert.Throws<ArgumentException>((CreateOptions() with { Name = " " }).Validate);
        Assert.Throws<ArgumentException>((CreateOptions() with { Version = "" }).Validate);
        Assert.Throws<ArgumentException>(
            (CreateOptions() with { InitialReconnectDelay = TimeSpan.Zero }).Validate);
        Assert.Throws<ArgumentException>(
            (CreateOptions() with
            {
                InitialReconnectDelay = TimeSpan.FromSeconds(2),
                MaximumReconnectDelay = TimeSpan.FromSeconds(1),
            }).Validate);
    }

    private static AgentOptions CreateOptions()
    {
        return new AgentOptions
        {
            ServerUri = new Uri("ws://127.0.0.1:7070/ws/agent"),
            AgentId = Guid.NewGuid(),
            Name = "test-agent",
            Version = "0.1.0",
            Capabilities = ["wechat.read"],
        };
    }
}
