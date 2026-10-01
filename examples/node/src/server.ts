import { createServer } from 'node:http';
import { text } from 'node:stream/consumers';
import { pool } from '../uql.config.ts';
import { Todo } from './entities.ts';

const port = Number(process.env['PORT'] ?? 3102);

createServer(async (request, response) => {
  if (request.url !== '/todos') {
    response.writeHead(404).end();
    return;
  }
  if (request.method === 'POST') {
    const { title }: { title: string } = JSON.parse(await text(request));
    const id = await pool.insertOne(Todo, { title });
    response.writeHead(201, { 'content-type': 'application/json' }).end(JSON.stringify({ id }));
    return;
  }
  const todos = await pool.findMany(Todo, { $sort: { id: 'desc' }, $limit: 50 });
  response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(todos));
}).listen(port, () => console.log(`http://localhost:${port}/todos`));
