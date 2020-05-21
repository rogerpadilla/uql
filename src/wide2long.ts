export function parseWideToLong(input: readonly any[][], identifiers: Cell[], relations: Relation[]): any[][] {
  const output: any[][] = [];

  const srcN = input.length;
  const srcM = input[0].length;
  const newM = srcN - 1;
  const newN = (srcN - 1) * (srcM - 1);

  let srcI = 1;
  let srcJ = 0;
  let count = 0;

  for (let newI = 0; newI < newN; ++newI) {
    output[newI] = [];
    for (let newJ = 0; newJ < newM; ++newJ) {
      output[newI][newJ] = input[srcI][srcJ];
      if (count % 2 === 0) {
        srcI--;
        srcJ++;
      } else {
        srcI++;
        srcJ--;
      }
      count++;
    }
  }

  //   const input = [
  //     ['State', 1960, 1970, 1980, 1990, 2000],
  //     ['New York', 2, 5, 2, 5, 4],
  //     ['New Jersey', 3, 1, 4, 1, 5],
  //     ['Arizona', 3, 9, 8, 7, 5],
  //   ];

  //   const expected = [
  //     ['New York', 1960, 2],
  //     ['New York', 1970, 5],
  //     ['New York', 1980, 2],
  //     ['New York', 1990, 5],
  //     ['New York', 2000, 4],
  //     ['New Jersey', 1960, 3],
  //     ['New Jersey', 1970, 1],
  //     ['New Jersey', 1980, 4],
  //     ['New Jersey', 1990, 1],
  //     ['New Jersey', 2000, 5],
  //     ['Arizona', 1960, 3],
  //     ['Arizona', 1960, 9],
  //     ['Arizona', 1960, 8],
  //     ['Arizona', 1960, 7],
  //     ['Arizona', 1960, 5],
  //   ];

  return output;
}

// A cell in the table
export interface Cell {
  row: number;
  column: number;
}

// A mapping between two cells
export interface Relation {
  key: Cell;
  value?: Cell;
}
