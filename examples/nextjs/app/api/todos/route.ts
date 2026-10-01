import { NextResponse } from 'next/server';
import { pool } from '../../../src/db';
import { Todo } from '../../../src/entities';

export async function GET() {
  const todos = await pool.findMany(Todo, { $sort: { id: 'desc' }, $limit: 50 });
  return NextResponse.json(todos);
}

export async function POST(request: Request) {
  const { title }: { title: string } = await request.json();
  const id = await pool.insertOne(Todo, { title });
  return NextResponse.json({ id }, { status: 201 });
}
