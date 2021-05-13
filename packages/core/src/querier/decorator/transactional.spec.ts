import { getOptions, uql } from '@uql/core/options';
import { Querier, QuerierPool } from '../../type';
import { InjectQuerier } from './injectQuerier';
import { Transactional } from './transactional';

describe('transactional', () => {
  let anotherQuerier: Querier;
  let anotherQuerierPool: QuerierPool;

  beforeEach(() => {
    const defaultQuerier = mockQuerier();
    anotherQuerier = mockQuerier();

    uql({
      querierPool: {
        getQuerier: async () => defaultQuerier,
        end: async () => undefined,
      },
    });

    anotherQuerierPool = {
      getQuerier: async () => anotherQuerier,
      end: async () => undefined,
    };
  });

  it('injectQuerier', async () => {
    class ServiceA {
      @Transactional()
      async save(@InjectQuerier() querier?: Querier) {}
    }

    const serviceA = new ServiceA();
    await serviceA.save();

    const defaultQuerier = await getOptions().querierPool.getQuerier();

    expect(defaultQuerier.beginTransaction).toBeCalledTimes(1);
    expect(defaultQuerier.commitTransaction).toBeCalledTimes(1);
    expect(defaultQuerier.rollbackTransaction).toBeCalledTimes(0);
    expect(defaultQuerier.release).toBeCalledTimes(1);

    expect(anotherQuerier.beginTransaction).toBeCalledTimes(0);
    expect(anotherQuerier.commitTransaction).toBeCalledTimes(0);
    expect(anotherQuerier.rollbackTransaction).toBeCalledTimes(0);
    expect(anotherQuerier.release).toBeCalledTimes(0);
  });

  it('injectQuerier propagation: supported', async () => {
    class ServiceA {
      @Transactional({ propagation: 'supported' })
      async find(@InjectQuerier() querier?: Querier) {}
    }

    const serviceA = new ServiceA();
    await serviceA.find();

    const defaultQuerier = await getOptions().querierPool.getQuerier();

    expect(defaultQuerier.beginTransaction).toBeCalledTimes(0);
    expect(defaultQuerier.commitTransaction).toBeCalledTimes(0);
    expect(defaultQuerier.rollbackTransaction).toBeCalledTimes(0);
    expect(defaultQuerier.release).toBeCalledTimes(1);

    expect(anotherQuerier.beginTransaction).toBeCalledTimes(0);
    expect(anotherQuerier.commitTransaction).toBeCalledTimes(0);
    expect(anotherQuerier.rollbackTransaction).toBeCalledTimes(0);
    expect(anotherQuerier.release).toBeCalledTimes(0);
  });

  it('injectQuerier another querierPool', async () => {
    class ServiceA {
      @Transactional({ querierPool: anotherQuerierPool })
      async save(@InjectQuerier() querier?: Querier) {}
    }

    const serviceA = new ServiceA();
    await serviceA.save();

    expect(anotherQuerier.beginTransaction).toBeCalledTimes(1);
    expect(anotherQuerier.commitTransaction).toBeCalledTimes(1);
    expect(anotherQuerier.rollbackTransaction).toBeCalledTimes(0);
    expect(anotherQuerier.release).toBeCalledTimes(1);

    const defaultQuerier = await getOptions().querierPool.getQuerier();

    expect(defaultQuerier.beginTransaction).toBeCalledTimes(0);
    expect(defaultQuerier.commitTransaction).toBeCalledTimes(0);
    expect(defaultQuerier.rollbackTransaction).toBeCalledTimes(0);
    expect(defaultQuerier.release).toBeCalledTimes(0);
  });

  it('injectQuerier and call super', async () => {
    const removeStub = jest.fn((id: string, querier: Querier) => {});

    class ServiceA {
      @Transactional()
      async remove(id: string, @InjectQuerier() querier?: Querier) {
        removeStub(id, querier);
      }
    }

    class ServiceB extends ServiceA {
      @Transactional({ querierPool: anotherQuerierPool })
      async remove(id: string, @InjectQuerier() querier?: Querier) {
        return super.remove(id, querier);
      }
    }

    const serviceB = new ServiceB();
    await serviceB.remove('123');

    const defaultQuerier = await getOptions().querierPool.getQuerier();

    expect(removeStub).toBeCalledTimes(1);
    expect(removeStub).toHaveBeenCalledWith('123', anotherQuerier);

    expect(anotherQuerier.beginTransaction).toBeCalledTimes(1);
    expect(anotherQuerier.commitTransaction).toBeCalledTimes(1);
    expect(anotherQuerier.rollbackTransaction).toBeCalledTimes(0);
    expect(anotherQuerier.release).toBeCalledTimes(1);

    expect(defaultQuerier.beginTransaction).toBeCalledTimes(0);
    expect(defaultQuerier.commitTransaction).toBeCalledTimes(0);
    expect(defaultQuerier.rollbackTransaction).toBeCalledTimes(0);
    expect(defaultQuerier.release).toBeCalledTimes(0);
  });

  it('throw', async () => {
    class ServiceA {
      @Transactional({ propagation: 'supported' })
      async save(@InjectQuerier() querier?: Querier) {
        throw new Error('Some Error');
      }
    }

    const serviceA = new ServiceA();
    const promise = serviceA.save();

    await expect(promise).rejects.toThrow('Some Error');

    const defaultQuerier = await getOptions().querierPool.getQuerier();

    expect(defaultQuerier.beginTransaction).toBeCalledTimes(0);
    expect(defaultQuerier.commitTransaction).toBeCalledTimes(0);
    expect(defaultQuerier.rollbackTransaction).toBeCalledTimes(0);
    expect(defaultQuerier.release).toBeCalledTimes(1);

    expect(anotherQuerier.beginTransaction).toBeCalledTimes(0);
    expect(anotherQuerier.commitTransaction).toBeCalledTimes(0);
    expect(anotherQuerier.rollbackTransaction).toBeCalledTimes(0);
    expect(anotherQuerier.release).toBeCalledTimes(0);
  });

  it('throw inside transaction', async () => {
    class ServiceA {
      @Transactional()
      async save(@InjectQuerier() querier?: Querier) {
        throw new Error('Some Error');
      }
    }

    const serviceA = new ServiceA();
    const promise = serviceA.save();

    await expect(promise).rejects.toThrow('Some Error');

    const defaultQuerier = await getOptions().querierPool.getQuerier();

    expect(defaultQuerier.beginTransaction).toBeCalledTimes(1);
    expect(defaultQuerier.commitTransaction).toBeCalledTimes(0);
    expect(defaultQuerier.rollbackTransaction).toBeCalledTimes(1);
    expect(defaultQuerier.release).toBeCalledTimes(1);

    expect(anotherQuerier.beginTransaction).toBeCalledTimes(0);
    expect(anotherQuerier.commitTransaction).toBeCalledTimes(0);
    expect(anotherQuerier.rollbackTransaction).toBeCalledTimes(0);
    expect(anotherQuerier.release).toBeCalledTimes(0);
  });

  it('missing injectQuerier', async () => {
    await expect(async () => {
      class ServiceA {
        @Transactional()
        async find() {}
      }
    }).rejects.toThrow("missing decorator @InjectQuerier() in the method 'find' of 'ServiceA'");
  });
});

function mockQuerier(): Querier {
  const querier = {
    beginTransaction: jest.fn(async () => {
      querier.hasOpenTransaction = true;
    }),
    commitTransaction: jest.fn(async () => {
      querier.hasOpenTransaction = undefined;
    }),
    rollbackTransaction: jest.fn(async () => {
      querier.hasOpenTransaction = undefined;
    }),
    release: jest.fn(async () => {}),
  } as Partial<Querier> as Writable<Querier>;
  return querier;
}

export type Writable<T> = { -readonly [P in keyof T]: T[P] };
