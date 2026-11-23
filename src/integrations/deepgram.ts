export { CredentialStore } from "./credential-store";
import { CredentialStore } from "./credential-store";
import { AppError } from "../session/types";

export function cleanKey(value: unknown): string {
  if (typeof value !== "string" || value.length > 512 || /[^\x20-\x7e]/.test(value) || !value.trim())
    throw new AppError(400, "Enter an API key containing up to 512 printable ASCII characters.");
  return value.trim();
}

/** Credentials stay server-side and separate from recording preferences. */
export class DeepgramSettings {
  private store: CredentialStore;
  constructor(root: string) { this.store = new CredentialStore(root); }
  key(): string {
    const value = this.store.read().deepgram;
    return value === undefined || value === "" ? "" : cleanKey(value);
  }
  metadata() { return { configured: !!this.key() }; }
  private write(apiKey: string) {
    this.store.write({ ...this.store.read(), deepgram: apiKey });
    return this.metadata();
  }
  save(apiKey: unknown) { return this.write(cleanKey(apiKey)); }
  remove() { return this.write(""); }
}

export async function checkDeepgram(apiKey: string, transport: typeof fetch = fetch) {
  const key = cleanKey(apiKey);
  const signal = AbortSignal.timeout(10_000);
  try {
    const response = await transport("https://api.deepgram.com/v1/auth/token", {
      method: "GET", headers: { Authorization: "Token " + key, Accept: "application/json" },
      redirect: "error", signal,
    });
    if (!response.ok) {
      await response.body?.cancel();
      const messages: Record<number, string> = {
        401: "Deepgram did not accept the API key.",
        403: "Deepgram denied access. Check the key permissions.",
        429: "Deepgram request limit reached. Try again later.",
      };
      return { valid: false, message: messages[response.status] || "Deepgram is unavailable. Try again later." };
    }
    const reader = response.body?.getReader();
    if (!reader) throw Error();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.length;
        if (bytes > 65536) throw Error();
        chunks.push(chunk.value);
      }
    } finally { await reader.cancel(); }
    const result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!result || ![result.subject, result.accessor].every(value => typeof value === "string" && value.trim()))
      return { valid: false, message: "Deepgram returned an unexpected response." };
    return { valid: true, message: "Connection verified. Transcription permissions and balance have not been checked." };
  } catch {
    return { valid: false, message: "Could not verify the key. Check your connection and try again." };
  }
}
