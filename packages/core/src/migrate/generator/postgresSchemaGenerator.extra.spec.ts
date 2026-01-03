import { describe, expect, it } from 'vitest';
import { PostgresSchemaGenerator } from './postgresSchemaGenerator.js';

describe('PostgresSchemaGenerator (extra coverage)', () => {
  const generator = new PostgresSchemaGenerator();

  it('mapColumnType various types', () => {
    expect(generator.mapColumnType('smallint', {})).toBe('SMALLINT');
    expect(generator.mapColumnType('float', {})).toBe('DOUBLE PRECISION');
    expect(generator.mapColumnType('double', {})).toBe('DOUBLE PRECISION');
    expect(generator.mapColumnType('real', {})).toBe('DOUBLE PRECISION');
    expect(generator.mapColumnType('decimal', { precision: 10 })).toBe('NUMERIC(10)');
    expect(generator.mapColumnType('decimal', {})).toBe('NUMERIC');
    expect(generator.mapColumnType('char', {})).toBe('CHAR(1)');
    expect(generator.mapColumnType('uuid', {})).toBe('UUID');
    expect(generator.mapColumnType('date', {})).toBe('DATE');
    expect(generator.mapColumnType('time', {})).toBe('TIME');
    expect(generator.mapColumnType('timestamp', {})).toBe('TIMESTAMP');
    expect(generator.mapColumnType('timestamptz', {})).toBe('TIMESTAMPTZ');
    expect(generator.mapColumnType('json', {})).toBe('JSON');
    expect(generator.mapColumnType('bytea', {})).toBe('BYTEA');
    expect(generator.mapColumnType('vector', { length: 1536 })).toBe('VECTOR(1536)');
    expect(generator.mapColumnType('vector', {})).toBe('VECTOR');
    expect(generator.mapColumnType('serial', {})).toBe('SERIAL');
    expect(generator.mapColumnType('bigserial', {})).toBe('BIGSERIAL');
    expect(generator.mapColumnType('unknown' as any, {})).toBe('TEXT');
  });

  it('generateAlterColumnStatements nullability and default', () => {
    const col = { name: 'c', type: 'TEXT', nullable: true, defaultValue: 'val' };
    const stmts = generator.generateAlterColumnStatements('t', col as any, '');
    expect(stmts).toContain('ALTER TABLE "t" ALTER COLUMN "c" DROP NOT NULL;');
    expect(stmts).toContain('ALTER TABLE "t" ALTER COLUMN "c" SET DEFAULT \'val\';');

    const col2 = { name: 'c', type: 'TEXT', nullable: false, defaultValue: undefined as string };
    const stmts2 = generator.generateAlterColumnStatements('t', col2 as any, '');
    expect(stmts2).toContain('ALTER TABLE "t" ALTER COLUMN "c" SET NOT NULL;');
    expect(stmts2).toContain('ALTER TABLE "t" ALTER COLUMN "c" DROP DEFAULT;');
  });

  it('generateColumnCommentStatement', () => {
    expect(generator.generateColumnCommentStatement('t', 'c', "it's a comment")).toBe(
      'COMMENT ON COLUMN "t"."c" IS \'it\'\'s a comment\';',
    );
  });
});
