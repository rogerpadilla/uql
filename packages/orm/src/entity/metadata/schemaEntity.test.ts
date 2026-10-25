// One suite over every SQL engine: a schema entity registers through the same metadata as a decorated one, so
// every engine has to write and read it the same, its defaults, computed column, version and hooks included.

import { describe, expect, it } from 'vitest';
import { sqlPools, syncedPool } from '../../test/sqlPools.js';
import { Author, label } from './schemaFixture/author.js';
import { Book } from './schemaFixture/book.js';

describe.each(sqlPools('test_schema'))('a schema entity on %s', (_engine, connect) => {
  const pool = syncedPool(connect, [Author, Book]);

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
});
