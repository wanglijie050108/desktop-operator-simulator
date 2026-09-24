const LONG_DIGITS = /\d{7,}/gu;
const EMAIL = /([A-Za-z0-9._%+-]+)@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/gu;
const URL_CREDENTIALS = /(https?:\/\/)[^/\s@]+@/giu;
// JavaScript \b is ASCII-word based even under the u flag, so it never matches next to
// Chinese keyword names; an ASCII-only lookbehind provides the same prefix guard on
// both Latin and CJK inputs.
const SECRET_ASSIGNMENT =
  /(?<![A-Za-z0-9_])((?:password|passwd|secret|token|api[-_]?key|密码|令牌|密钥)\s*[:=]\s*)[^\s,;]+/giu;

const SENSITIVE_KEYS =
  /^(?:password|passwd|secret|token|cookie|authorization|auth|api[-_]?key|密码|令牌|密钥|凭据)$/iu;

/**
 * Masks identifiers and secrets embedded in free text. Mirrors the C# LogRedactor so
 * logs produced on either side follow the same rules.
 */
export function redactText(input: string): string {
  let redacted = input.replace(EMAIL, "[REDACTED]@$2");
  redacted = redacted.replace(URL_CREDENTIALS, "$1[REDACTED]@");
  redacted = redacted.replace(SECRET_ASSIGNMENT, "$1[REDACTED]");
  redacted = redacted.replace(LONG_DIGITS, (digits) => maskDigits(digits));
  return redacted;
}

/**
 * Recursively redacts a structured value. Values attached to sensitive keys are masked
 * wholesale; every other string runs through {@link redactText}.
 */
export function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => redactValue(entry));
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        SENSITIVE_KEYS.test(key) ? "[REDACTED]" : redactValue(entry),
      ]),
    );
  }
  if (typeof value === "string") {
    return redactText(value);
  }
  return value;
}

/** Produces a log-safe view of an unknown error without throwing. */
export function redactError(error: unknown): { message: string; name: string } {
  if (error instanceof Error) {
    return { message: redactText(error.message), name: error.name };
  }
  return { message: redactText(String(error)), name: "Unknown" };
}

function maskDigits(digits: string): string {
  if (digits.length <= 4) {
    return "*".repeat(digits.length);
  }
  return `***-***-${digits.slice(-4)}`;
}
