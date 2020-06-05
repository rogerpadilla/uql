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

  for (let row = lastIdentifierRow; row < input.length - 1; ++row) {
    for (const relation of relations) {
      const currentRow = row + 1;
      const currentColumn = relation.key.column;
      const idCells = identifiers.map((id) => input[currentRow][id.column]);
      const relationCells = Array.from({ length: lastIdentifierRow + 1 }, (arr, index) => {
        // console.log(index, relation);
        const column = relation.value?.row === index ? relation.value.column : currentColumn;
        return input[index][column];
      });
      const valueCell = input[currentRow][currentColumn];
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
