export function parseWideToLong(
  input: readonly CellContent[][],
  identifiers: readonly Cell[],
  relations: readonly Relation[]
): CellContent[][] {
  const valueCounts = relations.filter((rel) => Boolean(rel.value));
  if (!identifiers.length) {
    throw new Error('The table must have at least one primary column');
  }
  if (valueCounts.length && valueCounts.length !== relations.length) {
    throw new Error('Unsupported relations array, all or none relations should have value');
  }

  const output: CellContent[][] = [];
  const lastIdentifierRow = identifiers[identifiers.length - 1].row;
  const increment = !lastIdentifierRow || relations.some((rel) => rel.value) ? 1 : 0;

  for (let row = lastIdentifierRow + 1; row < input.length; ++row) {
    for (const relation of relations) {
      const currentColumn = relation.key.column;
      const idCells = identifiers.map((id) => input[row][id.column]);
      const relationCells = Array.from({ length: lastIdentifierRow + increment }, (arr, index) => {
        const column = relation.value?.row === index ? relation.value.column : currentColumn;
        return input[index + 1 - increment][column];
      });
      const valueCell = input[row][currentColumn];
      output.push([...idCells, ...relationCells, valueCell]);
    }
  }

  return output;
}

export interface Cell {
  row: number;
  column: number;
}

export type CellContent = string | number;

export interface Relation {
  key: Cell;
  value?: Cell;
}
