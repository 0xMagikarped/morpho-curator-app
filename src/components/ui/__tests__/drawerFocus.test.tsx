/**
 * PR 12 — regression test for the Drawer's per-keystroke focus-loss bug.
 *
 * Before this fix `Drawer` collapsed three concerns into one effect keyed on
 * `[open, onClose]`. Parents that recreated `onClose` on each render (which
 * is normal — most callbacks are inline) re-ran the effect on every keystroke
 * and the rAF-scheduled `focusable[0].focus()` stole focus back to the X
 * close button. The test counts how many times `closeBtn.focus()` runs while
 * an unrelated parent state changes; the value must be 1 (the initial open),
 * not N+1 (where N = number of re-renders).
 *
 * Counting `focus()` calls on the button is more deterministic than
 * inspecting `document.activeElement` after rAF + microtasks settle in
 * JSDOM, and it directly measures the bug surface (the effect re-running).
 */
import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, fireEvent, act } from '@testing-library/react';
import { Drawer } from '../Drawer';

function Fixture() {
  const [value, setValue] = useState('');
  // Fresh inline arrow on every render — the realistic case that exposed
  // the bug. Memoising onClose would just paper over the root cause.
  return (
    <Drawer open onClose={() => {}} title="Test">
      <input
        aria-label="amount"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
    </Drawer>
  );
}

/** Flush all pending requestAnimationFrame callbacks (JSDOM uses setTimeout). */
async function flushRaf() {
  await act(async () => {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
  });
}

describe('Drawer — focus stability across parent re-renders (PR 12)', () => {
  it('typing in a child input does not re-fire the auto-focus on every render', async () => {
    const { getByLabelText, getByRole } = render(<Fixture />);
    const input = getByLabelText('amount') as HTMLInputElement;
    const closeBtn = getByRole('button', { name: /close drawer/i });
    const focusSpy = vi.spyOn(closeBtn, 'focus');

    // Flush the initial rAF that auto-focuses the first focusable (closeBtn).
    await flushRaf();
    const initialCalls = focusSpy.mock.calls.length;

    // Move user focus to the input (real-world: user clicked it).
    input.focus();
    expect(document.activeElement).toBe(input);

    // Type three keystrokes — each triggers a Fixture re-render and passes a
    // brand-new `onClose` arrow into Drawer.
    fireEvent.change(input, { target: { value: '1' } });
    fireEvent.change(input, { target: { value: '12' } });
    fireEvent.change(input, { target: { value: '123' } });
    await flushRaf();
    await flushRaf();

    // Pre-fix: each re-render re-ran the effect, queued rAF, called
    // closeBtn.focus() — N extra calls.
    // Post-fix: the auto-focus effect is keyed on `[open]` only, so it never
    // re-fires while the drawer stays open.
    expect(focusSpy.mock.calls.length).toBe(initialCalls);
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe('123');
  });
});
