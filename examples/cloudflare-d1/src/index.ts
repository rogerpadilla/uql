import { D1QuerierPool } from 'uql-orm/d1';
import { Todo } from './entities.ts';

type Env = { DB: D1Database };

export default {
  async fetch(request, env) {
    if (new URL(request.url).pathname !== '/todos') {
      return new Response(null, { status: 404 });
    }
    // The binding exists only inside a request, and the pool is a thin wrapper over it.
    const pool = new D1QuerierPool(env.DB);
    if (request.method === 'POST') {
      const { title }: { title: string } = JSON.parse(await request.text());
      return Response.json({ id: await pool.insertOne(Todo, { title }) }, { status: 201 });
    }
    return Response.json(await pool.findMany(Todo, { $sort: { id: 'desc' }, $limit: 50 }));
  },
} satisfies ExportedHandler<Env>;
