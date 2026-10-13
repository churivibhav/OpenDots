import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, expect, it, vi } from 'vitest';
import { SidebarSection } from '../src/client/SidebarSection';

let stored: Record<string, string>;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  stored = {};
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => stored[key] ?? null,
    setItem: (key: string, value: string) => {
      stored[key] = value;
    },
  });
});

async function render() {
  let root!: ReactTestRenderer;
  await act(async () => {
    root = create(
      createElement(SidebarSection, {
        id: 'spaces',
        title: 'SPACES',
        children: 'Body',
      }),
    );
  });
  const toggle = () =>
    root.root.findByProps({ className: 'sidebar-section-toggle' });
  return {
    root,
    toggle,
    open: () => toggle().props['aria-expanded'] as boolean,
    body: () =>
      root.root.findAll(
        (node) => node.props.className === 'sidebar-section-body',
      ).length,
  };
}

it('starts open, folds on click, and stays folded on the next visit', async () => {
  const first = await render();
  expect(first.open()).toBe(true);
  expect(first.body()).toBe(1);
  await act(async () => first.toggle().props.onClick());
  expect(first.open()).toBe(false);
  expect(first.body()).toBe(0);
  const next = await render();
  expect(next.open()).toBe(false);
  await act(async () => next.toggle().props.onClick());
  expect((await render()).open()).toBe(true);
});

it('still folds when storage is unavailable', async () => {
  vi.stubGlobal('localStorage', {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('blocked');
    },
  });
  const section = await render();
  expect(section.open()).toBe(true);
  await act(async () => section.toggle().props.onClick());
  expect(section.open()).toBe(false);
});
