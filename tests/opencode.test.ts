import { afterEach, expect, it, vi } from 'vitest';
import { Store } from '../src/server/store.js';
import { OpenCodeClient } from '../src/server/opencode.js';
import type { PlatformConfig } from '../src/server/platform-config.js';
const resources: (() => void)[] = [];
afterEach(() => resources.splice(0).forEach((close) => close()));
const config: PlatformConfig = {
  baseUrl: 'https://example.com',
  runtimeUrl: '',
  slackUsers: [],
  opencodeUrl: 'https://opencode.example/',
  opencodeUsername: 'opencode',
  opencodePassword: 'secret',
  opencodeModel: 'openai/gpt-5.5',
};
function fixture(reply?: (url: string) => Response | Promise<Response>) {
  const store = new Store(':memory:');
  resources.push(() => store.close());
  let sessions = 0;
  const transport = vi.fn<typeof fetch>(async (input) => {
    const url = String(input);
    if (reply) return reply(url);
    if (url.endsWith('/session'))
      return Response.json({ id: `ses_${++sessions}` });
    return Response.json({
      parts: [
        { type: 'tool', tool: 'read', state: { title: 'notes/todo.md' } },
        { type: 'text', text: ' Three items are open. ' },
      ],
    });
  });
  return {
    store,
    transport,
    client: new OpenCodeClient(config, store, transport),
  };
}
const signal = () => new AbortController().signal;
it('reuses one authenticated session per thread and returns text with tool evidence', async () => {
  const f = fixture();
  const first = await f.client.run('thread', 'List my todos', signal());
  expect(first).toEqual({
    sessionId: 'ses_1',
    text: 'Three items are open.',
    tools: ['notes/todo.md'],
  });
  await f.client.run('thread', 'And the first one?', signal());
  const urls = f.transport.mock.calls.map(([url]) => String(url));
  expect(urls).toEqual([
    'https://opencode.example/session',
    'https://opencode.example/session/ses_1/message',
    'https://opencode.example/session/ses_1/message',
  ]);
  const init = f.transport.mock.calls[1][1]!;
  expect((init.headers as Record<string, string>).Authorization).toBe(
    `Basic ${Buffer.from('opencode:secret').toString('base64')}`,
  );
  expect(JSON.parse(String(init.body))).toMatchObject({
    model: { providerID: 'openai', modelID: 'gpt-5.5' },
  });
  await f.client.run('thread', 'Start over', signal(), true);
  expect(f.store.opencodeSession('thread')).toBe('ses_2');
});
it('reports HTTP failures and empty replies', async () => {
  const failing = fixture(() => new Response('nope', { status: 401 }));
  await expect(failing.client.run('thread', 'x', signal())).rejects.toThrow(
    'HTTP 401',
  );
  const empty = fixture((url) =>
    url.endsWith('/session')
      ? Response.json({ id: 'ses_1' })
      : Response.json({ parts: [] }),
  );
  await expect(empty.client.run('thread', 'x', signal())).rejects.toThrow(
    'no response',
  );
});
it('asks OpenCode to abort the session when the turn is cancelled', async () => {
  const controller = new AbortController();
  const f = fixture((url) => {
    if (url.endsWith('/session')) return Response.json({ id: 'ses_1' });
    if (url.endsWith('/abort')) return Response.json(true);
    controller.abort();
    return Promise.reject(new DOMException('aborted', 'AbortError'));
  });
  await expect(
    f.client.run('thread', 'Long job', controller.signal),
  ).rejects.toThrow();
  expect(
    f.transport.mock.calls.some(([url]) =>
      String(url).endsWith('/session/ses_1/abort'),
    ),
  ).toBe(true);
});
