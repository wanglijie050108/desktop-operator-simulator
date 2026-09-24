using System.Text.RegularExpressions;

namespace DesktopAgent.Core.Safety;

/// <summary>
/// Masks identifiers and secrets that must never reach structured logs. The rules are
/// intentionally conservative; callers must still avoid logging message bodies or profiles.
/// </summary>
public static partial class LogRedactor
{
    public static string Redact(string? text)
    {
        if (string.IsNullOrEmpty(text))
        {
            return text ?? string.Empty;
        }

        // Emails first, otherwise URL credentials would leave a partial match that the
        // email rule could re-match after the userinfo had been masked.
        var redacted = EmailPattern().Replace(
            text,
            match => $"[REDACTED]@{match.Groups[2].Value}");
        redacted = UrlCredentialPattern().Replace(redacted, match => $"{match.Groups[1].Value}[REDACTED]@");
        redacted = SecretAssignmentPattern().Replace(
            redacted,
            match => $"{match.Groups[1].Value}[REDACTED]");
        redacted = LongDigitPattern().Replace(
            redacted,
            match => MaskDigits(match.Value));
        return redacted;
    }

    private static string MaskDigits(string digits)
    {
        if (digits.Length <= 4)
        {
            return new string('*', digits.Length);
        }

        return $"***-***-{digits[^4..]}";
    }

    // At least seven consecutive digits: covers phone numbers and bank card numbers while
    // avoiding harmless short numbers like prices and order counts.
    [GeneratedRegex(@"\d{7,}", RegexOptions.CultureInvariant)]
    private static partial Regex LongDigitPattern();

    [GeneratedRegex(
        @"([A-Za-z0-9._%+-]+)@([A-Za-z0-9.-]+\.[A-Za-z]{2,})",
        RegexOptions.CultureInvariant)]
    private static partial Regex EmailPattern();

    [GeneratedRegex(
        @"(https?://)[^/\s@]+@",
        RegexOptions.CultureInvariant | RegexOptions.IgnoreCase)]
    private static partial Regex UrlCredentialPattern();

    // ASCII-only lookbehind (rather than \b, which is Unicode-word based in .NET) keeps
    // the rule identical to the JavaScript LogRedactor for both Latin and CJK keywords.
    [GeneratedRegex(
        @"(?i:(?<![A-Za-z0-9_])((?:password|passwd|secret|token|api[-_]?key|密码|令牌|密钥)\s*[:=]\s*))[^\s,;]+",
        RegexOptions.CultureInvariant)]
    private static partial Regex SecretAssignmentPattern();
}
