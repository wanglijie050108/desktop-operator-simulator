using DesktopAgent.Core.Safety;

namespace DesktopAgent.Core.Tests;

public sealed class LogRedactorTests
{
    [Theory]
    [InlineData("call 13812345678 now", "call ***-***-5678 now")]
    [InlineData("card 6222021234567890 used", "card ***-***-7890 used")]
    [InlineData("only 12345 stays", "only 12345 stays")]
    public void MasksLongDigitSequences(string input, string expected)
    {
        Assert.Equal(expected, LogRedactor.Redact(input));
    }

    [Fact]
    public void MasksEmailLocalPart()
    {
        Assert.Equal(
            "account [REDACTED]@example.com signed in",
            LogRedactor.Redact("account test.user@example.com signed in"));
    }

    [Fact]
    public void MasksUrlCredentials()
    {
        Assert.Equal(
            "visit https://[REDACTED]@example.com/path",
            LogRedactor.Redact("visit https://admin:secret@example.com/path"));
    }

    [Theory]
    [InlineData("token=abc.def-ghi end", "token=[REDACTED] end")]
    [InlineData("password: hunter2!", "password: [REDACTED]")]
    [InlineData("密钥=abc123 完成", "密钥=[REDACTED] 完成")]
    public void MasksSecretAssignments(string input, string expected)
    {
        Assert.Equal(expected, LogRedactor.Redact(input));
    }

    [Fact]
    public void LeavesPlainTextUnchanged()
    {
        const string text = "任务完成，耗时 320ms";
        Assert.Equal(text, LogRedactor.Redact(text));
    }

    [Fact]
    public void HandlesEmptyInput()
    {
        Assert.Equal(string.Empty, LogRedactor.Redact(string.Empty));
        Assert.Equal(string.Empty, LogRedactor.Redact(null));
    }
}
