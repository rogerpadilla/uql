import { GenericRepositoryConstructor } from './repository/type';
import { resetContainer } from './repository/container';
import { DatasourceOptions } from './datasource/type';

let opts: CorozoOptions;

export function initCorozo(conf: CorozoOptions) {
  opts = { ...conf };
  resetContainer();
}

export function getCorozoOptions() {
  return { ...opts };
}

type CorozoOptions = { datasource?: DatasourceOptions; defaultRepositoryClass?: GenericRepositoryConstructor<any> };
