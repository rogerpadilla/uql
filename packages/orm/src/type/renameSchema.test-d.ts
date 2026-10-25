/** Every place a statement names a member of a schema entity, renamed by `bun run ts.rename`. */
import { f } from '../entity/column.js';
import { defineEntity } from '../entity/metadata/definition.js';
import { sql } from '../util/index.js';
import type { Querier } from './index.js';

export const Studio = defineEntity({
  name: 'Studio',
  fields: { id: f.number().id(), cityName: f.string().nullable() },
}).relations(
  (rel) => ({ films: () => rel.oneToMany(Movie, { mappedBy: (movie) => movie.studioRel }) }),
  (agg) => ({ filmTally: () => agg.films.count() }),
);

export const Movie = defineEntity({
  name: 'Movie',
  fields: {
    id: f.number().id(),
    movieTitle: f.string(),
    movieRating: f.number().nullable(),
    studioRef: f.number().nullable(),
  },
})
  .computed((movie) => ({ loudTitle: f.string().as(sql`upper(${movie.movieTitle})`) }))
  .indexes((movie, index) => [index([movie.movieTitle, movie.movieRating])])
  .hooks({ beforeInsert: [(movie) => (movie.movieRating ??= 0)] })
  .relations((rel) => ({ studioRel: () => rel.manyToOne(Studio, { references: (movie) => movie.studioRef }) }))
  .filters({ inBogota: { where: { studioRel: { cityName: 'Bogotá' } }, default: false } });

declare const querier: Querier;

export async function find() {
  const found = await querier.findMany(Movie, {
    $select: { movieTitle: true, movieRating: true, studioRef: true },
    $populate: { studioRel: { $select: { cityName: true } } },
    $where: { movieRating: { $gte: 7 }, studioRel: { cityName: 'Bogotá' } },
    $sort: { movieRating: -1 },
  });
  const studios = await querier.findMany(Studio, {
    $select: { filmTally: true },
    $populate: { films: { $select: { movieTitle: true, loudTitle: true } } },
    $sort: { filmTally: -1 },
  });
  await querier.insertOne(Movie, { movieTitle: 'Heat', movieRating: 8, studioRef: 1 });
  return [
    found[0].movieTitle,
    found[0].studioRel?.cityName,
    studios[0].films[0].movieTitle,
    studios[0].films[0].loudTitle,
    studios[0].filmTally,
  ];
}
