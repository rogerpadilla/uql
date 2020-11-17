import { setCustomRepository } from 'uql/container';
import { CustomRepositoryConstructor } from 'uql/type';

export function CustomRepository() {
  return (customRepositoryClass: CustomRepositoryConstructor<any>): void => {
    const repository = new customRepositoryClass();
    setCustomRepository(repository.meta.type, repository);
  };
}
