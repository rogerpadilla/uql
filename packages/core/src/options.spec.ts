import { clearOptions, getDatasourceOptions, getOptions, setOptions } from './options';
import { UqlOptions } from './type';

describe('options', () => {
  afterEach(() => {
    clearOptions();
  });

  it('getOptions unset', () => {
    expect(() => getOptions()).toThrow('options has to be set');
  });

  it('getOptions datasource unset', () => {
    setOptions({});
    expect(() => getDatasourceOptions()).toThrow('datasource options has to be specified');
  });

  it('setOptions', () => {
    const opts: UqlOptions = {
      logger: console.log,
    };
    setOptions(opts);
    expect(getOptions()).toEqual(opts);
  });
});