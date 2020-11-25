import { Querier } from '../../type';
import { getInjectedQuerierProperty, injectQuerier, InjectQuerier } from './injectQuerier';

describe('injectQuerier', () => {
  it('no inject', () => {
    class ServiceA {
      someQuerier: Querier;
    }

    expect(getInjectedQuerierProperty(ServiceA.prototype)).toBe(undefined);
  });

  it('inject', () => {
    class ServiceA {
      @InjectQuerier() someQuerier: Querier;
    }

    expect(getInjectedQuerierProperty(ServiceA.prototype)).toBe('someQuerier');
  });

  it('inheritance - inject in parent', () => {
    class ServiceA {
      @InjectQuerier() theQuerier: Querier;
    }
    class ServiceB extends ServiceA {}
    class ServiceC extends ServiceB {}

    expect(getInjectedQuerierProperty(ServiceA.prototype)).toBe('theQuerier');
    expect(getInjectedQuerierProperty(ServiceB.prototype)).toBe('theQuerier');
    expect(getInjectedQuerierProperty(ServiceC.prototype)).toBe('theQuerier');
  });

  it('inheritance - inject in both', () => {
    class ServiceA {
      @InjectQuerier() parentQuerier: Querier;
    }
    class ServiceB extends ServiceA {
      @InjectQuerier() childQuerier: Querier;
    }

    expect(getInjectedQuerierProperty(ServiceA.prototype)).toBe('parentQuerier');
    expect(getInjectedQuerierProperty(ServiceB.prototype)).toBe('childQuerier');
  });

  it('injectQuerier - inheritance', () => {
    class ServiceA {
      @InjectQuerier() parentQuerier: Querier;
    }
    class ServiceB extends ServiceA {
      @InjectQuerier() childQuerier: Querier;
    }

    const querier = {} as Querier;
    const serviceB = new ServiceB();
    injectQuerier(serviceB, querier);

    expect(serviceB.childQuerier).toBe(querier);
    expect(serviceB.parentQuerier).toBe(querier);
    expect(getInjectedQuerierProperty(ServiceB.prototype)).toBe('childQuerier');
  });

  it('prevent more than one injection', () => {
    expect(() => {
      class ServiceZ {
        @InjectQuerier() querierA: Querier;
        @InjectQuerier() querierB: Querier;
      }
    }).toThrow("Decorator @InjectQuerier() is already used in 'ServiceZ.querierA'");
  });
});
