import { getOptions, setOptions } from './options';
import { UqlOptions } from './type';

describe('options', () => {
  it('setOptions', () => {
    const opts: UqlOptions = {
      logger: console.log,
    };
    setOptions(opts);
    expect(getOptions()).toEqual(opts);
  });
});
