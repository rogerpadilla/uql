import { CustomRepositoryConstructor } from '../type';
import { setRepository } from '../container';

export function Repository() {
  return (repository: CustomRepositoryConstructor<any>) => {
    setRepository(repository);
  };
}
