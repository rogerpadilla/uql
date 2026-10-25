import { sql } from '../../../util/index.js';
import { f } from '../../column.js';
import { defineEntity } from '../definition.js';
import { Author } from './author.js';

export const Book = defineEntity({
  name: 'Book',
  fields: {
    id: f.number().id(),
    title: f.string(),
    stock: f.number().default(0),
    status: f.enum(['draft', 'published']),
    version: f.version(),
    authorId: f.number(),
  },
})
  .computed((book) => ({
    shout: f
      .string()
      .nullable()
      .as(sql`upper(${book.title})`),
  }))
  .relations((rel) => ({ author: () => rel.manyToOne(Author, { references: (book) => book.authorId }) }));
