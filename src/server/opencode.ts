import type { PlatformConfig } from './platform-config.js';
import type { Store } from './store.js';

interface OpenCodePart {
  type: string;
  text?: string;
  tool?: string;
  state?: { status?: string; title?: string };
}

// Hands work to a remote OpenCode server, keeping one session per thread.
export class OpenCodeClient {
  private baseUrl: string;
  private headers: Record<string, string>;
  constructor(
    private config: PlatformConfig,
    private store: Pick<Store, 'opencodeSession' | 'setOpencodeSession'>,
    private transport: typeof fetch = fetch,
  ) {
    if (!config.opencodeUrl || !config.opencodePassword)
      throw new Error('OpenCode is not configured.');
    this.baseUrl = config.opencodeUrl.replace(/\/$/, '');
    this.headers = {
      'Content-Type': 'application/json',
      Authorization: `Basic ${Buffer.from(`${config.opencodeUsername ?? 'opencode'}:${config.opencodePassword}`).toString('base64')}`,
    };
  }
  private async request(path: string, body: unknown, signal: AbortSignal) {
    const response = await this.transport(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(body),
      signal,
      redirect: 'error',
    });
    if (!response.ok)
      throw new Error(`OpenCode returned HTTP ${response.status}.`);
    return response.json() as Promise<unknown>;
  }
  private async session(threadId: string, fresh: boolean, signal: AbortSignal) {
    const existing = fresh ? undefined : this.store.opencodeSession(threadId);
    if (existing) return existing;
    const created = (await this.request(
      '/session',
      { title: 'OpenDots conversation' },
      signal,
    )) as { id?: string };
    if (!created.id) throw new Error('OpenCode did not return a session.');
    this.store.setOpencodeSession(threadId, created.id);
    return created.id;
  }
  async run(
    threadId: string,
    task: string,
    signal: AbortSignal,
    agent: string,
    fresh = false,
  ) {
    const sessionId = await this.session(threadId, fresh, signal);
    const [providerID, ...model] = (this.config.opencodeModel ?? '').split('/');
    const timeout = AbortSignal.timeout(
      this.config.opencodeTimeoutMs ?? 600_000,
    );
    const combined = AbortSignal.any([signal, timeout]);
    const abort = () =>
      void this.transport(`${this.baseUrl}/session/${sessionId}/abort`, {
        method: 'POST',
        headers: this.headers,
        signal: AbortSignal.timeout(5000),
      }).catch(() => undefined);
    combined.addEventListener('abort', abort, { once: true });
    try {
      const result = (await this.request(
        `/session/${sessionId}/message`,
        {
          agent,
          parts: [{ type: 'text', text: task }],
          ...(model.length
            ? { model: { providerID, modelID: model.join('/') } }
            : {}),
        },
        combined,
      )) as { parts?: OpenCodePart[] };
      const parts = result.parts ?? [];
      const text = parts
        .filter((part) => part.type === 'text' && part.text)
        .map((part) => part.text!.trim())
        .join('\n\n');
      const tools = parts
        .filter((part) => part.type === 'tool')
        .map((part) => part.state?.title || part.tool || 'tool')
        .slice(0, 20);
      if (!text && !tools.length)
        throw new Error('OpenCode returned no response.');
      return { sessionId, text: text.slice(0, 24000), tools };
    } catch (error) {
      if (timeout.aborted)
        throw new Error(
          'OpenCode did not finish in time; it may still be working in its session.',
          { cause: error },
        );
      throw error;
    } finally {
      combined.removeEventListener('abort', abort);
    }
  }
}
