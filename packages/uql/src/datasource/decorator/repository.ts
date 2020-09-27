import { setCustomRepository } from 'uql/container';
import { CustomRepositoryConstructor } from 'uql/type';

export function Repository() {
  return (repositoryClass: CustomRepositoryConstructor<any>): void => {
    const repository = new repositoryClass();
    setCustomRepository(repository.meta.type, repository);
  };
}
