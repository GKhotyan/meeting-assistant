import type { Session } from '../session/types';
import { DEFAULT_SUMMARY_PROMPT } from '../session/summary-prompt';

export interface SummarySchedule {
  id: string; name: string; summaryPrompt: string; lastRun?: { sessionId?: string };
}
export interface SummaryInstructions {
  prompt: string; promptSource: 'custom' | 'default'; promptOrigin: 'schedule' | 'recording' | 'default';
  scheduleId?: string; scheduleName?: string;
}

/** A schedule is a live template; each generation snapshots the resolved text.
 * Legacy linkage uses recorded launch identity, never a guessed meeting name. */
export function resolveInstructions(session: Session, schedules: SummarySchedule[]): SummaryInstructions {
  const schedule = session.scheduleId
    ? schedules.find(s => s.id === session.scheduleId)
    : schedules.find(s => s.lastRun?.sessionId === session.id);
  if (schedule) return {
    prompt: schedule.summaryPrompt || DEFAULT_SUMMARY_PROMPT,
    promptSource: schedule.summaryPrompt ? 'custom' : 'default', promptOrigin: 'schedule',
    scheduleId: schedule.id, scheduleName: schedule.name,
  };
  return {
    prompt: session.summaryPrompt || DEFAULT_SUMMARY_PROMPT,
    promptSource: session.summaryPromptSource === 'custom' ? 'custom' : 'default',
    promptOrigin: session.summaryPrompt ? 'recording' : 'default',
  };
}
