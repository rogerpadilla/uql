import { getQuerier, setQuerierPool } from '../../options';
import { Querier, QuerierPool, Writable } from '../../type';
import { InjectQuerier } from './injectQuerier.js';
import { Transactional } from './transactional.js';

describe('transactional', () => {
  let anotherQuerierPool: QuerierPool;

  beforeEach(() => {
    const querierSingleton = buildQuerierMock();
    const anotherQuerierSingleton = buildQuerierMock();

    setQuerierPool({
      getQuerier: async () => querierSingleton,
      end: async () => undefined,
    });

    anotherQuerierPool = {
      getQuerier: async () => anotherQuerierSingleton,
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

    const querier = await getQuerier();

    expect(querier.beginTransaction).toBeCalledTimes(1);
    expect(querier.commitTransaction).toBeCalledTimes(1);
    expect(querier.rollbackTransaction).toBeCalledTimes(0);
    expect(querier.release).toBeCalledTimes(1);

    const anotherQuerier = await anotherQuerierPool.getQuerier();

    expect(anotherQuerier.beginTransaction).toBeCalledTimes(0);
    expect(anotherQuerier.commitTransaction).toBeCalledTimes(0);
    expect(anotherQuerier.rollbackTransaction).toBeCalledTimes(0);
    expect(anotherQuerier.release).toBeCalledTimes(0);
  });

  it('injectQuerier - querier and repositories', async () => {
    class ServiceA {
      @Transactional()
      async save(@InjectQuerier() querier?: Querier) {}
    }

    const serviceA = new ServiceA();
    await serviceA.save();

    const querier = await getQuerier();

    expect(querier.beginTransaction).toBeCalledTimes(1);
    expect(querier.commitTransaction).toBeCalledTimes(1);
    expect(querier.rollbackTransaction).toBeCalledTimes(0);
    expect(querier.release).toBeCalledTimes(1);

    const anotherQuerier = await anotherQuerierPool.getQuerier();

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

    const querier = await getQuerier();

    expect(querier.beginTransaction).toBeCalledTimes(0);
    expect(querier.commitTransaction).toBeCalledTimes(0);
    expect(querier.rollbackTransaction).toBeCalledTimes(0);
    expect(querier.release).toBeCalledTimes(1);

    const anotherQuerier = await anotherQuerierPool.getQuerier();

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

    const anotherQuerier = await anotherQuerierPool.getQuerier();

    expect(anotherQuerier.beginTransaction).toBeCalledTimes(1);
    expect(anotherQuerier.commitTransaction).toBeCalledTimes(1);
    expect(anotherQuerier.rollbackTransaction).toBeCalledTimes(0);
    expect(anotherQuerier.release).toBeCalledTimes(1);

    const querier = await getQuerier();

    expect(querier.beginTransaction).toBeCalledTimes(0);
    expect(querier.commitTransaction).toBeCalledTimes(0);
    expect(querier.rollbackTransaction).toBeCalledTimes(0);
    expect(querier.release).toBeCalledTimes(0);
  });

  it('injectQuerier and call super', async () => {
    const deleteStub = jest.fn((id: string, querier: Querier) => {});

    class ServiceA {
      @Transactional()
      async delete(id: string, @InjectQuerier() querier?: Querier) {
        deleteStub(id, querier);
      }
    }

    class ServiceB extends ServiceA {
      @Transactional({ querierPool: anotherQuerierPool })
      override async delete(id: string, @InjectQuerier() querier?: Querier) {
        return super.delete(id, querier);
      }
    }

    const serviceB = new ServiceB();
    await serviceB.delete('123');

    const querier = await getQuerier();

    expect(deleteStub).toBeCalledTimes(1);

    const anotherQuerier = await anotherQuerierPool.getQuerier();

    expect(deleteStub).toHaveBeenCalledWith('123', anotherQuerier);

    expect(anotherQuerier.beginTransaction).toBeCalledTimes(1);
    expect(anotherQuerier.commitTransaction).toBeCalledTimes(1);
    expect(anotherQuerier.rollbackTransaction).toBeCalledTimes(0);
    expect(anotherQuerier.release).toBeCalledTimes(1);

    expect(querier.beginTransaction).toBeCalledTimes(0);
    expect(querier.commitTransaction).toBeCalledTimes(0);
    expect(querier.rollbackTransaction).toBeCalledTimes(0);
    expect(querier.release).toBeCalledTimes(0);
  });

  it('throw', async () => {
    class ServiceA {
      @Transactional({ propagation: 'supported' })
      async save(@InjectQuerier() querier?: Querier) {
        throw new Error('Some Error');
      }
    }

    const serviceA = new ServiceA();

    await expect(serviceA.save()).rejects.toThrow('Some Error');

    const querier = await getQuerier();

    expect(querier.beginTransaction).toBeCalledTimes(0);
    expect(querier.commitTransaction).toBeCalledTimes(0);
    expect(querier.rollbackTransaction).toBeCalledTimes(0);
    expect(querier.release).toBeCalledTimes(1);

    const anotherQuerier = await anotherQuerierPool.getQuerier();

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

    await expect(serviceA.save()).rejects.toThrow('Some Error');

    const querier = await getQuerier();

    expect(querier.beginTransaction).toBeCalledTimes(1);
    expect(querier.commitTransaction).toBeCalledTimes(0);
    expect(querier.rollbackTransaction).toBeCalledTimes(1);
    expect(querier.release).toBeCalledTimes(1);

    const anotherQuerier = await anotherQuerierPool.getQuerier();

    expect(anotherQuerier.beginTransaction).toBeCalledTimes(0);
    expect(anotherQuerier.commitTransaction).toBeCalledTimes(0);
    expect(anotherQuerier.rollbackTransaction).toBeCalledTimes(0);
    expect(anotherQuerier.release).toBeCalledTimes(0);
  });

  it('missing injectQuerier', () => {
    expect(() => {
      class ServiceA {
        @Transactional()
        async find() {}
      }
    }).toThrow("missing decorator @InjectQuerier() in 'ServiceA.find'");
  });
});

function buildQuerierMock(): Querier {
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
