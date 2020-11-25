/* eslint-disable @typescript-eslint/ban-ts-comment */
import { Querier } from '../../type';
import { injectQuerier, InjectQuerier } from './injectQuerier';
import { Transactional } from './transactional';
jest.mock('../querierPool', () => {
  return {
    getQuerier: async () => someMockedQuerier,
  };
});

let someMockedQuerier: Partial<Querier>;

describe('transactional', () => {
  let anotherMockedQuerier: Partial<Querier>;

  beforeEach(() => {
    someMockedQuerier = {
      beginTransaction: jest.fn(async () => {
        // @ts-expect-error
        someMockedQuerier.hasOpenTransaction = true;
      }),
      commitTransaction: jest.fn(async () => {
        // @ts-expect-error
        someMockedQuerier.hasOpenTransaction = undefined;
      }),
      rollbackTransaction: jest.fn(async () => {
        // @ts-expect-error
        someMockedQuerier.hasOpenTransaction = undefined;
      }),
      release: jest.fn(async () => {}),
    };
    anotherMockedQuerier = {
      beginTransaction: jest.fn(async () => {
        // @ts-expect-error
        anotherMockedQuerier.hasOpenTransaction = true;
      }),
      commitTransaction: jest.fn(async () => {
        // @ts-expect-error
        anotherMockedQuerier.hasOpenTransaction = undefined;
      }),
      rollbackTransaction: jest.fn(async () => {
        // @ts-expect-error
        anotherMockedQuerier.hasOpenTransaction = undefined;
      }),
      release: jest.fn(async () => {}),
    };
  });

  it('injectQuerier', async () => {
    class ServiceA {
      @InjectQuerier()
      querier: Querier;

      @Transactional()
      async save() {}
    }

    const serviceA = new ServiceA();
    expect(serviceA.querier).toBe(undefined);

    await serviceA.save();

    expect(serviceA.querier).toBe(undefined);
    expect(someMockedQuerier.beginTransaction).toBeCalledTimes(1);
    expect(someMockedQuerier.commitTransaction).toBeCalledTimes(1);
    expect(someMockedQuerier.release).toBeCalledTimes(1);
  });

  it('injectQuerier - inheritance', async () => {
    class ServiceA {
      @InjectQuerier()
      querier: Querier;
    }

    class ServiceB extends ServiceA {
      @Transactional()
      async save() {}
    }

    const serviceB = new ServiceB();
    await serviceB.save();

    expect(someMockedQuerier.beginTransaction).toBeCalledTimes(1);
    expect(someMockedQuerier.commitTransaction).toBeCalledTimes(1);
    expect(someMockedQuerier.release).toBeCalledTimes(1);
  });

  it('injectQuerier propagation: supported', async () => {
    class ServiceA {
      @InjectQuerier()
      querier: Querier;

      @Transactional({ propagation: 'supported' })
      async find() {}
    }

    const serviceA = new ServiceA();

    await serviceA.find();

    expect(someMockedQuerier.beginTransaction).toBeCalledTimes(0);
    expect(someMockedQuerier.commitTransaction).toBeCalledTimes(0);
    expect(someMockedQuerier.release).toBeCalledTimes(1);
  });

  it('injectQuerier existing', async () => {
    class ServiceA {
      @InjectQuerier()
      querier: Querier;

      @Transactional()
      async save() {}
    }

    const serviceA = new ServiceA();
    expect(serviceA.querier).toBe(undefined);
    injectQuerier(serviceA, anotherMockedQuerier as Querier);
    expect(serviceA.querier).toBe(anotherMockedQuerier);

    await serviceA.save();

    expect(serviceA.querier).toBe(anotherMockedQuerier);
    expect(anotherMockedQuerier.beginTransaction).toBeCalledTimes(1);
    expect(anotherMockedQuerier.commitTransaction).toBeCalledTimes(0);
    expect(anotherMockedQuerier.release).toBeCalledTimes(0);
  });

  it('throw', async () => {
    class ServiceA {
      @InjectQuerier()
      querier: Querier;

      @Transactional({ propagation: 'supported' })
      async save() {
        throw new Error('Some Error');
      }
    }

    const serviceA = new ServiceA();

    await expect(serviceA.save()).rejects.toThrow('Some Error');
    expect(someMockedQuerier.beginTransaction).toBeCalledTimes(0);
    expect(someMockedQuerier.commitTransaction).toBeCalledTimes(0);
    expect(someMockedQuerier.rollbackTransaction).toBeCalledTimes(0);
    expect(someMockedQuerier.release).toBeCalledTimes(1);
  });

  it('throw inside transaction', async () => {
    class ServiceA {
      @InjectQuerier()
      querier: Querier;

      @Transactional()
      async save() {
        throw new Error('Some Error');
      }
    }

    const serviceA = new ServiceA();

    await expect(serviceA.save()).rejects.toThrow('Some Error');
    expect(someMockedQuerier.beginTransaction).toBeCalledTimes(1);
    expect(someMockedQuerier.commitTransaction).toBeCalledTimes(0);
    expect(someMockedQuerier.rollbackTransaction).toBeCalledTimes(1);
    expect(someMockedQuerier.release).toBeCalledTimes(1);
  });

  it('missing injectQuerier', async () => {
    await expect(async () => {
      class ServiceA {
        @Transactional()
        async find() {}
      }
    }).rejects.toThrow("missing decorator @InjectQuerier() in one of the properties of 'ServiceA'");
  });
});
