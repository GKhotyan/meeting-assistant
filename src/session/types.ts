export type RecordingMode = "video" | "screenshots" | "audio";
export type Status =
  | "queued"
  | "joining"
  | "waiting"
  | "retrying"
  | "recording"
  | "stopping"
  | "completed"
  | "failed"
  | "interrupted";
export interface RecordingFile {
  id: string;
  name: string;
  kind: "audio" | "screen" | "screenshot";
  status: "partial" | "ready";
  startedAtMs: number;
  endedAtMs?: number;
  audioOffsetMs?: number;
  bytes: number;
}
export interface ConnectionAttempt {
  number: number;
  startedAt: string;
  endedAt?: string;
  outcome: "connecting" | "connected" | "failed" | "cancelled";
  error?: string;
}
export interface Session {
  id: string;
  meetingName: string;
  botName: string;
  recordingMode?: RecordingMode;
  createdAt: string;
  status: Status;
  files: RecordingFile[];
  error?: string;
  endedAt?: string;
  attempts?: ConnectionAttempt[];
  nextRetryAt?: string;
}
export interface StartInput {
  meetingUrl: string;
  meetingName?: string;
  botName: string;
  recordingMode?: RecordingMode;
}
export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const terminal = (s: Status) =>
  ["completed", "failed", "interrupted"].includes(s);
