export function redact(text: string) {
  return text
    .replace(
      /([?&](?:pwd|password|passcode|token)=)[^\s&"']+/gi,
      "$1[redacted]",
    )
    .replace(/(Bearer\s+)[^\s"']+/gi, "$1[redacted]");
}
