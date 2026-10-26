import { currentTimestamp } from '../../../util/index.js';
import { f } from '../../column.js';
import { defineEntity } from '../definition.js';
import { Book } from './book.js';

export const Author = defineEntity({
  name: 'Author',
  fields: {
    id: f.number().id(),
    name: f.string(),
    bio: f.string().nullable(),
    createdAt: f.date().default(currentTimestamp),
  },
})
  .hooks({
    beforeInsert: [
      (author) => {
        author.bio ??= 'unwritten';
      },
    ],
  })
  .relations(
    (rel) => ({ books: () => rel.oneToMany(Book, { mappedBy: (book) => book.author }) }),
    (author) => ({
      bookCount: () => author.books.count(),
      topStock: () => author.books.max((book) => book.stock),
    }),
  );
export type Author = InstanceType<typeof Author>;

export const label = (author: Author): string => `${author.name} (${author.books?.length ?? 0})`;
