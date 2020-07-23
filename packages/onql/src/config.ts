import { GenericRepositoryConstructor } from './repository/type';
import { resetContainer } from './repository/container';
import { DatasourceOptions } from './datasource/type';

let opts: OnqlOptions;

export function initOnql(conf: OnqlOptions): void {
  opts = { ...conf };
  resetContainer();
}

export function getOnqlOptions(): OnqlOptions {
  return { ...opts };
}

type OnqlOptions = {
  datasource?: DatasourceOptions;
  defaultRepositoryClass?: GenericRepositoryConstructor<unknown>;
};
