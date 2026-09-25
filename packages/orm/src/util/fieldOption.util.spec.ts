import { expect, it } from 'vitest';
import { defineEntity, defineField } from '../entity/index.js';
import { fieldOptionConflict } from './fieldOption.util.js';
import { raw } from './raw.js';

// It would otherwise surface wherever the schema is next built, which on SQL Server is a query.
it('should report a column type written out as SQL that interpolates', () => {
  expect(fieldOptionConflict({ type: String, columnType: raw`numeric(${10})` })).toBe(
    "cannot use 'columnType': a `raw` one names a constant type, so it can bind no value and read no column",
  );
  expect(fieldOptionConflict({ type: String, columnType: raw`tsvector` })).toBe(undefined);
});

it('should report a bound stated beside a column type written out as SQL', () => {
  expect(fieldOptionConflict({ type: String, columnType: raw`ltree`, length: 100 })).toBe(
    "cannot use 'length': it is ignored on a column type written out as SQL, which carries its own bounds",
  );
});

it('should take a timestamp’s fractional-second digits as its precision', () => {
  expect(fieldOptionConflict({ type: Date, precision: 3 })).toBeUndefined();
});

it('should report the option a column cannot use', () => {
  expect(fieldOptionConflict({ type: String, autoIncrement: true })).toBe(
    "cannot use 'autoIncrement': it applies to a numeric column, not to a string one",
  );
  expect(fieldOptionConflict({ type: Number, length: 10 })).toBe(
    "cannot use 'length': it applies to a string column, not to a numeric one",
  );
  expect(fieldOptionConflict({ type: String, precision: 3 })).toBe(
    "cannot use 'precision': it applies to a numeric or date column, not to a string one",
  );
  expect(fieldOptionConflict({ type: String, dimensions: 3 })).toBe(
    "cannot use 'dimensions': it applies to a vector column, not to a string one",
  );
  expect(fieldOptionConflict({ type: 'jsonb', length: 10 })).toBe(
    "cannot use 'length': it applies to a string column, not to a json one",
  );
});

it('should report the option another option leaves unread', () => {
  expect(fieldOptionConflict({ type: Number, computed: raw`1`, index: true })).toBe(
    "cannot use 'index': it is ignored on an inlined computed field",
  );
  expect(fieldOptionConflict({ type: Number, updatable: false, onUpdate: () => 1 })).toBe(
    "cannot use 'onUpdate': it is ignored on a field declared 'updatable: false'",
  );
  expect(fieldOptionConflict({ type: String, isId: true, nullable: true })).toBe(
    "cannot use 'nullable': it is ignored on a primary key",
  );
  expect(fieldOptionConflict({ type: Number, version: true, onUpdate: () => 1 })).toBe(
    "cannot use 'onUpdate': it is ignored on a version field",
  );
  expect(fieldOptionConflict({ type: Number, version: true, nullable: true })).toBe(
    "cannot use 'nullable': it is ignored on a version field",
  );
  expect(fieldOptionConflict({ type: String, version: true })).toBe(
    "cannot use 'version': it applies to a numeric column, not to a string one",
  );
});

it('should report the same option whichever order the field was written in', () => {
  const message = "cannot use 'length': it applies to a string column, not to a numeric one";
  expect(fieldOptionConflict({ type: Number, length: 10, autoIncrement: true })).toBe(message);
  expect(fieldOptionConflict({ autoIncrement: true, length: 10, type: Number })).toBe(message);
});

it('should leave a combination that applies alone', () => {
  expect(fieldOptionConflict({ type: 'vector', dimensions: 3, distance: 'cosine' })).toBe(undefined);
  // The column type is what the options are judged against, not the logical one.
  expect(fieldOptionConflict({ type: String, columnType: 'decimal', precision: 30, scale: 2 })).toBe(undefined);
  // A foreign key resolves its column from the referenced key, so there is no family to contradict.
  expect(fieldOptionConflict({ references: () => class {}, length: 36 })).toBe(undefined);
  expect(fieldOptionConflict({ type: Number, computed: raw`1`, eager: false })).toBe(undefined);
  // An option stated as `undefined` is one the field never gave.
  expect(fieldOptionConflict({ type: Number, index: undefined, computed: raw`1` })).toBe(undefined);
  // A key is NOT NULL, so saying so states what it already is - only claiming the opposite is a conflict.
  expect(fieldOptionConflict({ type: Number, isId: true, nullable: false })).toBe(undefined);
});

it('should let a stored computed column keep what a real column has, and refuse what the engine fills', () => {
  const stored = { type: String, computed: raw`a || b`, stored: true } as const;

  expect(fieldOptionConflict({ ...stored, index: true, comment: 'x', nullable: false })).toBeUndefined();
  expect(fieldOptionConflict({ ...stored, defaultValue: 'x' })).toBe(
    "cannot use 'defaultValue': it is ignored on a column the database writes",
  );
  expect(fieldOptionConflict({ ...stored, updatable: false })).toBe(
    "cannot use 'updatable': it is ignored on a column the database writes",
  );
});

it('should backstop at run time what the decorators reject at compile time', () => {
  class Backstopped {
    id?: number;
    computed?: number;
  }

  expect(() => defineField(Backstopped, 'computed', { type: Number, computed: raw`1`, index: true })).toThrow(
    "'Backstopped.computed' cannot use 'index': it is ignored on an inlined computed field.",
  );
  expect(() => defineEntity(Backstopped, { fields: { id: { type: Number, isId: true, nullable: true } } })).toThrow(
    "'Backstopped.id' cannot use 'nullable': it is ignored on a primary key.",
  );
});
