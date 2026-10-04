import { afterEach, expect, it, vi } from 'vitest';
import { Store } from '../src/server/store.js';
import { WorkspaceStore } from '../src/server/workspace.js';
import { VoiceService, spokenPrefix } from '../src/server/voice.js';
import type { PlatformConfig } from '../src/server/platform-config.js';
const resources: (() => void)[] = [];
afterEach(() => {
  resources.splice(0).forEach((close) => close());
  vi.useRealTimers();
});
function fixture() {
  const store = new Store(':memory:');
  const workspace = new WorkspaceStore(':memory:', 'owner');
  workspace.bindThread('thread', workspace.dots()[0].id, 'A conversation');
  resources.push(() => {
    store.close();
    workspace.close();
  });
  const config: PlatformConfig = {
    baseUrl: 'https://example.com',
    ttsUrl: 'http://127.0.0.1:5150',
    runtimeUrl: '',
    slackUsers: [],
  };
  const turn = vi.fn(
    async (_thread: string, _prompt: string, _signal: AbortSignal) =>
      'Current answer',
  );
  const history = vi.fn(async () => 'user: Earlier topic');
  const transport = vi.fn<typeof fetch>(
    async () =>
      new Response(new Uint8Array([82, 73, 70, 70]), {
        headers: { 'content-type': 'audio/wav' },
      }),
  );
  const voice = new VoiceService(
    {
      workspace,
      store,
      config,
      turn,
      history,
      requireReady() {},
      setup: () => ({
        voice: true,
        opencode: false,
        intelligence: true,
        model: true,
        browser: false,
        slack: 'not_configured',
        missing: [],
      }),
    },
    transport,
  );
  return { voice, transport, workspace, store, turn };
}
const signal = () => new AbortController().signal;
it('binds compute to the existing thread as a spoken turn and deduplicates utterances', async () => {
  const f = fixture();
  const call = await f.voice.begin('thread', signal());
  f.voice.activate(call.id);
  await Promise.all([
    f.voice.compute(call.id, 'utterance-1', 'What is on my list?'),
    f.voice.compute(call.id, 'utterance-1', 'What is on my list?'),
  ]);
  expect(f.turn).toHaveBeenCalledTimes(1);
  expect(f.turn.mock.calls[0]?.[0]).toBe('thread');
  expect(f.turn.mock.calls[0]?.[1]).toBe(`${spokenPrefix}What is on my list?`);
  await f.voice.end(call.id, 'Confirmed discussion');
  expect(f.workspace.call(call.id).status).toBe('ended');
  expect(f.turn).toHaveBeenLastCalledWith(
    'thread',
    expect.stringContaining('Record a short call receipt'),
    expect.any(AbortSignal),
    { opendotsSource: 'voice_receipt' },
  );
  await expect(f.voice.compute(call.id, 'late', 'Research')).rejects.toThrow(
    'ended',
  );
});
it('synthesizes speech through the configured TTS server for live calls only', async () => {
  const f = fixture();
  const call = await f.voice.begin('thread', signal());
  const audio = await f.voice.tts(call.id, 'Hello there', signal());
  expect(audio.byteLength).toBe(4);
  expect(f.transport).toHaveBeenCalledWith(
    'http://127.0.0.1:5150',
    expect.objectContaining({ body: JSON.stringify({ text: 'Hello there' }) }),
  );
  f.transport.mockResolvedValueOnce(new Response('busy', { status: 500 }));
  await expect(f.voice.tts(call.id, 'Again', signal())).rejects.toThrow(
    'HTTP 500',
  );
  await f.voice.end(call.id, '');
  await expect(f.voice.tts(call.id, 'Late', signal())).rejects.toThrow('ended');
});
it('rejects unowned threads and expires unactivated calls', async () => {
  vi.useFakeTimers();
  const f = fixture();
  await expect(f.voice.begin('foreign', signal())).rejects.toThrow();
  const call = await f.voice.begin('thread', signal());
  await expect(f.voice.begin('thread', signal())).rejects.toThrow(
    'End the current call',
  );
  await vi.advanceTimersByTimeAsync(30_001);
  expect(f.workspace.call(call.id).status).toBe('failed');
});
it('saves a late transcript after expiry without changing the ended status or duration', async () => {
  vi.useFakeTimers();
  const f = fixture();
  const call = await f.voice.begin('thread', signal());
  await vi.advanceTimersByTimeAsync(30_001);
  const expired = f.workspace.call(call.id);
  await f.voice.end(call.id, 'Buffered speech at disconnect');
  await f.voice.end(call.id, 'Buffered speech at disconnect');
  expect(f.workspace.call(call.id)).toMatchObject({
    status: 'failed',
    endedAt: expired.endedAt,
    transcript: 'Buffered speech at disconnect',
  });
  expect(f.turn).toHaveBeenCalledTimes(1);
});
it('defers paused transcript synchronization and resumes it once without a duplicate turn', async () => {
  const f = fixture();
  const call = await f.voice.begin('thread', signal());
  f.store.updateSettings({ paused: true });
  f.voice.abortAll();
  await f.voice.end(call.id, 'Speech saved while paused');
  expect(f.turn).not.toHaveBeenCalled();
  expect(f.workspace.call(call.id).error).toContain(
    'pending Intelligence sync',
  );
  f.store.updateSettings({ paused: false });
  await f.voice.resumePending();
  await f.voice.resumePending();
  expect(f.turn).toHaveBeenCalledTimes(1);
  expect(f.workspace.call(call.id).status).toBe('failed');
});
