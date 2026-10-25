import { describe, expect, it } from 'vitest';
import { readIndexEntry } from './jsonIndexEntry.js';

describe('readIndexEntry', () => {
  it('reads Postgres paths back', () => {
    expect(readIndexEntry("((kind -> 'a'::text) ->> 'name'::text)")).toEqual({ json: 'kind', path: 'a.name' });
    expect(
      readIndexEntry(
        "(\nCASE\n    WHEN jsonb_typeof(kind -> 'score'::text) = 'number'::text THEN (kind ->> 'score'::text)::numeric\n    ELSE NULL::numeric\nEND)",
      ),
    ).toEqual({ json: 'kind', path: 'score', type: Number });
    expect(readIndexEntry(`("camelKind" -> 'flag'::text)`)).toEqual({ json: 'camelKind', path: 'flag', type: Boolean });
  });

  it('reads CockroachDB paths back', () => {
    expect(
      readIndexEntry(
        "(CASE WHEN jsonb_typeof(kind->'score'::text) = 'number'::text THEN (kind->>'score'::text)::numeric END)",
      ),
    ).toEqual({ json: 'kind', path: 'score', type: Number });
  });

  it('reads MySQL paths back', () => {
    expect(
      readIndexEntry(
        "(cast(json_unquote(json_extract(`kind`,'$.a.name')) as char(32) charset utf8mb4) collate utf8mb4_bin)",
      ),
    ).toEqual({ json: 'kind', path: 'a.name', charLength: 32 });
    expect(readIndexEntry("cast(json_unquote(json_extract(`kind`,'$.score')) as double)")).toEqual({
      json: 'kind',
      path: 'score',
      type: Number,
    });
    expect(readIndexEntry("cast(json_extract(`kind`,'$.tags') as char(20) array)")).toEqual({
      json: 'kind',
      path: 'tags',
      type: [String],
      charLength: 20,
    });
    expect(readIndexEntry('cast(`kind` as signed array)')).toEqual({ json: 'kind', type: [Number] });
  });

  it('reads SQLite paths back', () => {
    expect(readIndexEntry("(JSON_EXTRACT(`kind`, '$.a.name'))")).toEqual({ json: 'kind', path: 'a.name' });
    expect(readIndexEntry("(CAST(JSON_EXTRACT(`kind`, '$.score') AS REAL))")).toEqual({
      json: 'kind',
      path: 'score',
      type: Number,
    });
    expect(readIndexEntry("((`kind` -> '$.flag'))")).toEqual({ json: 'kind', path: 'flag', type: Boolean });
  });

  it('keeps any other expression as it is', () => {
    expect(readIndexEntry("lower(kind ->> 'name'::text)")).toEqual({ expression: "lower(kind ->> 'name'::text)" });
    expect(readIndexEntry('lower("email")')).toEqual({ expression: 'lower("email")' });
    expect(readIndexEntry("(kind ->> 'name'::text) || 'x'")).toEqual({ expression: "(kind ->> 'name'::text) || 'x'" });
    expect(readIndexEntry("JSON_EXTRACT(`kind`, '$.a') + JSON_EXTRACT(`other`, '$.b')")).toEqual({
      expression: "JSON_EXTRACT(`kind`, '$.a') + JSON_EXTRACT(`other`, '$.b')",
    });
    expect(readIndexEntry("COALESCE(kind ->> 'a'::text, 'none'::text)")).toEqual({
      expression: "COALESCE(kind ->> 'a'::text, 'none'::text)",
    });
    expect(readIndexEntry('')).toEqual({ expression: '' });
  });

  it('should keep an expression whose read casts to a type uql never writes', () => {
    expect(readIndexEntry("CAST(kind ->> 'a' AS INTEGER)")).toEqual({ expression: "CAST(kind ->> 'a' AS INTEGER)" });
  });

  it('should keep an array read whose element cast uql never writes', () => {
    expect(readIndexEntry("JSON_EXTRACT(`kind`, '$.a') ARRAY")).toEqual({
      expression: "JSON_EXTRACT(`kind`, '$.a') ARRAY",
    });
  });
});
