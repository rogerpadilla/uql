import { describe, expect, it } from 'vitest';
import {
  jsonAssignCall,
  jsonCompareMode,
  jsonElemExists,
  jsonPath,
  jsonRemoveCall,
  jsonSetTarget,
  jsonTypeMode,
} from './jsonSql.js';

describe('jsonCompareMode', () => {
  /** `every` holds over nothing, so an empty set would otherwise read as all-boolean and compare as JSON. */
  it('compares an empty set as text', () => {
    expect(jsonCompareMode([])).toBe('text');
  });
});

describe('jsonTypeMode', () => {
  it('reads a boolean path as JSON and anything else unnumeric as text', () => {
    expect(jsonTypeMode(Boolean)).toBe('json');
    expect(jsonTypeMode(String)).toBe('text');
  });
});

describe('jsonPath', () => {
  it('should build a dotted path literal', () => {
    expect(jsonPath('settings.theme')).toBe("'$.settings.theme'");
  });

  it('should escape a quote in a key so it cannot break out of the literal', () => {
    expect(jsonPath("it's")).toBe("'$.it''s'");
  });

  it('should append an accessor suffix', () => {
    expect(jsonPath('tags', '[#]')).toBe("'$.tags[#]'");
  });
});

describe('jsonAssignCall', () => {
  it('should bind every value in key order', () => {
    const bound: unknown[] = [];
    const sql = jsonAssignCall(
      (value) => {
        bound.push(value);
        return '?';
      },
      'JSON_SET',
      '`kind`',
      { public: 1, private: 2 },
      Infinity,
    );

    expect(sql).toBe("JSON_SET(`kind`, '$.public', ?, '$.private', ?)");
    expect(bound).toEqual([1, 2]);
  });

  it('should append the path suffix to every key', () => {
    const sql = jsonAssignCall(() => '?', 'JSON_INSERT', '`kind`', { tags: 'a' }, Infinity, '[#]');

    expect(sql).toBe("JSON_INSERT(`kind`, '$.tags[#]', ?)");
  });

  /** Past the cap each call assigns what fits onto the one inside it, a key and its value in the same call. */
  it('should spread the pairs over nested calls past the argument cap', () => {
    const bound: unknown[] = [];
    const sql = jsonAssignCall(
      (value) => {
        bound.push(value);
        return '?';
      },
      'JSON_SET',
      '`kind`',
      { a: 1, b: 2, c: 3 },
      5,
    );

    expect(sql).toBe("JSON_SET(JSON_SET(`kind`, '$.a', ?, '$.b', ?), '$.c', ?)");
    expect(bound).toEqual([1, 2, 3]);
  });
});

describe('jsonSetTarget', () => {
  /** `JSON_SET(NULL, ...)` yields NULL, so a nullable column needs an empty document to build on. */
  it('should coalesce a nullable column to the empty document', () => {
    expect(jsonSetTarget('`kind`', { nullable: true }, "'{}'")).toBe("COALESCE(`kind`, '{}')");
  });

  it('should coalesce a column whose nullability is unknown', () => {
    expect(jsonSetTarget('`kind`', undefined, "'{}'")).toBe("COALESCE(`kind`, '{}')");
  });

  it('should use a NOT NULL column directly', () => {
    expect(jsonSetTarget('`kind`', { nullable: false }, "'{}'")).toBe('`kind`');
  });
});

describe('jsonRemoveCall', () => {
  it('should remove every key in a single call', () => {
    expect(jsonRemoveCall('JSON_REMOVE', '`kind`', ['public', 'tags'], Infinity)).toBe(
      "JSON_REMOVE(`kind`, '$.public', '$.tags')",
    );
  });

  it('should spread the paths over nested calls past the argument cap', () => {
    expect(jsonRemoveCall('JSON_REMOVE', '`kind`', ['a', 'b', 'c'], 3)).toBe(
      "JSON_REMOVE(JSON_REMOVE(`kind`, '$.a', '$.b'), '$.c')",
    );
  });
});

describe('jsonElemExists', () => {
  it('should AND the element conditions', () => {
    expect(jsonElemExists('JSON_EACH(`kind`) AS _uql_elem', ['a = 1', 'b = 2'])).toBe(
      'EXISTS (SELECT 1 FROM JSON_EACH(`kind`) AS _uql_elem WHERE a = 1 AND b = 2)',
    );
  });

  /** With no conditions the question is only whether the array has any element at all. */
  it('should omit WHERE when there is no condition', () => {
    expect(jsonElemExists('JSON_EACH(`kind`) AS _uql_elem', [])).toBe(
      'EXISTS (SELECT 1 FROM JSON_EACH(`kind`) AS _uql_elem)',
    );
  });
});
