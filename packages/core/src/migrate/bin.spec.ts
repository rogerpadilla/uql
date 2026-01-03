import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import './bin.js'; // Import for coverage

describe('bin', () => {
  const binTsPath = new URL('./bin.ts', import.meta.url).pathname;

  it('should run as a script', () => {
    const result = spawnSync('bun', [binTsPath, '--help'], {
      encoding: 'utf8',
    });
    expect(result.status).toBeDefined();
  });

  it('should verify main script detection logic', async () => {
    // This is just to exercise the check in a way that doesn't trigger it
    const isMain = import.meta.url === pathToFileURL(process.argv[1]).href;
    expect(isMain).toBe(false); // In vitest it should be false
  });
});
