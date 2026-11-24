import { AppError } from '../session/types';
import { CredentialStore, cleanKey } from './deepgram';
export type AIProvider = 'openai' | 'zai';
type Effort = 'default' | 'low' | 'medium' | 'high' | 'max';
interface Preferences {
    model: string;
    effort: Effort;
}
interface Configuration {
    provider: AIProvider;
    providers: Record<AIProvider, Preferences>;
}
const defaults = (): Configuration => ({ provider: 'zai', providers: { openai: { model: 'gpt-4.1', effort: 'default' }, zai: { model: 'glm-4.7', effort: 'default' } } });
const names = { openai: 'OpenAI', zai: 'z.ai' };
const endpoints = { openai: 'https://api.openai.com/v1/models', zai: 'https://api.z.ai/api/paas/v4/models' };
export function aiProvider(value: unknown): AIProvider {
    if (value !== 'openai' && value !== 'zai')
        throw new AppError(400, 'Choose OpenAI or z.ai.');
    return value;
}
function object(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new AppError(400, 'Invalid AI settings.');
    return value as Record<string, unknown>;
}
function preferences(value: unknown, provider: AIProvider): Preferences {
    const input = object(value);
    if (typeof input.model !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(input.model))
        throw new AppError(400, 'Enter a model ID containing up to 128 letters, digits, dots, underscores, colons, slashes or hyphens.');
    const effort = input.effort ?? 'default';
    const efforts = provider === 'zai' ? ['default', 'low', 'high', 'max'] : ['default', 'low', 'medium', 'high'];
    if (typeof effort !== 'string' || !efforts.includes(effort))
        throw new AppError(400, 'Choose a supported reasoning effort preference.');
    return { model: input.model, effort: effort as Effort };
}
export class AISettings {
    private store: CredentialStore;
    constructor(root: string) { this.store = new CredentialStore(root); }
    private configuration(value: Record<string, unknown>): Configuration {
        if (value.ai === undefined)
            return defaults();
        try {
            const config = object(value.ai), providers = object(config.providers);
            return { provider: aiProvider(config.provider), providers: { openai: preferences(providers.openai, 'openai'), zai: preferences(providers.zai, 'zai') } };
        }
        catch {
            throw new AppError(409, 'Stored AI settings are damaged. Restore settings/api-keys.json and secrets/master.key from backup.');
        }
    }
    private metadataFor(value: Record<string, unknown>) {
        const config = this.configuration(value);
        return { ...config, providers: { openai: { ...config.providers.openai, configured: !!value.openai }, zai: { ...config.providers.zai, configured: !!value.zai } } };
    }
    metadata() { return this.metadataFor(this.store.read()); }
    key(provider: AIProvider) { const value = this.store.read()[aiProvider(provider)]; return value === undefined || value === '' ? '' : cleanKey(value); }
    save(input: unknown) {
        const value = object(input), provider = aiProvider(value.provider), options = preferences(value, provider);
        if (value.activate !== undefined && typeof value.activate !== 'boolean')
            throw new AppError(400, 'Invalid provider activation preference.');
        const apiKey = value.apiKey === undefined || value.apiKey === '' ? undefined : cleanKey(value.apiKey);
        const data = this.store.read(), config = this.configuration(data);
        if (value.activate !== false) config.provider = provider;
        config.providers[provider] = options;
        const next = { ...data, ai: config, ...(apiKey === undefined ? {} : { [provider]: apiKey }) };
        this.store.write(next);
        return this.metadataFor(next);
    }
    select(provider: AIProvider) {
        provider = aiProvider(provider);
        const data = this.store.read(), config = this.configuration(data);
        config.provider = provider;
        const next = { ...data, ai: config };
        this.store.write(next);
        return this.metadataFor(next);
    }
    remove(provider: AIProvider) {
        provider = aiProvider(provider);
        const data = this.store.read();
        this.configuration(data);
        delete data[provider];
        this.store.write(data);
        return this.metadataFor(data);
    }
}
export async function checkAI(provider: AIProvider, apiKey: string, transport: typeof fetch = fetch) {
    provider = aiProvider(provider);
    const key = cleanKey(apiKey), name = names[provider];
    try {
        const response = await transport(endpoints[provider], { method: 'GET', headers: { Authorization: 'Bearer ' + key, Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(10000) });
        if (!response.ok) {
            await response.body?.cancel();
            const messages: Record<number, string> = { 401: `${name} did not accept the API key.`, 403: `${name} denied access. Check the key permissions.`, 429: `${name} request limit reached. Try again later.` };
            return { valid: false, message: messages[response.status] || `${name} is unavailable. Try again later.` };
        }
        const reader = response.body?.getReader();
        if (!reader)
            throw Error();
        const chunks: Uint8Array[] = [];
        let bytes = 0;
        try {
            while (true) {
                const chunk = await reader.read();
                if (chunk.done)
                    break;
                bytes += chunk.value.length;
                if (bytes > 1048576)
                    throw Error();
                chunks.push(chunk.value);
            }
        }
        finally {
            await reader.cancel();
        }
        const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!result || !Array.isArray(result.data) || !result.data.every((item: unknown) => item && typeof item === 'object' && typeof (item as {
            id?: unknown;
        }).id === 'string'))
            throw Error();
        return { valid: true, message: 'Connection verified. Model generation permissions, model capabilities and balance have not been checked.' };
    }
    catch {
        return { valid: false, message: `Could not verify the ${name} connection. Check your key and network, then try again.` };
    }
}
