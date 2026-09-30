import { expect, it, vi } from 'vitest';
import type { RequestNotification } from '../type/index.js';
import { notify, on } from './bus.js';

it('should hand a notification to its listeners', () => {
  const off = on((msg) => {
    const expected: RequestNotification = {
      phase: 'start',
      opts: {
        silent: true,
      },
    };
    expect(msg).toEqual(expected);
    off();
  });
  notify({
    phase: 'start',
    opts: {
      silent: true,
    },
  });
});

it('should stop only the listener whose own unsubscribe was called', () => {
  const [first, second, third] = [vi.fn(), vi.fn(), vi.fn()];
  const offs = [on(first), on(second), on(third)];
  offs[0]();
  offs[1]();

  notify({ phase: 'complete' });
  offs[2]();

  expect(first).not.toHaveBeenCalled();
  expect(second).not.toHaveBeenCalled();
  expect(third).toHaveBeenCalledTimes(1);
});
