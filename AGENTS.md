<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# hebi8 market

- `vault/` is the user's content (`hebi8.yaml`, notes, journal, chart state; gitignored, `HEBI8_VAULT`); `data/hebi8.db` is a cache that is rebuilt by syncing. Read `docs/design.md` before changing either layout.
- `hebi8.yaml` is edited through `src/lib/vault.ts` with the `yaml` package's `parseDocument` so comments and order survive; writes are atomic. `src/lib/config.ts` is the typed, validated view of it.
- Daily bars are the only stored granularity (`bars` table, unix seconds at UTC midnight of the trading day, split-adjusted prices plus a dividend factor `adj`); weekly/monthly/quarterly are aggregated on read in `src/lib/series.ts`. Synthetic symbols (`=BTC/GOLD`) are computed on read in `src/lib/synth.ts`.
- Source adapters live in `src/lib/sources/` and must map timestamps through `tradingDay()` with the exchange timezone.
- Pages are RSCs that read SQLite/vault directly and must stay `force-dynamic`; reads never touch the network. Syncing happens in `src/lib/sync.ts` (scheduler in `src/lib/scheduler.ts`, started from `src/instrumentation.ts`) and recomputes `stats` afterwards.
- Indicators: pure math in `src/indicators/calc.ts`, KLineChart templates in `custom.ts`, UI registration in `catalog.ts`; the formula engine in `formula.ts` serves chart indicators, overview conditions and comparisons.
- Verify with `npm test`, `npm run typecheck`, `npm run lint`, and `npm run build`.
