import Link from "next/link";
import { Badge } from "@/components/Badge";
import { ConfigErrorView } from "@/components/ConfigErrorView";
import { JournalEditor } from "@/components/JournalEditor";
import { allItems } from "@/lib/config";
import { plainFirstLine, renderMarkdown } from "@/lib/markdown";
import { listSymbols, readAllStats } from "@/lib/store";
import { isSynthetic, parseKey } from "@/lib/symbols";
import { ensureVault, JOURNAL_TEMPLATE, journalMtime, listNotes, readConfigSafe, readJournal, vaultDir } from "@/lib/vault";
import { currentWeekId, shiftWeek } from "@/lib/week";

export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  ensureVault();
  const { config, error } = readConfigSafe();
  if (!config) return <ConfigErrorView error={error} vaultPath={vaultDir()} />;

  const week = currentWeekId(config.sync.tz);
  const lastWeek = shiftWeek(week, -1);
  const current = readJournal(week) ?? JOURNAL_TEMPLATE;
  const previous = readJournal(lastWeek);

  const symbols = listSymbols();
  const stats = readAllStats();
  const nameOf = (key: string) => {
    const item = allItems(config).find((s) => s.key === key);
    return item?.name ?? symbols[key]?.name ?? (isSynthetic(key) ? key.slice(1) : parseKey(key).ticker);
  };
  const labels = Object.fromEntries(config.conditions.map((c) => [c.id, c.label]));

  // every condition that flipped between last week's bar and this week's
  const changes = config.groups.map((g) => ({
    name: g.name,
    items: g.symbols.flatMap((s) =>
      Object.entries(stats[s.key]?.conditions ?? {})
        .filter(([, r]) => r.now !== null && r.prev !== null && r.now !== r.prev)
        .map(([id, r]) => ({ key: s.key, name: nameOf(s.key), label: labels[id] ?? id, on: r.now === true })),
    ),
  })).filter((g) => g.items.length > 0);

  const notes = listNotes().map((n) => ({ ...n, name: nameOf(n.key), summary: plainFirstLine(n.body) }));

  return (
    <main className="mx-auto w-full max-w-[1400px] px-5 py-5">
      <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
        <section>
          <JournalEditor key={week} week={week} initial={current} savedAt={journalMtime(week)} />
        </section>
        <section className="flex flex-col gap-5">
          <div className="rounded-lg border border-line bg-card">
            <div className="border-b border-line px-3 py-2 text-xs font-medium">上周 · {lastWeek}</div>
            {previous ? (
              <div className="md p-3 text-xs" dangerouslySetInnerHTML={{ __html: renderMarkdown(previous) }} />
            ) : (
              <p className="p-3 text-xs text-muted">上周没有写。</p>
            )}
          </div>

          <div className="rounded-lg border border-line bg-card">
            <div className="border-b border-line px-3 py-2 text-xs font-medium">本周变化</div>
            {changes.length === 0 ? (
              <p className="p-3 text-xs text-muted">条件没有变化。</p>
            ) : (
              <div className="p-3 text-xs">
                {changes.map((g) => (
                  <div key={g.name} className="mb-2">
                    <div className="mb-1 text-muted">{g.name}</div>
                    <ul className="flex flex-wrap gap-1.5">
                      {g.items.map((it, i) => (
                        <li key={i}>
                          <Link
                            href={`/chart/${encodeURIComponent(it.key)}`}
                            className="flex h-7 items-center gap-1.5 rounded px-1.5 hover:bg-bg/60"
                            title={`${it.name}：${it.label}${it.on ? " 本周新触发" : " 本周失效"}`}
                          >
                            <span>{it.name}</span>
                            <Badge label={it.label} state={it.on ? "fresh" : "off"} />
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-lg border border-line bg-card">
            <div className="border-b border-line px-3 py-2 text-xs font-medium">有笔记的标的</div>
            {notes.length === 0 ? (
              <p className="p-3 text-xs text-muted">还没有笔记，在图表页右侧写。</p>
            ) : (
              <ul className="divide-y divide-line text-xs">
                {notes.map((n) => (
                  <li key={n.key}>
                    <Link href={`/chart/${encodeURIComponent(n.key)}`} className="flex items-baseline gap-3 px-3 py-2 hover:bg-bg/60">
                      <span className="shrink-0">{n.name}</span>
                      <span className="truncate text-muted">{n.summary}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
