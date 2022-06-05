import { Querier } from '../../type/index';
import { getInjectedQuerierIndex, InjectQuerier } from './injectQuerier';

describe('injectQuerier', () => {
  it('no inject', () => {
    class ServiceA {
      save() {}

      hello(param1: string, someQuerier?: Querier) {}
    }

    expect(getInjectedQuerierIndex(ServiceA, 'save')).toBe(undefined);
    expect(getInjectedQuerierIndex(ServiceA, 'hello')).toBe(undefined);
  });

  it('one', () => {
    class ServiceA {
      save(@InjectQuerier() someQuerier?: Querier) {}

      update(param1: string, @InjectQuerier() someQuerier?: Querier) {}
    }

    expect(getInjectedQuerierIndex(ServiceA, 'save')).toBe(0);
    expect(getInjectedQuerierIndex(ServiceA, 'update')).toBe(1);
  });

  it('inheritance', () => {
    class ServiceA {
      save(@InjectQuerier() someQuerier?: Querier) {}
    }
    class ServiceB extends ServiceA {}
    class ServiceC extends ServiceB {
      hello(@InjectQuerier() someQuerier?: Querier) {}
    }

    class ServiceD extends ServiceC {}

    class ServiceE extends ServiceB {}

    expect(getInjectedQuerierIndex(ServiceA, 'save')).toBe(0);
    expect(getInjectedQuerierIndex(ServiceB, 'save')).toBe(0);
    expect(getInjectedQuerierIndex(ServiceC, 'save')).toBe(0);
    expect(getInjectedQuerierIndex(ServiceC, 'hello')).toBe(0);
    expect(getInjectedQuerierIndex(ServiceD, 'save')).toBe(0);
    expect(getInjectedQuerierIndex(ServiceC, 'hello')).toBe(0);
    expect(getInjectedQuerierIndex(ServiceE, 'save')).toBe(0);
  });

  it('inheritance - overridden', () => {
    class ServiceA {
      save(@InjectQuerier() someQuerier?: Querier) {}
    }
    class ServiceB extends ServiceA {
      override save(someQuerier?: Querier) {}
    }

    class ServiceC extends ServiceA {
      override save(@InjectQuerier() someQuerier?: Querier) {}
    }

    expect(getInjectedQuerierIndex(ServiceA, 'save')).toBe(0);
    expect(getInjectedQuerierIndex(ServiceB, 'save')).toBe(undefined);
    expect(getInjectedQuerierIndex(ServiceC, 'save')).toBe(0);
  });

  it('prevent duplicated injection', () => {
    expect(() => {
      class ServiceA {
        save(@InjectQuerier() someQuerier?: Querier, @InjectQuerier() anotherQuerier?: Querier) {}
      }
    }).toThrow("@InjectQuerier() can only appears once in 'ServiceA.save'");
  });
});
