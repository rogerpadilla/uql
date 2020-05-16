import { GenericRepositoryConstructor } from './repository/type';
import { DatasourceOptions } from './datasource/type';

let opts: CorozoOptions;

export function initCorozo(conf: CorozoOptions) {
  opts = { ...conf };
}

export function getCorozoOptions() {
  return { ...opts };
}

type CorozoOptions = { datasource?: DatasourceOptions; defaultRepositoryClass?: GenericRepositoryConstructor<any> };
