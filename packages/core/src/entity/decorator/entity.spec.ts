import { Entity } from './entity';
import { Column } from './column';
import { IdColumn } from './idColumn';

it('no @IdColumn', () => {
  expect(() => {
    @Entity()
    class SomeEntity {
      @Column()
      id: string;
    }
  }).toThrow(`'SomeEntity' must have one field decorated with @IdColumn`);
});

it('one @IdColumn', () => {
  expect(() => {
    class SomeEntity {
      @IdColumn()
      idOne: string;
      @IdColumn()
      idTwo: string;
    }
  }).toThrow(`'SomeEntity' must have a single field decorated with @IdColumn`);
});

it('no columns', () => {
  expect(() => {
    @Entity()
    class SomeEntity {
      id: string;
    }
  }).toThrow(`'SomeEntity' must have columns`);
});
