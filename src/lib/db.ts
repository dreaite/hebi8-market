import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

/** Schema versions, applied in order; `PRAGMA user_version` records how many ran. */
const MIGRATIONS: ((db: Database.Database) => void)[] = [
  (db) =>
    db.exec(`
      -- The v1 cache mixed user fields into symbols; v2 keeps those in the vault and re-pulls bars.
      DROP TABLE IF EXISTS symbols;
      DROP TABLE IF EXISTS bars;
      CREATE TABLE symbols (
        key        TEXT PRIMARY KEY,
        source     TEXT NOT NULL,
        ticker     TEXT NOT NULL,
        name       TEXT,
        exchange   TEXT,
        currency   TEXT,
        timezone   TEXT,
        kind       TEXT,
        synced_at  INTEGER,
        sync_error TEXT,
        first_t    INTEGER,
        last_t     INTEGER
      );
      CREATE TABLE bars (
        key TEXT    NOT NULL,
        t   INTEGER NOT NULL,
        o   REAL    NOT NULL,
        h   REAL    NOT NULL,
        l   REAL    NOT NULL,
        c   REAL    NOT NULL,
        v   REAL,
        adj REAL    NOT NULL DEFAULT 1,
        PRIMARY KEY (key, t)
      ) WITHOUT ROWID;
      CREATE TABLE stats (
        key         TEXT PRIMARY KEY,
        computed_at INTEGER NOT NULL,
        json        TEXT NOT NULL
      );
    `),
  (db) =>
    db.exec(`
      -- What each notify rule looked like at the last sync; see src/lib/alerts.ts.
      CREATE TABLE alert_state (
        rule      TEXT    NOT NULL,
        key       TEXT    NOT NULL,
        state     INTEGER,
        fired_bar INTEGER,
        fired_at  INTEGER,
        PRIMARY KEY (rule, key)
      ) WITHOUT ROWID;
    `),
];

const dbFile = () => process.env.HEBI8_DB ?? path.join(process.cwd(), "data", "hebi8.db");

/** The cache directory: the database and anything else that a re-sync rebuilds. */
export const dataDir = () => path.dirname(dbFile());

function open(): Database.Database {
  const file = dbFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  const version = db.pragma("user_version", { simple: true }) as number;
  for (let i = version; i < MIGRATIONS.length; i++) {
    db.transaction(() => {
      MIGRATIONS[i](db);
      db.pragma(`user_version = ${i + 1}`);
    })();
  }
  return db;
}

const globalForDb = globalThis as unknown as { hebi8Db?: Database.Database };

export function getDb(): Database.Database {
  globalForDb.hebi8Db ??= open();
  return globalForDb.hebi8Db;
}
