export function formatKebabCase(val: string): string {
  let resp = val.charAt(0).toLowerCase();
  for (let i = 1; i < val.length; ++i) {
    resp += val[i] === val[i].toUpperCase() ? '-' + val[i].toLowerCase() : val[i];
  }
  return resp;
}
