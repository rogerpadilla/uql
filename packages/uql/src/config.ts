import { GenericRepositoryConstructor } from './repository/type';
import { resetContainer } from './repository/container';
import { DatasourceOptions } from './datasource/type';

let opts: UqlOptions;

export function initUql(conf: UqlOptions): void {
  resetContainer();
  opts = { ...conf };
}

export function getUqlOptions(): UqlOptions {
  return { ...opts };
}

type UqlOptions = {
  datasource?: DatasourceOptions;
  defaultRepositoryClass?: GenericRepositoryConstructor<unknown>;
};
