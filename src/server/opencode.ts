import type { PlatformConfig } from './platform-config.js';
import type { Store } from './store.js';

interface OpenCodeContent {
  type: string;
  text?: string;
  name?: string;
  state?: { status?: string; input?: Record<string, unknown> };
}

interface OpenCodeMessage {
  type: string;
  content?: OpenCodeContent[];
  outcome?: string;
  error?: { message?: string };
}

// Hands work to a remote OpenCode 2 server, keeping one session per thread.
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
  private async request(
    method: string,
    path: string,
    body: unknown,
    signal: AbortSignal,
  ) {
    const response = await this.transport(`${this.baseUrl}${path}`, {
      method,
      headers: this.headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal,
      redirect: 'error',
    });
    if (!response.ok)
      throw new Error(`OpenCode returned HTTP ${response.status}.`);
    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as unknown;
  }
  private async session(threadId: string, fresh: boolean, signal: AbortSignal) {
    const existing = fresh ? undefined : this.store.opencodeSession(threadId);
    if (existing) return existing;
    const created = (await this.request(
      'POST',
      '/api/session',
      { title: 'OpenDots conversation' },
      signal,
    )) as { data?: { id?: string } };
    const id = created?.data?.id;
    if (!id) throw new Error('OpenCode did not return a session.');
    this.store.setOpencodeSession(threadId, id);
    return id;
  }
  // Everything the agent produced after the latest user message, oldest first.
  private async turn(sessionId: string, signal: AbortSignal) {
    const page = (await this.request(
      'GET',
      `/api/session/${sessionId}/message?order=desc&limit=50`,
      undefined,
      signal,
    )) as { data?: OpenCodeMessage[] };
    const messages = page?.data ?? [];
    const lastUser = messages.findIndex((message) => message.type === 'user');
    return messages.slice(0, lastUser < 0 ? undefined : lastUser).reverse();
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
      void this.transport(
        `${this.baseUrl}/api/session/${sessionId}/interrupt`,
        {
          method: 'POST',
          headers: this.headers,
          signal: AbortSignal.timeout(5000),
        },
      ).catch(() => undefined);
    combined.addEventListener('abort', abort, { once: true });
    try {
      const path = `/api/session/${sessionId}`;
      await this.request('POST', `${path}/agent`, { agent }, combined);
      if (model.length)
        await this.request(
          'POST',
          `${path}/model`,
          { model: { providerID, id: model.join('/') } },
          combined,
        );
      await this.request('POST', `${path}/prompt`, { text: task }, combined);
      await this.request(
        'POST',
        `/api/experimental/session/${sessionId}/wait`,
        undefined,
        combined,
      );
      const messages = await this.turn(sessionId, combined);
      const failed = messages.find(
        (message) => message.type === 'idle' && message.outcome === 'failed',
      );
      if (failed)
        throw new Error(
          `OpenCode failed: ${failed.error?.message ?? 'unknown error'}`,
        );
      const content = messages
        .filter((message) => message.type === 'assistant')
        .flatMap((message) => message.content ?? []);
      const text = content
        .filter((item) => item.type === 'text' && item.text)
        .map((item) => item.text!.trim())
        .join('\n\n');
      const tools = content
        .filter((item) => item.type === 'tool')
        .map((item) => toolLabel(item))
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

// V2 tool calls carry no display title, so show what the tool acted on.
function toolLabel(item: OpenCodeContent) {
  const input = item.state?.input ?? {};
  const target = [
    input.path,
    input.filePath,
    input.pattern,
    input.url,
    input.command,
  ].find((value) => typeof value === 'string' && value);
  return (target as string | undefined) ?? item.name ?? 'tool';
}
