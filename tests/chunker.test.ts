import { test } from "node:test";
import assert from "node:assert/strict";
import { MediaRecorderChunker } from "../vendor/vexa/record-chunker";
test("stop drains delayed final data before final marker and audio finalization", async () => {
  const events: string[] = [];
  class FakeRecorder {
    static isTypeSupported() {
      return true;
    }
    state = "inactive";
    mimeType = "audio/webm";
    ondataavailable: any;
    onstop: any;
    start() {
      this.state = "recording";
    }
    stop() {
      this.state = "inactive";
      void this.ondataavailable({
        data: {
          size: 5,
          arrayBuffer: async () => {
            await new Promise((r) => setTimeout(r, 80));
            return new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1]).buffer;
          },
        },
      });
      void this.onstop();
    }
  }
  (globalThis as any).window = { MediaRecorder: FakeRecorder };
  (globalThis as any).MediaRecorder = FakeRecorder;
  try {
    const r = new MediaRecorderChunker({
      stream: {} as any,
      onChunk: async (c) => {
        events.push(c.isFinal ? "final" : "data");
        return true;
      },
    });
    await r.start();
    await r.stop();
    assert.deepEqual(events, ["data", "final"]);
  } finally {
    delete (globalThis as any).window;
    delete (globalThis as any).MediaRecorder;
  }
});
test("stalled audio bridge fails stop instead of publishing a truncated recording", async () => {
  class FakeRecorder {
    static isTypeSupported() {
      return true;
    }
    state = "inactive";
    mimeType = "audio/webm";
    ondataavailable: any;
    onstop: any;
    start() {
      this.state = "recording";
    }
    stop() {
      this.state = "inactive";
      void this.ondataavailable({
        data: {
          size: 4,
          arrayBuffer: async () =>
            new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]).buffer,
        },
      });
      void this.onstop();
    }
  }
  (globalThis as any).window = { MediaRecorder: FakeRecorder };
  (globalThis as any).MediaRecorder = FakeRecorder;
  try {
    const r = new MediaRecorderChunker({
      stream: {} as any,
      stopTimeoutMs: 30,
      onChunk: () => new Promise(() => {}),
    } as any);
    await r.start();
    await assert.rejects(() => r.stop(), /drain|timeout/i);
  } finally {
    delete (globalThis as any).window;
    delete (globalThis as any).MediaRecorder;
  }
});
