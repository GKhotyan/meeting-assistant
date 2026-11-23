import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AppError } from "../session/types";

export class CredentialStore {
  private directory: string;
  private secrets: string;
  private file: string;
  private master: string;
  constructor(root: string) {
    this.directory = join(root, "settings");
    this.secrets = join(root, "secrets");
    this.file = join(this.directory, "api-keys.json");
    this.master = join(this.secrets, "master.key");
  }
  private guard() {
    for (const path of [this.directory, this.secrets, this.file, this.master]) {
      try {
        if (lstatSync(path).isSymbolicLink()) throw new AppError(500, "Unsafe credential storage path");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  }
  private masterKey(create: boolean): Buffer {
    this.guard();
    if (create && !existsSync(this.master)) {
      mkdirSync(this.secrets, { recursive: true, mode: 0o700 });
      chmodSync(this.secrets, 0o700);
      writeFileSync(this.master, randomBytes(32), { flag: "wx", mode: 0o600 });
    }
    try {
      const key = readFileSync(this.master);
      if (key.length !== 32) throw Error();
      chmodSync(this.master, 0o600);
      chmodSync(this.secrets, 0o700);
      return key;
    } catch {
      throw new AppError(409, "Credential encryption key is missing or damaged. Restore secrets/master.key from backup.");
    }
  }
  read(): Record<string, unknown> {
    this.guard();
    if (!existsSync(this.file)) return {};
    const key = this.masterKey(false);
    try {
      chmodSync(this.directory, 0o700);
      chmodSync(this.file, 0o600);
      const data = JSON.parse(readFileSync(this.file, "utf8"));
      if (data.version !== 1 || typeof data.iv !== "string" || typeof data.tag !== "string" || typeof data.ciphertext !== "string") throw Error();
      const iv = Buffer.from(data.iv, "base64"), tag = Buffer.from(data.tag, "base64");
      if (iv.length !== 12 || tag.length !== 16) throw Error();
      const decipher = createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(tag);
      const value = JSON.parse(Buffer.concat([decipher.update(Buffer.from(data.ciphertext, "base64")), decipher.final()]).toString("utf8"));
      if (!value || typeof value !== "object" || Array.isArray(value)) throw Error();
      return value;
    } catch {
      throw new AppError(409, "Cannot decrypt credentials. Restore settings/api-keys.json and secrets/master.key from backup.");
    }
  }
  write(value: Record<string, unknown>) {
    this.guard();
    // Read before replacing: a missing master key must never silently reset credentials.
    if (existsSync(this.file)) this.read();
    const key = this.masterKey(!existsSync(this.file));
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    chmodSync(this.directory, 0o700);
    const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
    const temporary = join(this.directory, randomBytes(16).toString("hex") + ".tmp");
    writeFileSync(temporary, JSON.stringify({ version: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") }), { mode: 0o600, flag: "wx" });
    renameSync(temporary, this.file);
  }
}
