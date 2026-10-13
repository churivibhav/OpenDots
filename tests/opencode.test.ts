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
// V2 lists messages newest first; the turn is everything above the latest user message.
const turn = {
  data: [
    { id: 'msg_4', type: 'idle', outcome: 'succeeded' },
    {
      id: 'msg_3',
      type: 'assistant',
      content: [{ type: 'text', text: ' Three items are open. ' }],
    },
    {
      id: 'msg_2',
      type: 'assistant',
      content: [
        {
          type: 'tool',
          name: 'read',
          state: { status: 'completed', input: { path: 'notes/todo.md' } },
        },
      ],
    },
    { id: 'msg_1', type: 'user', text: 'List my todos' },
    {
      id: 'msg_0',
      type: 'assistant',
      content: [{ type: 'text', text: 'old' }],
    },
  ],
};
function fixture(reply?: (url: string) => Response | Promise<Response>) {
  const store = new Store(':memory:');
  resources.push(() => store.close());
  let sessions = 0;
  const transport = vi.fn<typeof fetch>(async (input) => {
    const url = String(input);
    if (reply) return reply(url);
    if (url.endsWith('/api/session'))
      return Response.json({ data: { id: `ses_${++sessions}` } });
    if (url.endsWith('/prompt'))
      return Response.json({ data: { id: 'msg_1' } });
    if (url.includes('/message?')) return Response.json(turn);
    return new Response(null, { status: 204 });
  });
  return {
    store,
    transport,
    client: new OpenCodeClient(config, store, transport),
  };
}
const signal = () => new AbortController().signal;
const path = (url: unknown) =>
  String(url).replace('https://opencode.example', '');
it('reuses one authenticated session per thread and returns text with tool evidence', async () => {
  const f = fixture();
  const first = await f.client.run(
    'thread',
    'List my todos',
    signal(),
    'helpdesk',
  );
  expect(first).toEqual({
    sessionId: 'ses_1',
    text: 'Three items are open.',
    tools: ['notes/todo.md'],
  });
  const turnCalls = [
    'POST /api/session/ses_1/agent',
    'POST /api/session/ses_1/model',
    'POST /api/session/ses_1/prompt',
    'POST /api/experimental/session/ses_1/wait',
    'GET /api/session/ses_1/message?order=desc&limit=50',
  ];
  await f.client.run('thread', 'And the first one?', signal(), 'helpdesk');
  expect(
    f.transport.mock.calls.map(([url, init]) => `${init?.method} ${path(url)}`),
  ).toEqual(['POST /api/session', ...turnCalls, ...turnCalls]);
  const [, agentInit] = f.transport.mock.calls[1];
  expect((agentInit!.headers as Record<string, string>).Authorization).toBe(
    `Basic ${Buffer.from('opencode:secret').toString('base64')}`,
  );
  expect(JSON.parse(String(agentInit!.body))).toEqual({ agent: 'helpdesk' });
  expect(JSON.parse(String(f.transport.mock.calls[2][1]!.body))).toEqual({
    model: { providerID: 'openai', id: 'gpt-5.5' },
  });
  expect(JSON.parse(String(f.transport.mock.calls[3][1]!.body))).toEqual({
    text: 'List my todos',
  });
  await f.client.run('thread', 'Start over', signal(), 'helpdesk', true);
  expect(f.store.opencodeSession('thread')).toBe('ses_2');
});
it('reports HTTP failures, failed turns and empty replies', async () => {
  const failing = fixture(() => new Response('nope', { status: 401 }));
  await expect(
    failing.client.run('thread', 'x', signal(), 'helpdesk'),
  ).rejects.toThrow('HTTP 401');
  const reply = (data: unknown[]) => (url: string) => {
    if (url.endsWith('/api/session'))
      return Response.json({ data: { id: 'ses_1' } });
    if (url.includes('/message?')) return Response.json({ data });
    return Response.json({ data: { id: 'msg_1' } });
  };
  const failed = fixture(
    reply([
      { type: 'idle', outcome: 'failed', error: { message: 'Quota exceeded' } },
      { type: 'user', text: 'x' },
    ]),
  );
  await expect(
    failed.client.run('thread', 'x', signal(), 'helpdesk'),
  ).rejects.toThrow('Quota exceeded');
  const empty = fixture(reply([{ type: 'user', text: 'x' }]));
  await expect(
    empty.client.run('thread', 'x', signal(), 'helpdesk'),
  ).rejects.toThrow('no response');
});
it('asks OpenCode to interrupt the session when the turn is cancelled', async () => {
  const controller = new AbortController();
  const f = fixture((url) => {
    if (url.endsWith('/api/session'))
      return Response.json({ data: { id: 'ses_1' } });
    if (url.endsWith('/interrupt')) return Response.json({ interrupted: true });
    if (url.endsWith('/wait')) {
      controller.abort();
      return Promise.reject(new DOMException('aborted', 'AbortError'));
    }
    return Response.json({ data: { id: 'msg_1' } });
  });
  await expect(
    f.client.run('thread', 'Long job', controller.signal, 'helpdesk'),
  ).rejects.toThrow();
  expect(
    f.transport.mock.calls.some(([url]) =>
      String(url).endsWith('/api/session/ses_1/interrupt'),
    ),
  ).toBe(true);
});
