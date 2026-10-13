import { describe, expect, it } from 'vitest';
import type { Change, ColumnSchema, SchemaDiff } from '../type/index.js';
import {
  added,
  alterations,
  dropped,
  nonEmpty,
  reverseDiff,
  rollbackDiff,
  sides,
  unfillableRestores,
} from './schemaChange.js';

const [a, b, c, d] = [{ name: 'a' }, { name: 'b' }, { name: 'c' }, { name: 'd' }];

/** An add, a drop and an alter: the three kinds a change can be. */
const changes: Change<{ name: string }>[] = [{ to: a }, { from: b }, { from: c, to: d }];

describe('schema changes', () => {
  it('should read each kind of change apart', () => {
    expect(added(changes)).toEqual([a]);
    expect(dropped(changes)).toEqual([b]);
    expect(alterations(changes)).toEqual([{ from: c, to: d }]);
  });

  /** An alter is its drop and its add wherever the object cannot change in place. */
  it('should read every end on a side, an alter on both', () => {
    expect(sides(changes, 'from')).toEqual([b, c]);
    expect(sides(changes, 'to')).toEqual([a, d]);
    expect(sides(undefined, 'to')).toEqual([]);
  });

  it('should read none from a diff without the kind', () => {
    expect(added(undefined)).toEqual([]);
    expect(dropped(undefined)).toEqual([]);
    expect(alterations(undefined)).toEqual([]);
  });

  it('should leave an empty list off a diff', () => {
    expect(nonEmpty([])).toBeUndefined();
    expect(nonEmpty([a])).toEqual([a]);
  });

  /** A rollback is the diff undone, so undoing it twice is the diff again. */
  it('should reverse a diff by swapping every change, and restore it reversed twice', () => {
    const diff: SchemaDiff = {
      tableName: 'users',
      type: 'alter',
      primaryKey: { to: { columns: ['id'] } },
      columns: [
        {
          to: {
            name: 'age',
            type: 'INTEGER',
            nullable: true,
            isPrimaryKey: false,
            isAutoIncrement: false,
            isUnique: false,
          },
        },
      ],
    };

    expect(reverseDiff(diff)).toEqual({
      tableName: 'users',
      type: 'alter',
      primaryKey: { from: { columns: ['id'] }, to: undefined },
      columns: [{ from: diff.columns?.[0].to, to: undefined }],
      indexes: undefined,
      foreignKeys: undefined,
    });
    expect(added(reverseDiff(reverseDiff(diff)).columns)).toEqual(added(diff.columns));
  });
});

describe('rollbackDiff', () => {
  const required: ColumnSchema = {
    name: 'expiresAt',
    type: 'TEXT',
    nullable: false,
    isPrimaryKey: false,
    isAutoIncrement: false,
    isUnique: false,
  };
  const dropsRequired: SchemaDiff = { tableName: 'Code', type: 'alter', columns: [{ from: required }] };

  it('should put a dropped required column with no default back nullable', () => {
    expect(unfillableRestores(dropsRequired)).toEqual([required]);
    expect(rollbackDiff(dropsRequired).columns).toEqual([{ to: { ...required, nullable: true } }]);
  });

  it('should leave a rebuild, which restores its table verbatim, as reversed', () => {
    const rebuilt: SchemaDiff = {
      ...dropsRequired,
      rebuild: { from: { statements: [], columns: ['id', 'expiresAt'] }, to: { statements: [], columns: ['id'] } },
    };
    expect(unfillableRestores(rebuilt)).toEqual([]);
    expect(rollbackDiff(rebuilt)).toEqual(reverseDiff(rebuilt));
  });
});
