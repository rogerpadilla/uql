import { describe, expect, it } from 'vitest';
import { jsonAssignCall, jsonElemExists, jsonPath, jsonRemoveCall, jsonSetTarget } from './jsonSql.js';

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
    );

    expect(sql).toBe("JSON_SET(`kind`, '$.public', ?, '$.private', ?)");
    expect(bound).toEqual([1, 2]);
  });

  it('should append the path suffix to every key', () => {
    const sql = jsonAssignCall(() => '?', 'json_insert', '`kind`', { tags: 'a' }, '[#]');

    expect(sql).toBe("json_insert(`kind`, '$.tags[#]', ?)");
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
    expect(jsonRemoveCall('JSON_REMOVE', '`kind`', ['public', 'tags'])).toBe(
      "JSON_REMOVE(`kind`, '$.public', '$.tags')",
    );
  });
});

describe('jsonElemExists', () => {
  it('should AND the element conditions', () => {
    expect(jsonElemExists('json_each(`kind`) AS _uql_elem_1', ['a = 1', 'b = 2'])).toBe(
      'EXISTS (SELECT 1 FROM json_each(`kind`) AS _uql_elem_1 WHERE a = 1 AND b = 2)',
    );
  });

  /** With no conditions the question is only whether the array has any element at all. */
  it('should omit WHERE when there is no condition', () => {
    expect(jsonElemExists('json_each(`kind`) AS _uql_elem_1', [])).toBe(
      'EXISTS (SELECT 1 FROM json_each(`kind`) AS _uql_elem_1)',
    );
  });
});
