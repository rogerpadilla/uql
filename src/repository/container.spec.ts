import { initCorozo } from '../config';
import { User, Item } from '../entity/entityMock';
import { GenericClientRepository } from './genericClientRepository';
import { GenericServerRepository } from './genericServerRepository';
import { getServerRepository, resetContainer } from './container';
import { Repository } from './decorator';

afterEach(() => {
  resetContainer();
  initCorozo({
    defaultRepositoryClass: undefined,
  });
});

it('generic', () => {
  initCorozo({
    defaultRepositoryClass: GenericServerRepository,
  });
  const repository = getServerRepository(User);
  expect(repository).toBeInstanceOf(GenericServerRepository);
});

it('no repository', () => {
  expect(() => getServerRepository(User)).toThrowError(
    'Either a generic repository or a specific repository (for the type User) must be registered first'
  );
});

it('@Repository()', () => {
  class SomeGenericRepository extends GenericServerRepository<any, number> {}

  @Repository()
  class UserRepository extends GenericClientRepository<User, number> {
    constructor() {
      super(User);
    }
  }

  initCorozo({ defaultRepositoryClass: SomeGenericRepository });

  expect(getServerRepository(Item)).toBeInstanceOf(SomeGenericRepository);
  expect(getServerRepository(Item)).not.toBeInstanceOf(UserRepository);
  expect(getServerRepository(User)).toBeInstanceOf(UserRepository);
  expect(getServerRepository(User)).not.toBeInstanceOf(SomeGenericRepository);
});
