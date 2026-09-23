import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

/** The SHA-256 of a file, read as a stream: the same digest `put` reports for bytes in memory. */
export async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}
