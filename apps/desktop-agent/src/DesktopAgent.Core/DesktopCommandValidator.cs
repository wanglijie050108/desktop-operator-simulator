using System.Text.Json;
using System.Text.RegularExpressions;
using DesktopAgent.Core.Contracts;

namespace DesktopAgent.Core.Safety;

public static partial class DesktopCommandValidator
{
    private static readonly HashSet<string> AllowedKeys =
    [
        "CTRL",
        "ALT",
        "SHIFT",
        "ENTER",
        "ESCAPE",
        "A",
        "C",
        "V",
    ];

    public static bool IsValid(DesktopCommandPayload command)
    {
        if (command.CommandId == Guid.Empty ||
            command.TaskId == Guid.Empty ||
            command.Arguments.ValueKind != JsonValueKind.Object)
        {
            return false;
        }

        return command.Action switch
        {
            DesktopAction.WeChatReadNewMessages => HasOnlyProperties(command.Arguments),
            DesktopAction.WeChatSendText =>
                HasOnlyProperties(command.Arguments, "conversationId", "text") &&
                HasRequiredString(command.Arguments, "conversationId", 200, allowEmpty: false) &&
                HasRequiredString(command.Arguments, "text", 4_000, allowEmpty: false),
            DesktopAction.WindowActivate =>
                HasOnlyProperties(command.Arguments, "processName", "titleContains") &&
                HasRequiredString(command.Arguments, "processName", 100, allowEmpty: false) &&
                HasOptionalString(command.Arguments, "titleContains", 200),
            DesktopAction.TakeScreenshot =>
                HasOnlyProperties(command.Arguments, "artifactName") &&
                HasRequiredString(command.Arguments, "artifactName", 100, allowEmpty: false) &&
                ArtifactNamePattern().IsMatch(
                    command.Arguments.GetProperty("artifactName").GetString()!),
            DesktopAction.ClipboardSetText =>
                HasOnlyProperties(command.Arguments, "text") &&
                HasRequiredString(command.Arguments, "text", 4_000, allowEmpty: true),
            DesktopAction.InputKeyChord =>
                HasOnlyProperties(command.Arguments, "keys") && HasValidKeyChord(command.Arguments),
            _ => false,
        };
    }

    private static bool HasOnlyProperties(JsonElement arguments, params string[] allowedNames)
    {
        var allowed = allowedNames.ToHashSet(StringComparer.Ordinal);
        return arguments.EnumerateObject().All(property => allowed.Contains(property.Name));
    }

    private static bool HasRequiredString(
        JsonElement arguments,
        string name,
        int maximumLength,
        bool allowEmpty)
    {
        if (!arguments.TryGetProperty(name, out var value) ||
            value.ValueKind != JsonValueKind.String)
        {
            return false;
        }

        var text = value.GetString()!;
        return text.Length <= maximumLength && (allowEmpty || text.Length > 0);
    }

    private static bool HasOptionalString(JsonElement arguments, string name, int maximumLength)
    {
        return !arguments.TryGetProperty(name, out var value) ||
               value.ValueKind == JsonValueKind.String &&
               value.GetString() is { Length: > 0 } text &&
               text.Length <= maximumLength;
    }

    private static bool HasValidKeyChord(JsonElement arguments)
    {
        if (!arguments.TryGetProperty("keys", out var keys) ||
            keys.ValueKind != JsonValueKind.Array)
        {
            return false;
        }

        var values = keys.EnumerateArray().ToArray();
        if (values.Length is < 1 or > 4 ||
            values.Any(value => value.ValueKind != JsonValueKind.String))
        {
            return false;
        }

        var names = values.Select(value => value.GetString()!).ToArray();
        return names.Distinct(StringComparer.Ordinal).Count() == names.Length &&
               names.All(AllowedKeys.Contains);
    }

    [GeneratedRegex("^[a-zA-Z0-9_-]+$", RegexOptions.CultureInvariant)]
    private static partial Regex ArtifactNamePattern();
}
