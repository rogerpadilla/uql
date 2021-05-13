import { clearOptions, getOptions, uql } from './options';
import { UqlOptions } from './type';

describe('options', () => {
  afterEach(() => {
    clearOptions();
  });

  it('getOptions unset', () => {
    expect(() => getOptions()).toThrow('options has to be set');
  });

  it('setOptions', () => {
    uql({
      querierPool: undefined,
      logger: console.info,
    });
    expect(getOptions()).toEqual({
      querierPool: undefined,
      logger: console.info,
    });

    uql({
      querierPool: undefined,
    });
    expect(getOptions()).toEqual({
      querierPool: undefined,
      logger: console.log,
    });
  });
});
