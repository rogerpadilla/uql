import { initOnql } from '../config';
import { User, Item } from '../entity/entityMock';
import { GenericServerRepository } from './genericServerRepository';
import { getServerRepository } from './container';
import { Repository } from './decorator';

beforeEach(() => {
  initOnql({});
});

it('generic', () => {
  initOnql({
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

  initOnql({ defaultRepositoryClass: SomeGenericRepository });

  @Repository()
  class UserRepository extends GenericServerRepository<User, number> {
    constructor() {
      super(User);
    }
  }

  expect(getServerRepository(Item)).toBeInstanceOf(SomeGenericRepository);
  expect(getServerRepository(Item)).not.toBeInstanceOf(UserRepository);
  expect(getServerRepository(User)).toBeInstanceOf(UserRepository);
  expect(getServerRepository(User)).not.toBeInstanceOf(SomeGenericRepository);
});
