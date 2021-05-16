import { getBasePathApi, getOptions, setOptions } from './options';

describe('options', () => {
  afterEach(() => {
    setOptions(undefined);
  });

  it('getOptions unset', () => {
    expect(getOptions()).toEqual({ baseApiPath: '/api' });
    expect(getBasePathApi()).toBe('/api');
  });

  it('setOptions', () => {
    setOptions({
      baseApiPath: '/some-path',
    });
    expect(getOptions()).toEqual({
      baseApiPath: '/some-path',
    });

    setOptions({
      baseApiPath: '/another-path',
    });
    expect(getBasePathApi()).toEqual('/another-path');

    setOptions({
      baseApiPath: undefined,
    });
    expect(getOptions()).toEqual({
      baseApiPath: undefined,
    });
    expect(getBasePathApi()).toBe('/api');
  });
});
