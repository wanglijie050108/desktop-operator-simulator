namespace DesktopAgent.Core.Application;

public sealed class CommandDeduplicator
{
    private readonly Lock gate = new();
    private readonly Dictionary<Guid, DateTimeOffset> seen = [];

    public CommandDeduplicator(TimeSpan retention, int capacity)
    {
        ArgumentOutOfRangeException.ThrowIfLessThanOrEqual(retention, TimeSpan.Zero);
        ArgumentOutOfRangeException.ThrowIfLessThan(capacity, 1);

        Retention = retention;
        Capacity = capacity;
    }

    public TimeSpan Retention { get; }

    public int Capacity { get; }

    public bool TryRegister(Guid commandId, DateTimeOffset now)
    {
        if (commandId == Guid.Empty)
        {
            throw new ArgumentException("Command ID must not be empty.", nameof(commandId));
        }

        lock (gate)
        {
            RemoveExpired(now);
            if (seen.ContainsKey(commandId))
            {
                return false;
            }

            if (seen.Count >= Capacity)
            {
                var oldest = seen.MinBy(entry => entry.Value);
                seen.Remove(oldest.Key);
            }

            seen.Add(commandId, now);
            return true;
        }
    }

    private void RemoveExpired(DateTimeOffset now)
    {
        var expiresBefore = now - Retention;
        foreach (var commandId in seen
                     .Where(entry => entry.Value <= expiresBefore)
                     .Select(entry => entry.Key)
                     .ToArray())
        {
            seen.Remove(commandId);
        }
    }
}
