import { expect, it } from 'bun:test';
import type { RequestNotification } from '../type/index.js';
import { notify, on } from './bus.js';

it('bus', () => {
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
