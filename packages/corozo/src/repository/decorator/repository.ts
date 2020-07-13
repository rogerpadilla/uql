import { CustomRepositoryConstructor } from '../type';
import { setCustomRepository } from '../container';

export function Repository() {
  return (repositoryClass: CustomRepositoryConstructor<any>): void => {
    const repository = new repositoryClass();
    setCustomRepository(repository.meta.type, repository);
  };
}
