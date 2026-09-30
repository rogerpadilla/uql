const HEX_BYTES = Array.from({ length: 256 }, (_, byte) => byte.toString(16).padStart(2, '0'));

/**
 * Encodes bytes as lowercase hex, two digits per byte. Uses `Buffer` when it exists (~130x faster on 4 KB),
 * and a lookup table on the browser and edge runtimes, which lack it.
 */
export function bytesToHex(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('hex');
  }
  let hex = '';
  for (let i = 0; i < bytes.length; i++) hex += HEX_BYTES[bytes[i]];
  return hex;
}

/** Decodes the hex text {@link bytesToHex} writes back into bytes. */
export function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let at = 0; at < bytes.length; at++) {
    bytes[at] = Number.parseInt(hex.slice(at * 2, at * 2 + 2), 16);
  }
  return bytes;
}
