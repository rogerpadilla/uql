import { getDefaultQuerierPool } from '@uql/core/options';
import { Querier, QuerierPool, Type } from '@uql/core/type';
import { getInjectedQuerierIndex } from './injectQuerier.js';

export function Transactional({
  propagation = 'required',
  querierPool,
}: {
  readonly propagation?: 'supported' | 'required';
  readonly querierPool?: QuerierPool;
} = {}) {
  return (target: object, key: string, propDescriptor: PropertyDescriptor): void => {
    const theClass = target.constructor as Type<any>;
    const originalMethod = propDescriptor.value;
    const injectedQuerierIndex = getInjectedQuerierIndex(theClass, key);

    if (injectedQuerierIndex === undefined) {
      throw TypeError(`missing decorator @InjectQuerier() in '${target.constructor.name}.${key}'`);
    }

    propDescriptor.value = async function func(this: object, ...args: any[]) {
      const params = [...args];
      let isOwnTransaction: boolean;
      let querier: Querier;

      if (params[injectedQuerierIndex]) {
        querier = params[injectedQuerierIndex];
      } else {
        isOwnTransaction = true;
        const pool = querierPool ?? getDefaultQuerierPool();
        querier = await pool.getQuerier();
        params[injectedQuerierIndex] = querier;
      }

      try {
        if (propagation === 'required' && !querier.hasOpenTransaction) {
          await querier.beginTransaction();
        }
        const resp = await originalMethod.apply(this, params);
        if (isOwnTransaction && querier.hasOpenTransaction) {
          await querier.commitTransaction();
        }
        return resp;
      } catch (err) {
        if (isOwnTransaction && querier.hasOpenTransaction) {
          await querier.rollbackTransaction();
        }
        throw err;
      } finally {
        if (isOwnTransaction) {
          await querier.release();
        }
      }
    };
  };
}
