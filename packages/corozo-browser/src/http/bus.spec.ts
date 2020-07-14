import { RequestNotification } from '../type';
import { on, notify } from './bus';

it('runQuery', () => {
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
