import type { AIProvider } from '../integrations/ai';
import { AppError } from '../session/types';

export interface ModelPolicy {
  contextTokens: number;
  outputTokens: number;
  contextFallback: boolean;
  parameters: Record<string, unknown>;
}

// Explicit verified families only. Unknown IDs never inherit the largest window.
// https://developers.openai.com/api/docs/models/gpt-4.1
// https://developers.openai.com/api/docs/models/gpt-5
// https://docs.z.ai/guides/llm/glm-4.7
// https://docs.z.ai/guides/llm/glm-5
// https://docs.z.ai/guides/llm/glm-5.1
// https://docs.z.ai/guides/llm/glm-5.2
// https://docs.z.ai/guides/llm/glm-5.3
export function modelPolicy(provider: AIProvider, model: string, effort: string): ModelPolicy {
  let contextTokens = 16384, outputTokens = 4096, contextFallback = true;
  let parameters: Record<string, unknown> = {};
  const gpt41 = /^gpt-4\.1(?:-mini|-nano)?(?:-\d{4}-\d{2}-\d{2})?$/.test(model);
  const gpt5 = /^gpt-5(?:-mini|-nano)?(?:-\d{4}-\d{2}-\d{2})?$/.test(model);
  const glm47 = /^glm-4\.7(?:-flashx?)?$/.test(model);
  const glm53 = /^glm-5\.3(?:-flashx?)?$/.test(model);
  const glm5Thinking = ['glm-5', 'glm-5.1', 'glm-5.2'].includes(model);
  if (provider === 'openai' && gpt41) { contextTokens = 1047576; outputTokens = 8192; contextFallback = false; }
  if (provider === 'openai' && gpt5) { contextTokens = 400000; outputTokens = 32768; contextFallback = false; }
  if (provider === 'zai' && (glm47 || glm53 || glm5Thinking)) { contextTokens = glm53 || model === 'glm-5.2' ? 1000000 : 200000; outputTokens = 65536; contextFallback = false; }
  if (effort !== 'default') {
    if (provider === 'openai' && gpt5 && ['low','medium','high'].includes(effort)) parameters = { reasoning_effort: effort };
    else if (provider === 'zai' && glm53 && ['low','high','max'].includes(effort)) parameters = { thinking: { type: 'enabled' }, reasoning_effort: effort };
    else if (provider === 'zai' && (glm47 || glm5Thinking) && effort === 'high') parameters = { thinking: { type: 'enabled' } };
    else throw new AppError(400, 'This model does not support the selected reasoning effort preference here. Choose Model default in AI settings. GLM-4.7 and GLM-5 through GLM-5.2 also support High (thinking enabled).');
  }
  return { contextTokens, outputTokens, contextFallback, parameters };
}

/** UTF-8 byte count is a conservative token bound for these byte-level tokenizers.
 * Preserve all input, including whitespace, and never split a surrogate pair. */
export function splitText(text: string, maxBytes: number): string[] {
  if (maxBytes < 4) throw new AppError(400, 'Summary instructions leave insufficient context for the transcript.');
  const parts: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = start, bytes = 0, boundary = start;
    while (end < text.length) {
      const cp = text.codePointAt(end)!;
      const length = cp > 0xffff ? 2 : 1;
      const size = cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
      if (bytes + size > maxBytes) break;
      bytes += size; end += length;
      if ((text[end - 1] === '\n' || text[end - 1] === ' ') && bytes > maxBytes / 2) boundary = end;
    }
    if (end < text.length && boundary > start) end = boundary;
    parts.push(text.slice(start, end)); start = end;
  }
  return parts;
}
