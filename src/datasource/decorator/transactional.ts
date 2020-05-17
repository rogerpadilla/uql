import { Querier } from '../type';
import { getQuerier } from '../querierPool';
import { getInjectQuerier } from './injectQuerier';

export function Transactional(opts: { readonly propagation: 'supports' | 'required' } = { propagation: 'supports' }) {
  return (target: object, propertyKey: string, propertyDescriptor: PropertyDescriptor) => {
    const originalMethod: Function = propertyDescriptor.value;
    const injectQuerierIndex = getInjectQuerier(target, propertyKey);

    if (injectQuerierIndex === undefined) {
      throw new Error(
        `Missing decorator @InjectQuerier() in one of the parameters of '${target.constructor.name}.${propertyKey}'`
      );
    }

    propertyDescriptor.value = async function func(this: object, ...args: any[]) {
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
