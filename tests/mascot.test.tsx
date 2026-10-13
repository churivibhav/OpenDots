import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, expect, it, vi } from 'vitest';
import { Mascot, assignCharacters } from '../src/client/Mascot';

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  assignCharacters(['atlas', 'juno', 'sage']);
});

async function render(props: Parameters<typeof Mascot>[0]) {
  let root!: ReactTestRenderer;
  await act(async () => {
    root = create(createElement(Mascot, props));
  });
  const mascot = root.root.find(
    (node) =>
      node.type === 'span' &&
      String(node.props.className).startsWith('mascot '),
  );
  const prop = root.root.findAll((node) => node.props.className === 'dot-prop');
  return {
    className: String(mascot.props.className),
    alt: root.root.findByType('img').props.alt as string,
    prop: prop[0],
    has: (className: string) =>
      root.root.findAll((node) => node.props.className === className).length >
      0,
  };
}

it('stays still with no prop when idle', async () => {
  const idle = await render({ identity: 'atlas', name: 'Atlas' });
  expect(idle.className).toContain('idle');
  expect(idle.prop).toBeUndefined();
  expect(idle.alt).toBe('Atlas is here');
});

it.each([
  ['thinking', 'dot-thought', 'thinking'],
  ['researching', 'dot-book', 'reading'],
  ['wiki', 'dot-glasses', 'working in your wiki'],
  ['writing', 'dot-notepad', 'writing'],
  ['computer', 'dot-magnifier', 'looking closely'],
])('shows %s with its prop', async (state, prop, label) => {
  const dot = await render({ identity: 'juno', name: 'Juno', state });
  expect(dot.className).toContain(state);
  expect(dot.has(prop)).toBe(true);
  expect(dot.alt).toBe(`Juno is ${label}`);
});

it('connects with motion only, and treats the old working state as thinking', async () => {
  const connecting = await render({ state: 'connecting', name: 'Sage' });
  expect(connecting.prop).toBeUndefined();
  expect(connecting.alt).toBe('Sage is connecting');
  const working = await render({ state: 'working' });
  expect(working.className).toContain('thinking');
  expect(working.has('dot-thought')).toBe(true);
});

it('keeps decorative sidebar avatars still whatever the state', async () => {
  const nav = await render({ state: 'wiki', decorative: true, small: true });
  expect(nav.className).toContain('idle');
  expect(nav.prop).toBeUndefined();
  expect(nav.alt).toBe('');
});
