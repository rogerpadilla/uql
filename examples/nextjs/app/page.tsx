import { pool } from '../src/db';
import { Todo } from '../src/entities';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const todos = await pool.findMany(Todo, { $select: { id: true, title: true }, $sort: { id: 'desc' } });
  return (
    <ul>
      {todos.map((todo) => (
        <li key={todo.id}>{todo.title}</li>
      ))}
    </ul>
  );
}
