using DesktopAgent.Core.Contracts;

namespace DesktopAgent.Core.Safety;

/// <summary>
/// Independent Desktop Agent policy. It mirrors the Control Server checks so that a
/// misconfigured or compromised server cannot make the agent execute unknown actions or
/// honour commands that remain valid for an unreasonably long time.
/// </summary>
public sealed class AgentCommandPolicy
{
    public static readonly TimeSpan DefaultMaximumCommandLifetime = TimeSpan.FromMinutes(10);

    private readonly HashSet<DesktopAction> allowedActions;
    private readonly TimeSpan maximumCommandLifetime;

    public AgentCommandPolicy(
        IReadOnlySet<DesktopAction>? allowedActions = null,
        TimeSpan? maximumCommandLifetime = null)
    {
        this.allowedActions = allowedActions is { Count: > 0 }
            ? allowedActions.ToHashSet()
            : Enum.GetValues<DesktopAction>().ToHashSet();

        var lifetime = maximumCommandLifetime ?? DefaultMaximumCommandLifetime;
        if (lifetime <= TimeSpan.Zero)
        {
            throw new ArgumentOutOfRangeException(
                nameof(maximumCommandLifetime),
                "Command lifetime must be positive.");
        }

        this.maximumCommandLifetime = lifetime;
    }

    /// <summary>
    /// Returns null when the command is allowed, otherwise a stable rejection code.
    /// </summary>
    public string? Evaluate(DesktopCommandPayload command, DateTimeOffset now)
    {
        if (!allowedActions.Contains(command.Action))
        {
            return "POLICY_DENIED";
        }

        var lifetime = command.ExpiresAt - now;
        if (lifetime <= TimeSpan.Zero)
        {
            return "COMMAND_EXPIRED";
        }

        if (lifetime > maximumCommandLifetime)
        {
            return "COMMAND_EXPIRY_INVALID";
        }

        return null;
    }

    public static IReadOnlySet<DesktopAction> ParseAllowedActions(string? commaSeparated)
    {
        var selected = new HashSet<DesktopAction>();
        if (string.IsNullOrWhiteSpace(commaSeparated))
        {
            return Enum.GetValues<DesktopAction>().ToHashSet();
        }

        foreach (var rawName in commaSeparated.Split(','))
        {
            var name = rawName.Trim();
            if (name.Length == 0)
            {
                continue;
            }

            if (!Enum.TryParse<DesktopAction>(name, ignoreCase: false, out var action) ||
                !Enum.IsDefined(action))
            {
                throw new ArgumentException($"Unknown desktop action '{name}'.");
            }

            selected.Add(action);
        }

        if (selected.Count == 0)
        {
            throw new ArgumentException("At least one allowed action must be configured.");
        }

        return selected;
    }
}
