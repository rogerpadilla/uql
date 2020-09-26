import { CustomRepositoryConstructor } from 'uql/type';
import { setCustomRepository } from 'uql/container';

export function Repository() {
  return (repositoryClass: CustomRepositoryConstructor<any>): void => {
    const repository = new repositoryClass();
    setCustomRepository(repository.meta.type, repository);
  };
}
