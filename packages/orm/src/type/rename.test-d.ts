/**
 * Every place a statement or a definition names a member of an entity. `scripts/type-rename.ts` renames
 * each field, relation and method declared here through the language server and fails on any mention
 * left behind, so a key whose type stops linking back to the entity property is caught. Type-checked
 * like any `.test-d.ts`.
 */
import { BeforeInsert, Computed, Entity, f, Field, keyOf, ManyToOne, OneToMany } from '../entity/index.js';
import { sortOf, sql, refs } from '../util/index.js';
import type { KeyMap, Querier } from './index.js';

@Entity()
class Studio {
  @Field(f.number().id()) id?: number;
  @OneToMany({ entity: () => Movie, mappedBy: (movie) => movie.studio }) movies?: Movie[];
}

@Entity({
  checks: (movie, check) => [check({ rating: { $gte: 0 } }), check(sql`${movie.rating} <= ${10}`)],
  indexes: (movie, index) => [
    index([movie.studioId], { where: { rating: { $gt: 0 } } }),
    index([sql`lower(${movie.title})`], { where: sql`${movie.rating} > 0` }),
    index([movie.title, { column: movie.rating, order: 'desc' }], { include: [movie.studioId] }),
  ],
})
class Movie {
  @Field(f.number().id()) id?: number;
  @Field(f.string().nullable()) title?: string | null;
  @Field(f.number().nullable()) rating?: number | null;
  @Field(
    f
      .number()
      .nullable()
      .references(() => Studio),
  )
  studioId?: number | null;
  @ManyToOne({ entity: () => Studio, references: (movie, target) => [{ local: movie.studioId, foreign: target.id }] })
  studio?: Studio;
  @Field(
    f
      .number()
      .nullable()
      .references(() => Cinema),
  )
  cinemaId?: number | null;
  @ManyToOne({ entity: () => Cinema, references: (movie) => movie.cinemaId }) venue?: Cinema;
  @Computed((movie) =>
    f
      .number()
      .nullable()
      .as(sql`${movie.rating} * 2`),
  )
  score?: number | null;
}

@Entity({
  checks: (cinema, check) => [check(sql`${cinema.city} <> ''`)],
  indexes: (cinema, index) => [
    index([sql`lower(${cinema.city})`], { where: { city: { $ne: '' } } }),
    index([cinema.city], { include: [cinema.id] }),
  ],
})
class Cinema {
  @Field(f.number().id()) id?: number;
  @Field(f.string().nullable()) city?: string | null;
  @Computed((cinema) =>
    f
      .string()
      .nullable()
      .as(sql`upper(${cinema.city})`),
  )
  label?: string | null;
  @OneToMany({ entity: () => Movie, mappedBy: (movie) => movie.cinemaId }) films?: Movie[];
  @Computed((cinema) => cinema.films.count({ $where: { rating: { $gt: 0 } } })) readonly filmCount?: number;
  @Computed((cinema) => cinema.films.max((movie) => movie.rating)) readonly topRating?: number | null;
  @BeforeInsert() touch(): void {}
}

declare const querier: Querier;

export async function find() {
  const movie = refs(Movie);
  const found = await querier.findMany(Movie, {
    $select: { title: true, rating: true, studioId: true },
    $populate: { studio: { $select: { id: true } } },
    $where: {
      rating: { $gte: 7 },
      studio: { id: 1 },
      $text: { $value: 'noir', $fields: { title: true } },
      $and: [sql`${movie.rating} > ${5}`],
    },
    $sort: { rating: -1, studio: { id: 1 } },
  });
  const studios = await querier.findMany(Studio, {
    $populate: { movies: { $select: { title: true }, $where: { rating: 1 }, $sort: { rating: 1 } } },
    $count: { movies: { $where: { rating: { $gt: 8 } } } },
    $where: { movies: { $size: { $gte: 1 } } },
  });
  const excluded = await querier.findMany(Movie, { $select: { rating: false } });
  await querier.findMany(Movie, { $sort: sortOf<Movie>([[keyOf((movie: KeyMap<Movie>) => movie.title), 'asc']]) });
  return [
    found[0].title,
    found[0].rating,
    found[0].studioId,
    found[0].studio,
    studios[0].movies,
    studios[0]._count.movies,
    excluded[0].title,
  ];
}

export async function write() {
  await querier.insertOne(Movie, { title: 'Heat', rating: 8, studioId: 1 });
  await querier.updateMany(Movie, { $where: { studioId: 1 } }, { title: 'Heat', rating: 9 });
  await querier.upsertOne(Movie, { $conflict: { title: true } }, { title: 'Heat', rating: 8 });
}

export async function aggregate() {
  const rows = await querier.aggregate(Movie, {
    $where: { rating: { $gt: 0 } },
    $group: { studioId: true, venueCity: { venue: { city: true } } },
    $select: {
      total: { $sum: { rating: true } },
      best: { $max: { rating: true } },
      titles: { $countDistinct: { title: true } },
      rated: { $count: '*', $where: { rating: { $gt: 5 } } },
    },
    $having: { studioId: { $gt: 0 }, total: { $gt: 10 } },
    $sort: { studioId: 1, total: -1 },
  });
  return [rows[0].studioId, rows[0].best, rows[0].titles];
}
