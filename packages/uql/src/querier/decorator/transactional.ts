import { getQuerier } from 'uql/querier';
import { QuerierContract } from 'uql/type';
import { Querier } from '../querier';
import { getInjectQuerier } from './injectQuerier';

export function Transactional(opts: { readonly propagation: 'supported' | 'required' } = { propagation: 'supported' }) {
  return (target: object, prop: string, propDescriptor: PropertyDescriptor): void => {
    const originalMethod: (this: object, ...args: unknown[]) => unknown = propDescriptor.value;
    const injectQuerierIndex = getInjectQuerier(target, prop);

    if (injectQuerierIndex === undefined) {
      throw new TypeError(
        `missing decorator @InjectQuerier() in one of the parameters of '${target.constructor.name}.${prop}'`
      );
    }

    propDescriptor.value = async function func(this: object, ...args: object[]) {
      let isOwnAuto: boolean;
      let querier: QuerierContract;

      if (args[injectQuerierIndex] instanceof Querier) {
        querier = args[injectQuerierIndex] as Querier;
      } else {
        querier = await getQuerier();
        args[injectQuerierIndex] = querier;
        isOwnAuto = true;
      }

      try {
        if (opts.propagation === 'required' && !querier.hasOpenTransaction) {
          await querier.beginTransaction();
        }
        const resp = await originalMethod.apply(this, args);
        if (isOwnAuto && querier.hasOpenTransaction) {
          await querier.commitTransaction();
        }
        return resp;
      } catch (err) {
        if (isOwnAuto && querier.hasOpenTransaction) {
          await querier.rollbackTransaction();
        }
        throw err;
      } finally {
        if (isOwnAuto) {
          await querier.release();
        }
      }
    };
  };
}
