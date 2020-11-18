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
});
