using System.Text.Json;
using DesktopAgent.Core.Contracts;
using DesktopAgent.Core.Safety;

namespace DesktopAgent.Core.Tests;

public sealed class AgentCommandPolicyTests
{
    private static readonly DateTimeOffset Now =
        new(2026, 9, 24, 4, 0, 0, TimeSpan.Zero);

    [Fact]
    public void AllowsConfiguredActionWithinLifetime()
    {
        var policy = new AgentCommandPolicy();
        var command = CreateCommand(DesktopAction.WindowActivate, Now.AddMinutes(5));

        Assert.Null(policy.Evaluate(command, Now));
    }

    [Fact]
    public void DeniesActionOutsideAllowList()
    {
        var policy = new AgentCommandPolicy(
            new HashSet<DesktopAction> { DesktopAction.TakeScreenshot });
        var command = CreateCommand(DesktopAction.WindowActivate, Now.AddMinutes(5));

        Assert.Equal("POLICY_DENIED", policy.Evaluate(command, Now));
    }

    [Fact]
    public void RejectsExpiredCommand()
    {
        var policy = new AgentCommandPolicy();
        var command = CreateCommand(DesktopAction.WindowActivate, Now);

        Assert.Equal("COMMAND_EXPIRED", policy.Evaluate(command, Now));
    }

    [Fact]
    public void RejectsCommandExceedingMaximumLifetime()
    {
        var policy = new AgentCommandPolicy();
        var command = CreateCommand(DesktopAction.WindowActivate, Now.AddMinutes(11));

        Assert.Equal("COMMAND_EXPIRY_INVALID", policy.Evaluate(command, Now));
    }

    [Fact]
    public void RejectsInvalidPolicyConfiguration()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() =>
            new AgentCommandPolicy(maximumCommandLifetime: TimeSpan.Zero));
    }

    [Fact]
    public void ParsesAllowedActionsFromEnvironment()
    {
        var allowed = AgentCommandPolicy.ParseAllowedActions("WindowActivate,TakeScreenshot");

        Assert.Equal(
            new HashSet<DesktopAction>
            {
                DesktopAction.WindowActivate,
                DesktopAction.TakeScreenshot,
            },
            allowed);
    }

    [Fact]
    public void ParseEmptyValueReturnsAllActions()
    {
        var allowed = AgentCommandPolicy.ParseAllowedActions(null);

        Assert.Equal(Enum.GetValues<DesktopAction>().ToHashSet(), allowed);
    }

    [Fact]
    public void ParseUnknownActionThrows()
    {
        Assert.Throws<ArgumentException>(() =>
            AgentCommandPolicy.ParseAllowedActions("NotARealAction"));
    }

    private static DesktopCommandPayload CreateCommand(DesktopAction action, DateTimeOffset expiresAt)
    {
        using var document = JsonDocument.Parse("{}");
        return new DesktopCommandPayload(
            Guid.NewGuid(),
            Guid.NewGuid(),
            expiresAt,
            action,
            document.RootElement.Clone());
    }
}
