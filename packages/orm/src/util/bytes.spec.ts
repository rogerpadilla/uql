import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { bytesToHex, hexToBytes } from './bytes.js';

describe('bytes', () => {
  const bytes = Uint8Array.from([0, 15, 16, 255]);

  it('should write two lowercase hex digits a byte, and read them back', () => {
    expect(bytesToHex(bytes)).toBe('000f10ff');
    expect(hexToBytes('000f10ff')).toEqual(bytes);
  });

  /** The browser and edge runtimes have no `Buffer`. */
  it('should write the same hex where there is no Buffer', () => {
    vi.stubGlobal('Buffer', undefined);
    onTestFinished(() => {
      vi.unstubAllGlobals();
    });

    expect(bytesToHex(bytes)).toBe('000f10ff');
  });
});
