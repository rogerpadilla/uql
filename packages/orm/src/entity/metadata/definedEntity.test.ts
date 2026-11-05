// One suite over every SQL engine: a defined entity registers through the same metadata as a decorated one, so
// every engine has to write and read it the same, its defaults, computed column, version and hooks included.

import { describe, expect, it } from 'vitest';
import { sqlPools, syncedPool } from '../../test/sqlPools.js';
import { Author, label } from './definedFixture/author.js';
import { Book } from './definedFixture/book.js';
import { Folder } from './definedFixture/folder.js';

describe.each(sqlPools('test_defined'))('a defined entity on %s', (_engine, connect) => {
  const pool = syncedPool(connect, [Author, Book, Folder]);

  it('should write and read rows, its defaults, computed column, version, hook and relations', async () => {
    const authorId = await pool().insertOne(Author, { name: 'Ada' });
    await pool().insertOne(Book, { title: 'Notes', status: 'draft', authorId: Number(authorId) });
    const [book] = await pool().findMany(Book, { $populate: { author: { $required: true } } });
    const [author] = await pool().findMany(Author, { $populate: { books: true } });
    const [unpopulated] = await pool().findMany(Author, {});

    expect(book).toMatchObject({ title: 'Notes', stock: 0, shout: 'NOTES', version: 0, author: { name: 'Ada' } });
    expect(label(author)).toBe('Ada (1)');
    expect(label(unpopulated)).toBe('Ada (0)');
    expect(author.bio).toBe('unwritten');
    expect(author.createdAt).toBeInstanceOf(Date);
  });

  /** Read over its to-many as a decorated entity's `computed` aggregate is, so filtered and sorted like a column. */
  it('should read an aggregate over a relation as a column', async () => {
    const [cy] = await pool().insertMany(Author, [{ name: 'Cy' }, { name: 'Di' }]);
    await pool().insertMany(Book, [
      { title: 'One', status: 'draft', stock: 3, authorId: Number(cy) },
      { title: 'Two', status: 'draft', stock: 7, authorId: Number(cy) },
    ]);

    const authors = await pool().findMany(Author, {
      $select: { name: true, bookCount: true, topStock: true },
      $where: { name: { $in: ['Cy', 'Di'] } },
      $sort: { bookCount: 'desc' },
    });

    expect(authors).toEqual([
      { name: 'Cy', bookCount: 2, topStock: 7 },
      { name: 'Di', bookCount: 0, topStock: null },
    ]);
  });

  /** A tree's aggregates read its own to-many. */
  it('should read an aggregate over a self-referencing relation', async () => {
    const root = await pool().insertOne(Folder, { name: 'root', size: 0, parentId: null });
    await pool().insertMany(Folder, [
      { name: 'a', size: 2, parentId: Number(root) },
      { name: 'b', size: 5, parentId: Number(root) },
    ]);

    const folders = await pool().findMany(Folder, {
      $select: { name: true, childCount: true, childSize: true },
      $sort: { name: 'asc' },
    });

    expect(folders).toEqual([
      { name: 'a', childCount: 0, childSize: 0 },
      { name: 'b', childCount: 0, childSize: 0 },
      { name: 'root', childCount: 2, childSize: 7 },
    ]);
  });

  /** A filter declared after the relations reads through them, as a decorated entity's does. */
  it('should apply a filter through a relation', async () => {
    const [ev, fy] = await pool().insertMany(Author, [{ name: 'Ev' }, { name: 'Fy' }]);
    await pool().insertMany(Book, [
      { title: 'Ev 1', status: 'draft', authorId: Number(ev) },
      { title: 'Fy 1', status: 'draft', authorId: Number(fy) },
    ]);

    const books = await pool().findMany(Book, { $select: { title: true } }, { filters: { byEv: true } });

    expect(books).toEqual([{ title: 'Ev 1' }]);
  });
});
