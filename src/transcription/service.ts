import { constants, closeSync, createReadStream, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Controller } from '../session/controller';
import type { DeepgramSettings } from '../integrations/deepgram';
import { AppError } from '../session/types';
import { openReadyFile } from '../recordings/access';

const languages = new Set(['ru', 'en', 'de', 'fr', 'es', 'it', 'pt', 'uk', 'multi']);
export interface Transcript {
  audioFileId: string; audioFile: string; language: string; diarize: boolean;
  model: 'nova-3'; createdAt: string; text: string;
  segments: { start: number; end: number; text: string; speaker?: number }[];
}
interface Options { audioFileId: string; language: string; diarize: boolean }
export interface TranscriptionState {
  status: 'idle' | 'processing' | 'completed' | 'failed' | 'interrupted';
  options?: Options; startedAt?: string; error?: string; transcript?: Transcript;
}

export class Transcriptions {
  private active = new Map<string, TranscriptionState>();
  constructor(private controller: Controller, private settings: DeepgramSettings, private transport: typeof fetch = fetch) {}
  private path(id: string) {
    if (!this.controller.getSession(id)) throw new AppError(404, 'Session not found');
    return join(this.controller.getSessionDirectory(id), 'transcription.json');
  }
  private save(id: string, state: TranscriptionState) {
    const path = this.path(id), temporary = path + '.' + randomUUID() + '.tmp';
    writeFileSync(temporary, JSON.stringify(state), { flag: 'wx', mode: 0o600 });
    renameSync(temporary, path);
  }
  isRunning(id: string) { return this.active.has(id); }
  get(id: string): TranscriptionState {
    const path = this.path(id);
    const active = this.active.get(id);
    if (active) return structuredClone(active);
    let fd: number | undefined;
    let state: TranscriptionState;
    try {
      fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      state = JSON.parse(readFileSync(fd, 'utf8'));
      if (!state || !['idle','processing','completed','failed','interrupted'].includes(state.status)) throw Error();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { status: 'idle' };
      throw new AppError(409, 'Cannot read the saved transcription. Check the meeting files.');
    } finally { if (fd !== undefined) closeSync(fd); }
    if (state.status === 'processing') {
      state.status = 'interrupted';
      state.error = 'The server restarted during transcription. Deepgram may have processed and charged for this audio. Check before submitting again; no automatic retry was made.';
      this.save(id, state);
    }
    return state;
  }
  summary(id: string) {
    try { return { status: this.get(id).status }; }
    catch { return { status: 'failed' as const }; }
  }
  start(id: string, raw: unknown): TranscriptionState {
    const session = this.controller.getSession(id);
    if (!session) throw new AppError(404, 'Session not found');
    if (this.active.size) throw new AppError(409, 'A transcription is already in progress. Wait for it to finish.');
    if (session.status !== 'completed') throw new AppError(409, 'Wait for the meeting recording to complete before transcribing it.');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new AppError(400, 'Invalid transcription options.');
    const input = raw as Partial<Options>;
    const audioFiles = session.files.filter(file => file.kind === 'audio' && file.status === 'ready');
    const options = { audioFileId: input.audioFileId ?? (audioFiles.length === 1 ? audioFiles[0].id : ''), language: input.language ?? 'ru', diarize: input.diarize ?? false };
    if (typeof options.language !== 'string' || !languages.has(options.language) || typeof options.diarize !== 'boolean' || typeof options.audioFileId !== 'string')
      throw new AppError(400, 'Choose a supported language, audio file and diarization setting.');
    if (!audioFiles.some(file => file.id === options.audioFileId)) throw new AppError(400, 'Choose a finalized audio file.');
    const key = this.settings.key();
    if (!key) throw new AppError(400, 'Save a Deepgram API key in Settings first.');
    const previous = this.get(id);
    const audio = openReadyFile(this.controller, id, options.audioFileId);
    if (audio.size <= 0 || audio.size > 2_000_000_000) {
      closeSync(audio.fd);
      throw new AppError(400, 'Audio must be nonempty and at most 2 GB.');
    }
    const state: TranscriptionState = { status: 'processing', options, startedAt: new Date().toISOString(), ...(previous.transcript ? { transcript: previous.transcript } : {}) };
    try { this.save(id, state); }
    catch (error) { closeSync(audio.fd); throw error; }
    this.active.set(id, state);
    void this.run(id, audio, key, options, state);
    return structuredClone(state);
  }
  private async run(id: string, audio: ReturnType<typeof openReadyFile>, key: string, options: Options, state: TranscriptionState) {
    const stream = createReadStream('', { fd: audio.fd, autoClose: true });
    // A network error may happen before fetch starts consuming the stream.
    stream.on('error', () => {});
    try {
      const query = new URLSearchParams({ model: 'nova-3', language: options.language, smart_format: 'true', utterances: 'true' });
      if (options.diarize) query.set('diarize_model', 'latest');
      const response = await this.transport('https://api.deepgram.com/v1/listen?' + query, {
        method: 'POST', headers: { Authorization: 'Token ' + key, 'Content-Type': 'audio/webm', 'Content-Length': String(audio.size) },
        body: stream as unknown as BodyInit, duplex: 'half', redirect: 'error', signal: AbortSignal.timeout(660_000),
      } as RequestInit & { duplex: string });
      if (!response.ok) {
        await response.body?.cancel();
        const message: Record<number,string> = {400:'Deepgram rejected the audio or transcription options.',401:'Deepgram did not accept the API key.',403:'Deepgram denied transcription access. Check key permissions.',429:'Deepgram request limit reached. Try again later.'};
        throw new AppError(502, message[response.status] || 'Deepgram could not transcribe this audio. Try again later.');
      }
      const reader = response.body?.getReader();
      if (!reader) throw Error();
      const chunks: Uint8Array[] = []; let bytes = 0;
      try {
        while (true) {
          const chunk = await reader.read(); if (chunk.done) break;
          bytes += chunk.value.length;
          if (bytes > 64 * 1024 * 1024) throw Error();
          chunks.push(chunk.value);
        }
      } finally { await reader.cancel(); }
      const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const text = data.results?.channels?.[0]?.alternatives?.[0]?.transcript;
      if (typeof text !== 'string') throw Error();
      const utterances = data.results.utterances ?? [];
      if (!Array.isArray(utterances)) throw Error();
      const segments = utterances.map(item => {
        if (!item || typeof item.start !== 'number' || !Number.isFinite(item.start) || typeof item.end !== 'number' || !Number.isFinite(item.end) || item.start < 0 || item.end < item.start || typeof item.transcript !== 'string') throw Error();
        return { start: item.start, end: item.end, text: item.transcript,
          ...(options.diarize && Number.isInteger(item.speaker) && item.speaker >= 0 ? { speaker: item.speaker } : {}) };
      });
      const transcript: Transcript = { ...options, audioFile: audio.file.name, model: 'nova-3', createdAt: new Date().toISOString(), text, segments };
      // Preserve the previous result if writing the replacement fails.
      this.save(id, { ...state, status: 'completed', transcript });
    } catch (error) {
      const failed: TranscriptionState = { ...state, status: 'failed', error: error instanceof AppError ? error.message : 'Transcription failed or returned an invalid result. Check connectivity and the audio file. A failed request may still have been charged by Deepgram.' };
      try { this.save(id, failed); } catch { /* Keep the durable processing marker for restart recovery. */ }
    } finally {
      stream.destroy();
      this.active.delete(id);
    }
  }
}
