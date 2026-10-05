<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# hebi8 market

- Daily bars are the only stored granularity (`bars` table, unix seconds at UTC midnight of the trading day); weekly/monthly are aggregated on read in `src/lib/series.ts`.
- Source adapters live in `src/lib/sources/` and must map timestamps through `tradingDay()` with the exchange timezone.
- Indicators: pure math in `src/indicators/calc.ts`, KLineChart templates in `custom.ts`, UI registration in `catalog.ts`.
- Verify with `npm test`, `npm run typecheck`, `npm run lint`, and `npm run build`.
