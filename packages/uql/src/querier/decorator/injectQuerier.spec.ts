import { Querier } from '../querier';
import { getInjectQuerier, InjectQuerier } from './injectQuerier';

it('injectQuerier', () => {
  class ServiceA {
    find() {}
  }
  expect(getInjectQuerier(ServiceA.prototype, 'find')).toBe(undefined);

  class ServiceB {
    find(@InjectQuerier() someQuerier: Querier) {}
  }
  expect(getInjectQuerier(ServiceB.prototype, 'find')).toBe(0);

  class ServiceC {
    find(something: string, @InjectQuerier() theQuerier: Querier) {}
  }
  expect(getInjectQuerier(ServiceC.prototype, 'find')).toBe(1);

  expect(() => {
    class ServiceD {
      find(something: string, @InjectQuerier() querier: Querier, @InjectQuerier() anotherQuerier: Querier) {}
    }
  }).toThrow("Decorator @InjectQuerier() must appear only once in the parameters of 'ServiceD.find'");
});
