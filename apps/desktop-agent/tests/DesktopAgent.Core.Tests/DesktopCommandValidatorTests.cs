using System.Text.Json;
using DesktopAgent.Core.Contracts;
using DesktopAgent.Core.Safety;

namespace DesktopAgent.Core.Tests;

public sealed class DesktopCommandValidatorTests
{
    public static TheoryData<DesktopAction, string> ValidArguments => new()
    {
        { DesktopAction.WeChatReadNewMessages, "{}" },
        {
            DesktopAction.WeChatSendText,
            """{"conversationId":"hashed-conversation","text":"hello"}"""
        },
        { DesktopAction.WindowActivate, """{"processName":"WeChat","titleContains":"Chat"}""" },
        { DesktopAction.TakeScreenshot, """{"artifactName":"task_123"}""" },
        { DesktopAction.ClipboardSetText, """{"text":""}""" },
        { DesktopAction.InputKeyChord, """{"keys":["CTRL","V"]}""" },
    };

    [Theory]
    [MemberData(nameof(ValidArguments))]
    public void AcceptsStrictActionArguments(DesktopAction action, string arguments)
    {
        Assert.True(DesktopCommandValidator.IsValid(CreateCommand(action, arguments)));
    }

    public static TheoryData<DesktopAction, string> InvalidArguments => new()
    {
        { DesktopAction.WeChatReadNewMessages, """{"unexpected":true}""" },
        { DesktopAction.WeChatSendText, """{"conversationId":"","text":"hello"}""" },
        { DesktopAction.WeChatSendText, """{"conversationId":"id"}""" },
        { DesktopAction.WindowActivate, """{"processName":"","titleContains":"Chat"}""" },
        { DesktopAction.WindowActivate, """{"processName":"WeChat","titleContains":null}""" },
        { DesktopAction.TakeScreenshot, """{"artifactName":"../unsafe"}""" },
        { DesktopAction.ClipboardSetText, """{"text":1}""" },
        { DesktopAction.InputKeyChord, """{"keys":[]}""" },
        { DesktopAction.InputKeyChord, """{"keys":["CTRL","CTRL"]}""" },
        { DesktopAction.InputKeyChord, """{"keys":["DELETE"]}""" },
    };

    [Theory]
    [MemberData(nameof(InvalidArguments))]
    public void RejectsInvalidOrUnknownActionArguments(DesktopAction action, string arguments)
    {
        Assert.False(DesktopCommandValidator.IsValid(CreateCommand(action, arguments)));
    }

    [Fact]
    public void RejectsEmptyIdentifiersAndNonObjectArguments()
    {
        var valid = CreateCommand(DesktopAction.WeChatReadNewMessages, "{}");
        Assert.False(DesktopCommandValidator.IsValid(valid with { CommandId = Guid.Empty }));
        Assert.False(DesktopCommandValidator.IsValid(valid with { TaskId = Guid.Empty }));
        Assert.False(
            DesktopCommandValidator.IsValid(
                valid with { Arguments = ParseArguments("""["not-an-object"]""") }));
    }

    private static DesktopCommandPayload CreateCommand(DesktopAction action, string arguments)
    {
        return new DesktopCommandPayload(
            Guid.NewGuid(),
            Guid.NewGuid(),
            DateTimeOffset.UtcNow.AddMinutes(1),
            action,
            ParseArguments(arguments));
    }

    private static JsonElement ParseArguments(string json)
    {
        using var document = JsonDocument.Parse(json);
        return document.RootElement.Clone();
    }
}
