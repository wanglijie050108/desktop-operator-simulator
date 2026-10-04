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

    private static readonly HashSet<string> AllowedMouseButtons = ["LEFT", "RIGHT", "MIDDLE"];

    private static readonly string[] ControlLocatorProperties =
    [
        "processName",
        "titleContains",
        "controlType",
        "automationId",
        "name",
        "index",
        "offsetX",
        "offsetY",
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
            DesktopAction.MouseMove =>
                HasOnlyProperties(command.Arguments, "target") &&
                HasValidControlLocator(command.Arguments, "target"),
            DesktopAction.MouseClick =>
                HasOnlyProperties(command.Arguments, "target", "button", "clickCount") &&
                HasValidControlLocator(command.Arguments, "target") &&
                HasOptionalMouseButton(command.Arguments) &&
                HasOptionalClickCount(command.Arguments),
            DesktopAction.MouseDrag =>
                HasOnlyProperties(command.Arguments, "from", "to", "button") &&
                HasValidControlLocator(command.Arguments, "from") &&
                HasValidControlLocator(command.Arguments, "to") &&
                HasOptionalMouseButton(command.Arguments),
            DesktopAction.MouseScroll =>
                HasOnlyProperties(command.Arguments, "target", "verticalDelta") &&
                HasValidControlLocator(command.Arguments, "target") &&
                HasValidScrollTicks(command.Arguments),
            DesktopAction.MouseClickPosition =>
                HasOnlyProperties(command.Arguments, "target", "x", "y", "button", "clickCount") &&
                HasValidWindowSelector(command.Arguments, "target") &&
                HasRequiredInteger(command.Arguments, "x", 0, 20_000) &&
                HasRequiredInteger(command.Arguments, "y", 0, 20_000) &&
                HasOptionalMouseButton(command.Arguments) &&
                HasOptionalClickCount(command.Arguments),
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

    private static bool HasValidControlLocator(JsonElement arguments, string name)
    {
        if (!arguments.TryGetProperty(name, out var locator) ||
            locator.ValueKind != JsonValueKind.Object)
        {
            return false;
        }

        return HasOnlyProperties(locator, ControlLocatorProperties) &&
               HasRequiredString(locator, "processName", 100, allowEmpty: false) &&
               HasOptionalString(locator, "titleContains", 200) &&
               HasOptionalString(locator, "controlType", 50) &&
               HasOptionalString(locator, "automationId", 200) &&
               HasOptionalString(locator, "name", 200) &&
               HasOptionalInteger(locator, "index", 0, 99) &&
               HasOptionalInteger(locator, "offsetX", -2_000, 2_000) &&
               HasOptionalInteger(locator, "offsetY", -2_000, 2_000);
    }

    private static bool HasValidWindowSelector(JsonElement arguments, string name)
    {
        if (!arguments.TryGetProperty(name, out var selector) ||
            selector.ValueKind != JsonValueKind.Object)
        {
            return false;
        }

        return HasOnlyProperties(selector, "processName", "titleContains") &&
               HasRequiredString(selector, "processName", 100, allowEmpty: false) &&
               HasOptionalString(selector, "titleContains", 200);
    }

    private static bool HasOptionalMouseButton(JsonElement arguments)
    {
        return !arguments.TryGetProperty("button", out var button) ||
               button.ValueKind == JsonValueKind.String &&
               AllowedMouseButtons.Contains(button.GetString()!);
    }

    private static bool HasOptionalClickCount(JsonElement arguments)
    {
        return HasOptionalInteger(arguments, "clickCount", 1, 2);
    }

    private static bool HasValidScrollTicks(JsonElement arguments)
    {
        return arguments.TryGetProperty("verticalDelta", out var delta) &&
               delta.ValueKind == JsonValueKind.Number &&
               delta.TryGetInt32(out var ticks) &&
               ticks is >= -20 and <= 20 and not 0;
    }

    private static bool HasRequiredInteger(JsonElement element, string name, int minimum, int maximum)
    {
        return element.TryGetProperty(name, out var value) &&
               value.ValueKind == JsonValueKind.Number &&
               value.TryGetInt32(out var number) &&
               number >= minimum &&
               number <= maximum;
    }

    private static bool HasOptionalInteger(JsonElement element, string name, int minimum, int maximum)
    {
        return !element.TryGetProperty(name, out var value) ||
               value.ValueKind == JsonValueKind.Number &&
               value.TryGetInt32(out var number) &&
               number >= minimum &&
               number <= maximum;
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
