import { AppError } from './types';

export const SUMMARY_PROMPT_LIMIT = 8000;
export const DEFAULT_SUMMARY_PROMPT = `Summarize the meeting using only the provided transcript. Write in the primary language of the meeting.

Use these sections:
- Key points: the main topics and relevant context.
- Decisions: decisions explicitly agreed during the meeting.
- Action items: tasks, owners, and deadlines when explicitly stated.
- Open questions: unresolved issues and follow-up topics.

Be concise and specific. Do not invent facts, decisions, participant identities, owners, or deadlines. If information is missing, say it was not specified.`;

/** Preserve authored instructions, including formatting; whitespace-only means default. */
export function summaryPrompt(value: unknown): string {
  if (value === undefined) return '';
  if (typeof value !== 'string' || value.length > SUMMARY_PROMPT_LIMIT)
    throw new AppError(400, `Summary prompt must contain no more than ${SUMMARY_PROMPT_LIMIT.toLocaleString('en-US')} characters.`);
  return value.trim() ? value : '';
}
