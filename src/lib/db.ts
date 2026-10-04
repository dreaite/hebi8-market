import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const DB_PATH = process.env.HEBI8_DB ?? path.join(process.cwd(), "data", "hebi8.db");

/** First-run watchlist: one of each market so every data source gets exercised. */
const SEED_WATCHLIST: [source: string, ticker: string, name: string, benchmark: string | null][] = [
  ["binance", "BTCUSDT", "Bitcoin", null],
  ["binance", "ETHUSDT", "Ethereum", "binance:BTCUSDT"],
  ["yahoo", "SPY", "标普 500 ETF", null],
  ["yahoo", "QQQ", "纳指 100 ETF", "yahoo:SPY"],
  ["yahoo", "NVDA", "英伟达", "yahoo:QQQ"],
  ["yahoo", "0700.HK", "腾讯控股", "yahoo:^HSI"],
  ["yahoo", "600519.SS", "贵州茅台", "tv:SSE:000300"],
  ["tv", "TVC:GOLD", "黄金", null],
  ["tv", "TVC:US10Y", "美债 10 年收益率", null],
  ["tv", "TVC:DXY", "美元指数", null],
];

const SEED_BENCHMARKS: [source: string, ticker: string, name: string][] = [
  ["yahoo", "^HSI", "恒生指数"],
  ["tv", "SSE:000300", "沪深 300"],
];

function migrate(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS symbols (
      key        TEXT PRIMARY KEY,
      source     TEXT NOT NULL,
      ticker     TEXT NOT NULL,
      name       TEXT NOT NULL,
      benchmark  TEXT,
      sort       INTEGER NOT NULL DEFAULT 0,
      watch      INTEGER NOT NULL DEFAULT 1,
      synced_at  INTEGER,
      sync_error TEXT
    );
    CREATE TABLE IF NOT EXISTS bars (
      key TEXT    NOT NULL,
      t   INTEGER NOT NULL,
      o   REAL    NOT NULL,
      h   REAL    NOT NULL,
      l   REAL    NOT NULL,
      c   REAL    NOT NULL,
      v   REAL,
      PRIMARY KEY (key, t)
    ) WITHOUT ROWID;
  `);
}

function seed(db: Database.Database) {
  const { n } = db.prepare("SELECT count(*) AS n FROM symbols").get() as { n: number };
  if (n > 0) return;
  const insert = db.prepare(
    "INSERT INTO symbols (key, source, ticker, name, benchmark, sort, watch) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  db.transaction(() => {
    SEED_WATCHLIST.forEach(([source, ticker, name, benchmark], i) =>
      insert.run(`${source}:${ticker}`, source, ticker, name, benchmark, i, 1),
    );
    for (const [source, ticker, name] of SEED_BENCHMARKS) {
      insert.run(`${source}:${ticker}`, source, ticker, name, null, 0, 0);
    }
  })();
}

function open(): Database.Database {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  migrate(db);
  seed(db);
  return db;
}

const globalForDb = globalThis as unknown as { hebi8Db?: Database.Database };

export function getDb(): Database.Database {
  globalForDb.hebi8Db ??= open();
  return globalForDb.hebi8Db;
}
