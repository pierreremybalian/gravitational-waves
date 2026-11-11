// Test helper: read the generated data files (public/data) from disk.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

export function f32(path: string): Float32Array {
  const b = readFileSync(ROOT + 'public/data/' + path);
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
}

export function json<T = unknown>(path: string): T {
  return JSON.parse(readFileSync(ROOT + path, 'utf8')) as T;
}
