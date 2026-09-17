import { describe, expect, it } from 'vitest';
import { splitSqlStatements } from './splitSqlStatements.js';

describe('splitSqlStatements', () => {
  it('should trim and drop empty segments', () => {
    expect(splitSqlStatements('  SELECT 1; SELECT 2  ;')).toEqual(['SELECT 1', 'SELECT 2']);
  });

  it('should return single statement without trailing semicolon', () => {
    expect(splitSqlStatements('ALTER TABLE t ADD c INT')).toEqual(['ALTER TABLE t ADD c INT']);
  });

  it('should handle semicolons inside single-quoted strings', () => {
    expect(splitSqlStatements("INSERT INTO t VALUES ('hello;world'); SELECT 1")).toEqual([
      "INSERT INTO t VALUES ('hello;world')",
      'SELECT 1',
    ]);
  });

  it('should handle escaped single quotes', () => {
    expect(splitSqlStatements("INSERT INTO t VALUES ('it''s a trap; or is it?'); SELECT 2")).toEqual([
      "INSERT INTO t VALUES ('it''s a trap; or is it?')",
      'SELECT 2',
    ]);
  });

  it('should handle semicolons inside double-quoted identifiers', () => {
    expect(splitSqlStatements('SELECT "col;name" FROM t; SELECT 3')).toEqual(['SELECT "col;name" FROM t', 'SELECT 3']);
  });

  it('should handle backticks (MySQL)', () => {
    expect(splitSqlStatements('SELECT `col;name` FROM t; SELECT 4')).toEqual(['SELECT `col;name` FROM t', 'SELECT 4']);
  });

  it('should handle semicolons inside comments', () => {
    const sql = `
      -- first; comment
      SELECT 1;
      /* second;
         block; comment */
      SELECT 2;
    `;
    const result = splitSqlStatements(sql);
    expect(result).toHaveLength(2);
    expect(result[0]).toContain('SELECT 1');
    expect(result[0]).toContain('-- first; comment');
    expect(result[1]).toContain('SELECT 2');
    expect(result[1]).toContain('/* second;\n         block; comment */');
  });

  it('should handle Postgres dollar quoting', () => {
    const sql = `
      CREATE FUNCTION foo() RETURNS void AS $$
      BEGIN
        INSERT INTO t VALUES (';');
      END;
      $$ LANGUAGE plpgsql;
      SELECT 5;
    `;
    const result = splitSqlStatements(sql);
    expect(result).toHaveLength(2);
    expect(result[0]).toContain("INSERT INTO t VALUES (';');");
    expect(result[1]).toBe('SELECT 5');
  });

  it('should handle Postgres tagged dollar quoting', () => {
    const sql = `
      CREATE FUNCTION bar() RETURNS void AS $body$
      BEGIN
        INSERT INTO t VALUES (';');
      END;
      $body$ LANGUAGE plpgsql;
      SELECT 6;
    `;
    const result = splitSqlStatements(sql);
    expect(result).toHaveLength(2);
    expect(result[0]).toContain("INSERT INTO t VALUES (';');");
    expect(result[1]).toBe('SELECT 6');
  });

  it('should handle escaped backslashes', () => {
    // 'string\\' -> The second backslash is escaped by the first, so the closing quote should terminate.
    expect(splitSqlStatements("INSERT INTO t VALUES ('string\\\\'); SELECT 1")).toEqual([
      "INSERT INTO t VALUES ('string\\\\')",
      'SELECT 1',
    ]);
  });

  it('should handle unterminated blocks gracefully', () => {
    expect(splitSqlStatements("SELECT 'unterminated; string")).toEqual(["SELECT 'unterminated; string"]);
    expect(splitSqlStatements('CREATE FUNCTION AS $$ BEGIN ;')).toEqual(['CREATE FUNCTION AS $$ BEGIN ;']);
  });

  it('should handle empty or redundant semicolons', () => {
    expect(splitSqlStatements(';;;')).toEqual([]);
    expect(splitSqlStatements('  ;  SELECT 1;  ;  ')).toEqual(['SELECT 1']);
  });

  it('should handle complex multi-dialect scripts', () => {
    const sql = `
      -- Postgres function with mixed quotes
      CREATE FUNCTION func() AS $$
      BEGIN
        PERFORM "other;function"('arg;1', \`arg;2\`);
      END;
      $$ LANGUAGE plpgsql;

      /* MySQL-style table
         with backticks; */
      CREATE TABLE \`my;table\` (
        id INT PRIMARY KEY -- comment;
      );

      SELECT 1;
    `;
    const result = splitSqlStatements(sql);
    expect(result).toHaveLength(3);
    expect(result[0]).toContain('CREATE FUNCTION func()');
    expect(result[0]).toContain('$$ LANGUAGE plpgsql');
    expect(result[1]).toContain('CREATE TABLE `my;table`');
    expect(result[2]).toBe('SELECT 1');
  });
});
