// A composite key on every SQL engine: an insert naming only some of its parts is refused by name, and writes none of its batch.

import { describe, expect, it } from 'vitest';
import { defineEntity, f } from '../entity/index.js';
import { sqlPools, syncedPool } from '../test/sqlPools.js';

const Enrolment = defineEntity({
  name: 'CompositeInsertEnrolment',
  fields: { studentId: f.number().id(), courseId: f.string().id(), grade: f.string().nullable() },
});

describe.each(sqlPools('test_composite'))('a composite key on %s', (_name, connect) => {
  const pool = syncedPool(connect, [Enrolment]);

  it('should refuse a row missing its second key part, and write none of the batch', async () => {
    const batch = [
      { studentId: 5, courseId: 'maths' },
      { studentId: 7, grade: 'C' },
    ];
    // @ts-expect-error: a key part is required
    const insert = pool().insertMany(Enrolment, batch);

    await expect(insert).rejects.toThrow(/missing courseId/);
    expect(await pool().count(Enrolment, { $where: { studentId: 5 } })).toBe(0);
  });

  it('should refuse a row missing its first key part, whatever its later ones name', async () => {
    // @ts-expect-error: a key part is required
    await expect(pool().insertMany(Enrolment, [{ courseId: 'art', grade: 'C' }])).rejects.toThrow(/missing studentId/);
    expect(await pool().count(Enrolment, { $where: { courseId: 'art' } })).toBe(0);
  });
});
