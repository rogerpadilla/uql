import { getOptions } from '@uql/core/options';
import { Querier, QuerierPool, Type } from '../../type';
import { getInjectedQuerierIndex } from './injectQuerier';
import { getInjectedRepositoriesMap } from './injectRepository';

type Props = {
  readonly propagation?: 'supported' | 'required';
  readonly querierPool?: QuerierPool;
};

export function Transactional(options: Props = {}) {
  const { propagation, querierPool } = { propagation: 'required', ...options };

  return (target: object, prop: string, propDescriptor: PropertyDescriptor): void => {
    const theClass = target.constructor as Type<any>;
    const originalMethod = propDescriptor.value;
    const injectedQuerierIndex = getInjectedQuerierIndex(theClass, prop);
    const injectedRepositoriesMap = getInjectedRepositoriesMap(theClass, prop);

    if (injectedQuerierIndex === undefined && injectedRepositoriesMap === undefined) {
      throw new TypeError(
        `missing decorator @InjectQuerier() or @InjectRepository(SomeEntity) in '${target.constructor.name}.${prop}'`
      );
    }

    propDescriptor.value = async function func(this: object, ...args: any[]) {
      let isOwnTransaction: boolean;
      let querier: Querier;

      if (args[injectedQuerierIndex]) {
        querier = args[injectedQuerierIndex];
      } else {
        isOwnTransaction = true;
        const pool = querierPool ?? getOptions().querierPool;
        querier = await pool.getQuerier();
        args[injectedQuerierIndex] = querier;
      }

      injectedRepositoriesMap &&
        Object.entries(injectedRepositoriesMap).forEach(([index, entity]: [string, Type<any>]) => {
          if (args[index] === undefined) {
            args[index] = querier.getRepository(entity);
          }
        });

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
