import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
export function createProfile() {
  const path = mkdtempSync(join(tmpdir(), "engineering-browser-"));
  return {
    path,
    close() {
      rmSync(path, { recursive: true, force: true });
    },
  };
}
