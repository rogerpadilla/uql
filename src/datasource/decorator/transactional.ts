import { Querier } from '../type';
import { getQuerier } from '../querierPool';
import { getInjectQuerier } from './injectQuerier';

export function Transactional(opts: { readonly propagation: 'supports' | 'required' } = { propagation: 'supports' }) {
  return (target: object, prop: string, propDescriptor: PropertyDescriptor) => {
    const originalMethod: Function = propDescriptor.value;
    const injectQuerierIndex = getInjectQuerier(target, prop);

    if (injectQuerierIndex === undefined) {
      throw new Error(`Missing decorator @InjectQuerier() in one of the parameters of '${target.constructor.name}.${prop}'`);
    }

    propDescriptor.value = async function func(this: object, ...args: any[]) {
      let isOwnAuto: boolean;
      let querier: Querier;

      if (args[injectQuerierIndex] instanceof Querier) {
        querier = args[injectQuerierIndex];
      } else {
        querier = await getQuerier();
        args[injectQuerierIndex] = querier;
        isOwnAuto = true;
      }

      try {
        if (!querier.hasOpenTransaction()) {
          if (opts.propagation === 'required') {
            await querier.beginTransaction();
          }
        }
        const resp = await originalMethod.apply(this, args);
        if (isOwnAuto && querier.hasOpenTransaction()) {
          await querier.commit();
        }
        return resp;
      } catch (err) {
        if (isOwnAuto && querier.hasOpenTransaction()) {
          await querier.rollback();
        }
        throw err;
      } finally {
        if (isOwnAuto) {
          querier.release();
        }
      }
    };
  };
}
