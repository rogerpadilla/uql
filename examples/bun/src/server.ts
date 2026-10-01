import { pool } from '../uql.config.ts';
import { Todo } from './entities.ts';

const server = Bun.serve({
  port: Number(process.env['PORT'] ?? 3103),
  routes: {
    '/todos': {
      GET: async () => Response.json(await pool.findMany(Todo, { $sort: { id: 'desc' }, $limit: 50 })),
      POST: async (request) => {
        const { title }: { title: string } = JSON.parse(await request.text());
        return Response.json({ id: await pool.insertOne(Todo, { title }) }, { status: 201 });
      },
    },
  },
});

console.log(`${server.url}todos`);
