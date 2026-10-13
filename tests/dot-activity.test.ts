import { expect, it } from 'vitest';
import { dotActivity } from '../src/client/dot-activity';

const call = (id: string, name: string) => ({
  role: 'assistant',
  toolCalls: [{ id, function: { name } }],
});
const result = (toolCallId: string) => ({ role: 'tool', toolCallId });
const state = { running: true, connecting: false, paused: false };

it('is still when nothing is happening, and shows connecting and paused', () => {
  expect(dotActivity({ ...state, messages: [], running: false })).toBe('idle');
  expect(
    dotActivity({ ...state, messages: [], running: false, connecting: true }),
  ).toBe('connecting');
  expect(
    dotActivity({
      ...state,
      messages: [],
      running: false,
      connecting: true,
      paused: true,
    }),
  ).toBe('paused');
});

it('thinks while running with no tool waiting on a result', () => {
  expect(dotActivity({ ...state, messages: [{ role: 'user' }] })).toBe(
    'thinking',
  );
  expect(
    dotActivity({
      ...state,
      messages: [call('a', 'search_web'), result('a')],
    }),
  ).toBe('thinking');
});

it.each([
  ['search_web', 'researching'],
  ['read_public_page', 'researching'],
  ['opencode_task', 'wiki'],
  ['create_space_page', 'writing'],
  ['edit_space_page', 'writing'],
  ['computer_navigate', 'computer'],
  ['list_authorized_spaces', 'thinking'],
])('acts out an in-flight %s call as %s', (name, pose) => {
  expect(dotActivity({ ...state, messages: [call('a', name)] })).toBe(pose);
});

it('follows the newest call still in flight', () => {
  expect(
    dotActivity({
      ...state,
      messages: [
        call('a', 'search_web'),
        result('a'),
        call('b', 'opencode_task'),
      ],
    }),
  ).toBe('wiki');
});
