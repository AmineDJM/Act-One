import { Database } from '../client.ts';
import { migrate } from '../migrate.ts';

const db = new Database();
try {
  const result = await migrate(db, { log: (m) => console.log(`[migrate] ${m}`) });
  console.log(
    `[migrate] applied ${result.applied.length}, already current ${result.skipped.length}`,
  );
} finally {
  await db.close();
}
