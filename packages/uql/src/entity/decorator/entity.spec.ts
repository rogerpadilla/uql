import { Entity } from './entity';
import { Column } from './column';
import { Id } from './id';

it('no @Id', () => {
  expect(() => {
    @Entity()
    class SomeEntity {
      @Column()
      id: string;
    }
  }).toThrow(`'SomeEntity' must have one field decorated with @Id`);
});

it('one @Id', () => {
  expect(() => {
    class SomeEntity {
      @Id()
      idOne: string;
      @Id()
      idTwo: string;
    }
  }).toThrow(`'SomeEntity' must have a single field decorated with @Id`);
});

it('no columns', () => {
  expect(() => {
    @Entity()
    class SomeEntity {
      id: string;
    }
  }).toThrow(`'SomeEntity' must have columns`);
});
