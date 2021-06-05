import { normalizeSql } from './sqlSpec.util';

it('select', () => {
  const sql = 'SELECT id, name FROM User WHERE id = 1';
  expect(normalizeSql(sql, '`')).toBe(sql);
  expect(normalizeSql(sql, '"')).toBe(sql);
});

it('select with alias', () => {
  const sql1 = 'SELECT name `theName` FROM User WHERE id = 1';
  expect(normalizeSql(sql1, '`')).toBe(sql1);
  expect(normalizeSql(sql1, '"')).toBe('SELECT name "theName" FROM User WHERE id = 1');

  const sql2 = 'SELECT name "theName" FROM User WHERE id = 1';
  expect(normalizeSql(sql2, '"')).toBe(sql2);
});

it('insert', () => {
  const sql = "INSERT INTO User (name, email, createdAt) VALUES ('Some Name', 'someemail@example.com', 123)";
  expect(normalizeSql(sql, '`')).toBe(sql);
  expect(normalizeSql(sql, '"')).toBe(sql + ' RETURNING id id');
});
