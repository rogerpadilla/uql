import { expect, it } from 'vitest';
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
