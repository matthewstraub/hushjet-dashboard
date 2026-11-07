import { drizzle } from "drizzle-orm/mysql2";

function connect(url: string) {
  // UTC both ways, so readings written from Render, GitHub Actions and a
  // laptop in another timezone line up.
  return drizzle({ connection: { uri: url, timezone: "Z" } });
}

let _db: ReturnType<typeof connect> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = connect(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

/** Close the pool, so a one-shot script like `pnpm sync` can exit. */
export async function closeDb(): Promise<void> {
  const db = _db;
  _db = null;
  if (!db) return;
  await new Promise<void>(resolve => db.$client.end(() => resolve()));
}
