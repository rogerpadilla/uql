import { Querier } from '../querier';
import { getInjectQuerier, InjectQuerier } from './injectQuerier';
import { Transactional } from './transactional';

describe('injectQuerier', () => {
  it('injectQuerier', () => {
    class ServiceA {
      @Transactional()
      find(@InjectQuerier() querierA: Querier) {}
    }
    expect(getInjectQuerier(ServiceA.prototype, 'find')).toBe(0);
  });

  it('missing injectQuerier', () => {
    expect(() => {
      class ServiceF {
        @Transactional()
        find() {}
      }
    }).toThrow("missing decorator @InjectQuerier() in one of the parameters of 'ServiceF.find'");
  });
});
