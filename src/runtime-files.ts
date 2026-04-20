import { dirname } from 'node:path';
import { mkdir } from 'node:fs/promises';

export async function ensureParentDirectory(filePath: string) {
  const parent = dirname(filePath);
  if (parent === '.' || parent === '') return;

  await mkdir(parent, { recursive: true });
}
