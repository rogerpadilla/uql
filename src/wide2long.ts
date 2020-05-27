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
  const lastIdentifierIdx = identifiers[identifiers.length - 1].row;

  for (let wideRow = lastIdentifierIdx; wideRow < input.length - 1; ++wideRow) {
    for (let wideColumn = 0; wideColumn < relations.length; ++wideColumn) {
      const currentRow = wideRow + 1;
      const currentColumn = wideColumn + identifiers.length;
      const idCells = identifiers.map((id) => input[currentRow][id.column]);
      const relationCells = Array.from({ length: lastIdentifierIdx + 1 }, (arr, idx) => {
        const relationValue = relations[wideColumn]?.value;
        const columnIdx = relationValue && relationValue.row === idx ? relationValue.column : currentColumn;
        return input[idx][columnIdx];
      });
      const valueCell = input[currentRow][currentColumn];
      output.push([...idCells, ...relationCells, valueCell]);
    }
  }

  return output;
}

// A cell in the table
export interface Cell {
  row: number;
  column: number;
}

export type CellContent = string | number;

// A mapping between two cells
export interface Relation {
  key: Cell;
  value?: Cell;
}
