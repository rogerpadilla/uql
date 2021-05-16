import { getLogger, getOptions, setOptions } from './options';

describe('options', () => {
  afterEach(() => {
    setOptions(undefined);
  });

  it('getOptions unset', () => {
    expect(getOptions()).toEqual({
      logger: console.log,
    });
    expect(getLogger()).toBe(console.log);
  });

  it('setOptions', () => {
    setOptions({
      querierPool: undefined,
      logger: console.info,
      debug: true,
    });
    expect(getOptions()).toEqual({
      querierPool: undefined,
      logger: console.info,
      debug: true,
    });
    expect(getLogger()).toBe(console.info);

    setOptions({
      querierPool: undefined,
    });
    expect(getOptions()).toEqual({
      querierPool: undefined,
      logger: console.log,
    });
  });
});
