import { getOptions, setOptions } from './options';

describe('options', () => {
  afterEach(() => {
    setOptions(undefined);
  });

  it('getOptions unset', () => {
    expect(() => getOptions()).toThrow('options has to be set');
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

    setOptions({
      querierPool: undefined,
    });
    expect(getOptions()).toEqual({
      querierPool: undefined,
      logger: console.log,
    });
  });
});
