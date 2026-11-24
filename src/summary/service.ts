import { constants, openSync, closeSync, fstatSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { Controller } from '../session/controller';
import { AppError } from '../session/types';
import type { AISettings, AIProvider } from '../integrations/ai';
import type { Transcript, Transcriptions } from '../transcription/service';
import { generateSummary, MAX_TRANSCRIPT_BYTES, type GeneratedSummary, type SummaryProgress } from './generate';
import { modelPolicy } from './model';
import { resolveInstructions, type SummaryInstructions, type SummarySchedule } from './instructions';

interface Provenance {
  provider: AIProvider; model: string; effort: string; prompt: string; promptSource: 'custom' | 'default';
  transcriptHash: string; transcriptCreatedAt: string; audioFile: string;
  promptOrigin?: SummaryInstructions['promptOrigin']; scheduleId?: string; scheduleName?: string;
}
export interface SummaryResult extends GeneratedSummary, Provenance { createdAt: string; }
export interface SummaryState {
  status: 'idle' | 'processing' | 'completed' | 'failed' | 'interrupted';
  startedAt?: string; job?: Provenance; progress?: SummaryProgress; error?: string; result?: SummaryResult; stale?: boolean;
  instructions?: SummaryInstructions; instructionsChanged?: boolean;
}
export function transcriptFingerprint(transcript: Transcript): string {
  return createHash('sha256').update(JSON.stringify({
    text: transcript.text, audioFileId: transcript.audioFileId, audioFile: transcript.audioFile,
    language: transcript.language, diarize: transcript.diarize, model: transcript.model, createdAt: transcript.createdAt,
    segments: transcript.segments.map(s => ({ start: s.start, end: s.end, text: s.text, speaker: s.speaker })),
  })).digest('hex');
}

/** Keep the complete text even when utterances omit words or differ in punctuation.
 * Speaker numbers are anonymous voices, never participant identities. */
export function summarySource(transcript: Transcript): string {
  if (!transcript.diarize || !transcript.segments.some(s => Number.isInteger(s.speaker))) return transcript.text;
  const turns = transcript.segments.map(s =>
    `[${s.start.toFixed(2)}–${s.end.toFixed(2)}s · ${Number.isInteger(s.speaker) ? 'Speaker ' + (s.speaker! + 1) : 'Unidentified speaker'}] ${s.text}`);
  return transcript.text + '\n\nTIMED SPEAKER TURNS (additional detail from the same transcript, not a second meeting; anonymous voice numbers do not identify participants):\n' + turns.join('\n');
}

export class Summaries {
  private active = new Map<string, SummaryState>();
  constructor(private controller: Controller, private transcriptions: Transcriptions, private ai: AISettings, private transport: typeof fetch = fetch,
    private schedules: () => SummarySchedule[] = () => []) {}
  private path(id: string) {
    if (!this.controller.getSession(id)) throw new AppError(404, 'Session not found');
    return join(this.controller.getSessionDirectory(id), 'summary.json');
  }
  private save(id: string, state: SummaryState) {
    const path = this.path(id), temporary = path + '.' + randomUUID() + '.tmp';
    try {
      writeFileSync(temporary, JSON.stringify(state), { flag: 'wx', mode: 0o600 });
      renameSync(temporary, path);
    } finally { try { unlinkSync(temporary); } catch { /* Renamed or never created. */ } }
  }
  isRunning(id: string) { return this.active.has(id); }
  get(id: string): SummaryState {
    const path = this.path(id);
    let state = this.active.get(id);
    if (!state) {
      let fd: number | undefined;
      try {
        fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
        const stat = fstatSync(fd);
        if (!stat.isFile() || stat.size > 3 * 1024 * 1024) throw Error();
        const saved = JSON.parse(readFileSync(fd,'utf8'));
        if (!saved || !['idle','processing','completed','failed','interrupted'].includes(saved.status)) throw Error();
        if (saved.result && (typeof saved.result.text !== 'string' || !saved.result.text.trim() ||
            !['openai','zai'].includes(saved.result.provider) || typeof saved.result.model !== 'string' ||
            typeof saved.result.prompt !== 'string' || typeof saved.result.createdAt !== 'string' ||
            typeof saved.result.transcriptHash !== 'string')) throw Error();
        if (saved.status === 'completed' && !saved.result) throw Error();
        state = saved as SummaryState;
      } catch(error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') state = { status: 'idle' };
        else throw new AppError(409, 'Cannot read the saved summary. Check the meeting files.');
      } finally { if (fd !== undefined) closeSync(fd); }
      if (state.status === 'processing') {
        state.status = 'interrupted';
        state.error = 'The server restarted during summary generation. The provider may have processed and charged for pending requests. No automatic retry was made. Check before generating again.';
        this.save(id,state);
      }
    }
    let stale = false;
    if (state.result) {
      try {
        const current = this.transcriptions.get(id);
        stale = current.status !== 'completed' || !current.transcript || transcriptFingerprint(current.transcript) !== state.result.transcriptHash;
      } catch { stale = true; }
    }
    const instructions = resolveInstructions(this.controller.getSession(id)!, this.schedules());
    const instructionsChanged = !!state.result && state.result.prompt !== instructions.prompt;
    return { ...structuredClone(state), stale: stale || instructionsChanged, instructions, instructionsChanged };
  }
  status(id: string) {
    try { const state = this.get(id); return { status: state.status, stale: !!state.stale }; }
    catch { return { status: 'failed' as const, stale: false }; }
  }
  start(id: string, raw: unknown): SummaryState {
    const session = this.controller.getSession(id);
    if (!session) throw new AppError(404, 'Session not found');
    if (this.active.size) throw new AppError(409, 'A summary is already in progress. Wait for it to finish.');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some(k => k !== 'regenerate') ||
        ('regenerate' in raw && typeof raw.regenerate !== 'boolean')) throw new AppError(400, 'Invalid summary options.');
    if (session.status !== 'completed') throw new AppError(409, 'Wait for the meeting recording to complete before generating a summary.');
    const transcription = this.transcriptions.get(id);
    if (transcription.status !== 'completed' || !transcription.transcript) throw new AppError(409, 'Complete transcription before generating a summary.');
    const transcript = transcription.transcript;
    if (!transcript.text.trim()) throw new AppError(400, 'The transcript contains no speech to summarize.');
    const source = summarySource(transcript);
    if (Buffer.byteLength(source) > MAX_TRANSCRIPT_BYTES) throw new AppError(400, 'The transcript is too large. Summaries support up to 8 MiB of text, including speaker turns.');
    const settings = this.ai.metadata(), provider = settings.provider, preferences = settings.providers[provider];
    const apiKey = this.ai.key(provider);
    if (!apiKey) throw new AppError(400, 'Save an API key for the selected provider in AI settings first.');
    modelPolicy(provider,preferences.model,preferences.effort);
    const previous = this.get(id);
    if (previous.result && !(raw as { regenerate?: boolean }).regenerate) throw new AppError(409, 'Confirm Generate again to replace the saved summary. Provider charges may apply.');
    const job: Provenance = { provider, model: preferences.model, effort: preferences.effort,
      ...resolveInstructions(session, this.schedules()),
      transcriptHash: transcriptFingerprint(transcript), transcriptCreatedAt: transcript.createdAt, audioFile: transcript.audioFile };
    const state: SummaryState = { status: 'processing', startedAt: new Date().toISOString(), job, ...(previous.result ? { result: previous.result } : {}) };
    this.save(id,state); this.active.set(id,state);
    void this.run(id,source,apiKey,job,state);
    return this.get(id);
  }
  private async run(id: string, transcript: string, apiKey: string, job: Provenance, state: SummaryState) {
    try {
      const generated = await generateSummary({ ...job, transcript, apiKey }, this.transport, progress => {
        state.progress = progress; this.save(id,state);
      });
      this.save(id,{ ...state, status: 'completed', result: { ...generated, ...job, createdAt: new Date().toISOString() } });
    } catch(error) {
      const message = error instanceof AppError ? error.message : 'Could not save or generate the summary. Check the server storage and AI settings.';
      try { this.save(id,{ ...state, status: 'failed', error: message + ' No automatic retry was made; provider charges may apply.' }); }
      catch { /* Durable processing marker preserves prior result for restart recovery. */ }
    } finally { this.active.delete(id); }
  }
}
