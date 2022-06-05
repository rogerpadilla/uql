import { RequestNotification } from '../type/index';
import { on, notify } from './bus';

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
