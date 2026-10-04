import { afterEach, expect, it, vi } from 'vitest';
import type { RunAgentInput } from '@ag-ui/core';
import { lastValueFrom, toArray } from 'rxjs';
import { DotAgent } from '../src/server/dot-agent.js';
import { completion } from './fixtures/model-stream.js';
import { Store } from '../src/server/store.js';
import { WorkspaceStore } from '../src/server/workspace.js';
import type { PlatformConfig } from '../src/server/platform-config.js';

const databases: Array<{ close(): void }> = [];
afterEach(() => {
  vi.restoreAllMocks();
  databases.splice(0).forEach((db) => db.close());
});
const config: PlatformConfig = {
  intelligenceKey: 'fixture',
  apiKey: 'fixture',
  model: 'custom-model',
  baseUrl: 'https://unused.invalid/v1',
  runtimeUrl: '',
  slackUsers: [],
  webSearchProvider: 'disabled',
  opencodeUrl: 'https://opencode.invalid',
  opencodePassword: 'fixture',
  opencodeAgents: ['opendots-helpdesk'],
};
function fixture(opencodeAgent: string | null) {
  const store = new Store(':memory:');
  const workspace = new WorkspaceStore(':memory:', 'owner');
  databases.push(store, workspace);
  const base = workspace.dots()[0];
  const dot = workspace.updateDot(base.id, { ...base, opencodeAgent });
  workspace.bindThread('thread', dot.id, 'Tools');
  const agent = new DotAgent(store, workspace, config, dot.id);
  const input: RunAgentInput = {
    threadId: 'thread',
    runId: 'run',
    state: {},
    context: [],
    messages: [{ id: 'user', role: 'user', content: 'Hello' }],
    tools: [],
    forwardedProps: {},
  };
  return { store, workspace, agent, input };
}
const toolNames = (init?: RequestInit) =>
  (
    JSON.parse(String(init?.body)) as {
      tools?: { function: { name: string } }[];
    }
  ).tools?.map((tool) => tool.function.name) ?? [];
const callTool = (name: string, args: Record<string, unknown>) =>
  completion(
    {
      role: 'assistant',
      tool_calls: [
        {
          index: 0,
          id: 'call',
          type: 'function',
          function: { name, arguments: JSON.stringify(args) },
        },
      ],
    },
    'tool_calls',
  );

it('offers opencode_task only for a Dot with an allowed OpenCode agent', async () => {
  for (const [agentName, expected] of [
    ['opendots-helpdesk', true],
    [null, false],
    ['opendots-unlisted', false],
  ] as const) {
    const f = fixture(agentName);
    const network = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(completion({ role: 'assistant', content: 'Hi' }));
    await lastValueFrom(f.agent.run(f.input).pipe(toArray()));
    expect(toolNames(network.mock.calls[0][1]).includes('opencode_task')).toBe(
      expected,
    );
    vi.restoreAllMocks();
  }
});
it('queues background work in the same conversation and caps it per thread', async () => {
  const f = fixture(null);
  vi.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(
      callTool('start_background_task', {
        prompt: 'Research solar panels',
        repeat_minutes: 120,
      }),
    )
    .mockResolvedValueOnce(
      completion({ role: 'assistant', content: 'Queued' }),
    );
  await lastValueFrom(f.agent.run(f.input).pipe(toArray()));
  const [task] = f.store.tasks();
  expect(task).toMatchObject({
    prompt: 'Research solar panels',
    intervalSeconds: 7200,
  });
  expect(f.workspace.taskThread(task.id)).toBe('thread');
  for (const prompt of ['Second', 'Third'])
    f.workspace.bindTask(f.store.createTask(prompt).id, 'thread');
  vi.restoreAllMocks();
  vi.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(
      callTool('start_background_task', { prompt: 'One too many' }),
    )
    .mockResolvedValueOnce(completion({ role: 'assistant', content: 'Full' }));
  await lastValueFrom(f.agent.clone().run(f.input).pipe(toArray()));
  expect(f.store.tasks()).toHaveLength(3);
});
