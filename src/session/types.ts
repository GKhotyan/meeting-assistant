export type RecordingMode = "video" | "screenshots";
export type Status =
  | "queued"
  | "joining"
  | "waiting"
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
export interface Session {
  id: string;
  botName: string;
  recordingMode?: RecordingMode;
  createdAt: string;
  status: Status;
  files: RecordingFile[];
  error?: string;
  endedAt?: string;
}
export interface StartInput {
  meetingUrl: string;
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
