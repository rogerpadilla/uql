import { getOptions } from '@uql/core/options';
import { Querier, QuerierPool, Type } from '../../type';
import { getInjectedQuerierIndex } from './injectQuerier';

type Props = {
  readonly propagation?: 'supported' | 'required';
  readonly querierPool?: QuerierPool;
};

export function Transactional(options: Props = {}) {
  const { propagation, querierPool } = { propagation: 'required', ...options };

  return (target: object, prop: string, propDescriptor: PropertyDescriptor): void => {
    const theClass = target.constructor as Type<any>;
    const originalMethod = propDescriptor.value;
    const injectIndex = getInjectedQuerierIndex(theClass, prop);

    if (injectIndex === undefined) {
      throw new TypeError(`missing decorator @InjectQuerier() in the method '${prop}' of '${target.constructor.name}'`);
    }

    propDescriptor.value = async function func(this: object, ...args: any[]) {
      let isOwnTransaction: boolean;
      let querier: Querier;

      if (args[injectIndex]) {
        querier = args[injectIndex];
      } else {
        isOwnTransaction = true;
        const pool = querierPool ?? getOptions().querierPool;
        querier = await pool.getQuerier();
        args[injectIndex] = querier;
      }

      try {
        if (propagation === 'required' && !querier.hasOpenTransaction) {
          await querier.beginTransaction();
        }
        const resp = await originalMethod.apply(this, args);
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
