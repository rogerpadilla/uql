import fs from 'node:fs';
import path from 'node:path';

const lcovPath = path.join(process.cwd(), 'coverage/lcov.info');

if (!fs.existsSync(lcovPath)) {
  console.error('No coverage report found at', lcovPath);
  process.exit(1);
}

const lcov = fs.readFileSync(lcovPath, 'utf8');
const packages = {};

let currentFile = null;
let currentPackage = 'other';
let linesFound = 0;
let linesHit = 0;
let functionsFound = 0;
let functionsHit = 0;

const lines = lcov.split('\n');
for (const line of lines) {
  if (line.startsWith('SF:')) {
    currentFile = line.split(':')[1];
    const match = currentFile.match(/packages\/([^/]+)/);
    currentPackage = match ? match[1] : 'other';
    if (!packages[currentPackage]) {
      packages[currentPackage] = { lf: 0, lh: 0, ff: 0, fh: 0 };
    }
  }
  if (line.startsWith('LF:')) {
    const val = Number.parseInt(line.split(':')[1], 10);
    packages[currentPackage].lf += val;
    linesFound += val;
  }
  if (line.startsWith('LH:')) {
    const val = Number.parseInt(line.split(':')[1], 10);
    packages[currentPackage].lh += val;
    linesHit += val;
  }
  if (line.startsWith('FNF:')) {
    const val = Number.parseInt(line.split(':')[1], 10);
    packages[currentPackage].ff += val;
    functionsFound += val;
  }
  if (line.startsWith('FNH:')) {
    const val = Number.parseInt(line.split(':')[1], 10);
    packages[currentPackage].fh += val;
    functionsHit += val;
  }
}

const formatPct = (hit, total) => {
  if (total === 0) return '100.00%';
  const pct = (hit / total) * 100;
  let color = '\x1b[32m'; // green
  if (pct < 80) color = '\x1b[33m'; // yellow
  if (pct < 50) color = '\x1b[31m'; // red
  return `${color}${pct.toFixed(2).padStart(6)}%\x1b[0m`;
};

console.log('\n\x1b[1m\x1b[34m--- Coverage Summary ---\x1b[0m');
console.log(`\x1b[1m\x1b[36m${'Package'.padEnd(20)} | ${'Lines'.padStart(10)} | ${'Functions'.padStart(10)}\x1b[0m`);
console.log(`${'-'.repeat(20)}-|- ${'-'.repeat(10)}-|- ${'-'.repeat(10)}`);

for (const pkgName of Object.keys(packages).sort()) {
  const pkg = packages[pkgName];
  console.log(
    `${pkgName.padEnd(20)} | ${formatPct(pkg.lh, pkg.lf).padStart(19)} | ${formatPct(pkg.fh, pkg.ff).padStart(19)}`,
  );
}

console.log(`${'-'.repeat(20)}-|- ${'-'.repeat(10)}-|- ${'-'.repeat(10)}`);
console.log(
  `\x1b[1m${'All files'.padEnd(20)}\x1b[0m | ${formatPct(linesHit, linesFound).padStart(19)} | ${formatPct(functionsHit, functionsFound).padStart(19)}`,
);
console.log('');
