import { Querier } from '../../type';
import { getQuerier } from '../querierPool';
import { getInjectedQuerierProperty, injectQuerier } from './injectQuerier';

export function Transactional(opts: { readonly propagation: 'supported' | 'required' } = { propagation: 'required' }) {
  return (target: object, prop: string, propDescriptor: PropertyDescriptor): void => {
    const originalMethod = propDescriptor.value;
    const injectedQuerierProperty = getInjectedQuerierProperty(target);

    if (injectedQuerierProperty === undefined) {
      throw new TypeError(
        `missing decorator @InjectQuerier() in one of the properties of '${target.constructor.name}'`
      );
    }

    propDescriptor.value = async function func(this: object, ...args: object[]) {
      let isOwnAuto: boolean;
      let querier: Querier;

      if (this[injectedQuerierProperty]) {
        querier = this[injectedQuerierProperty];
      } else {
        querier = await getQuerier();
        isOwnAuto = true;
        injectQuerier(this, querier);
      }

      try {
        if (opts.propagation === 'required' && !querier.hasOpenTransaction) {
          await querier.beginTransaction();
        }
        const resp = await originalMethod.apply(this, args);
        if (querier.hasOpenTransaction && isOwnAuto) {
          await querier.commitTransaction();
        }
        return resp;
      } catch (err) {
        if (querier.hasOpenTransaction && isOwnAuto) {
          await querier.rollbackTransaction();
        }
        throw err;
      } finally {
        if (isOwnAuto) {
          await querier.release();
          injectQuerier(this, undefined);
        }
      }
    };
  };
}
