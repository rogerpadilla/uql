import { Company, User } from '@uql/core/test';
import { Repository } from '../../type';
import { getInjectedRepositoriesMap, InjectRepository } from './injectRepository';

describe('injectRepository', () => {
  it('no inject', () => {
    class ServiceA {
      save() {}

      hello(param1: string, userRepository?: Repository<User>) {}
    }

    expect(getInjectedRepositoriesMap(ServiceA, 'save')).toBe(undefined);
    expect(getInjectedRepositoriesMap(ServiceA, 'hello')).toBe(undefined);
  });

  it('one', () => {
    class ServiceA {
      save(@InjectRepository(User) userRepository?: Repository<User>) {}

      update(param1: string, @InjectRepository(User) someRepository?: Repository<User>) {}
    }

    expect(getInjectedRepositoriesMap(ServiceA, 'save')).toEqual({ 0: User });
    expect(getInjectedRepositoriesMap(ServiceA, 'update')).toEqual({ 1: User });
  });

  it('multiple', () => {
    class ServiceA {
      save(
        @InjectRepository(User) userRepository?: Repository<User>,
        @InjectRepository(Company) companyRepository?: Repository<Company>
      ) {}

      update(param1: string, @InjectRepository(User) userRepository?: Repository<User>) {}
    }

    expect(getInjectedRepositoriesMap(ServiceA, 'save')).toEqual({ 0: User, 1: Company });
    expect(getInjectedRepositoriesMap(ServiceA, 'update')).toEqual({ 1: User });
  });

  it('inheritance', () => {
    class ServiceA {
      save(@InjectRepository(User) userRepository?: Repository<User>) {}
    }
    class ServiceB extends ServiceA {}
    class ServiceC extends ServiceB {
      hello(@InjectRepository(User) userRepository?: Repository<User>) {}
    }

    class ServiceD extends ServiceC {}

    class ServiceE extends ServiceB {}

    expect(getInjectedRepositoriesMap(ServiceA, 'save')).toEqual({ 0: User });
    expect(getInjectedRepositoriesMap(ServiceB, 'save')).toEqual({ 0: User });
    expect(getInjectedRepositoriesMap(ServiceC, 'save')).toEqual({ 0: User });
    expect(getInjectedRepositoriesMap(ServiceC, 'hello')).toEqual({ 0: User });
    expect(getInjectedRepositoriesMap(ServiceD, 'save')).toEqual({ 0: User });
    expect(getInjectedRepositoriesMap(ServiceC, 'hello')).toEqual({ 0: User });
    expect(getInjectedRepositoriesMap(ServiceE, 'save')).toEqual({ 0: User });
  });

  it('inheritance - overridden', () => {
    class ServiceA {
      save(@InjectRepository(User) userRepository?: Repository<User>) {}
    }
    class ServiceB extends ServiceA {
      override save(userRepository?: Repository<User>) {}
    }

    class ServiceC extends ServiceA {
      override save(@InjectRepository(User) userRepository?: Repository<User>) {}
    }

    expect(getInjectedRepositoriesMap(ServiceA, 'save')).toEqual({ 0: User });
    expect(getInjectedRepositoriesMap(ServiceB, 'save')).toBe(undefined);
    expect(getInjectedRepositoriesMap(ServiceC, 'save')).toEqual({ 0: User });
  });

  it('prevent duplicated injection', () => {
    expect(() => {
      class ServiceA {
        save(
          @InjectRepository(User) userRepository?: Repository<User>,
          @InjectRepository(User) anotherUserRepository?: Repository<User>
        ) {}
      }
    }).toThrow("@InjectRepository(User) can only appears once in 'ServiceA.save'");
  });
});
