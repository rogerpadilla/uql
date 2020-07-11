import { on, notify } from './bus';

it('runQuery', () => {
  const off = on((msg) => {
    expect(msg).toEqual({
      type: 'notification',
      message: 'hello',
    });
    off();
  });
  notify({
    type: 'notification',
    message: 'hello',
  });
});
