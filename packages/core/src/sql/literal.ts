export class Literal {
  constructor(readonly value: string) {}
}

export function literal(value: string): Literal {
  return new Literal(value);
}
