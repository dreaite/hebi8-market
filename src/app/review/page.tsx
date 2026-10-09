import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/Badge";
import { ConfigErrorView } from "@/components/ConfigErrorView";
import { JournalEditor } from "@/components/JournalEditor";
import { LoginButton } from "@/components/UiProvider";
import { alertBadges } from "@/lib/alert-view";
import { allItems } from "@/lib/config";
import { plainFirstLine, renderMarkdown } from "@/lib/markdown";
import { nameOf as displayNameOf } from "@/lib/names";
import { listSymbols } from "@/lib/store";
import { JOURNAL_TEMPLATE, journalMtime, listNotes, readConfigSafe, readJournal } from "@/lib/vault";
import { getViewer } from "@/lib/viewer";
import { currentWeekId, shiftWeek } from "@/lib/week";

export const dynamic = "force-dynamic";
// a person's own page: not for search engines (robots.ts keeps crawlers out as well)
export const metadata: Metadata = { title: "复盘", robots: { index: false, follow: false } };

export default async function ReviewPage() {
  const viewer = await getViewer();
  const { config, error } = readConfigSafe(viewer.dir);
  if (!config) return <ConfigErrorView error={error} vaultPath={viewer.dir} />;
  // the owner's journal and notes are theirs; a visitor is asked to log in
  if (!viewer.canWrite) {
    return (
      <main className="mx-auto flex w-full max-w-[1400px] flex-col items-start gap-2 px-5 py-10 text-sm">
        <p className="text-muted">复盘和笔记是各人自己的，登录后看自己的。</p>
        <LoginButton />
      </main>
    );
  }

  const week = currentWeekId(config.sync.tz);
  const lastWeek = shiftWeek(week, -1);
  const current = readJournal(viewer.dir, week) ?? JOURNAL_TEMPLATE;
  const previous = readJournal(viewer.dir, lastWeek);

  const symbols = listSymbols();
  const nameOf = (key: string) => displayNameOf(config, key, symbols[key]?.name);

  // every alert that fired this week, by group; alerts on symbols that are not watched come last
  const badges = alertBadges(viewer.vault, config);
  const watched = new Set(allItems(config).map((s) => s.key));
  const firedIn = (keys: string[]) => keys.flatMap((key) => (badges[key] ?? []).filter((b) => b.state === "fresh").map((b) => ({ key, name: nameOf(key), badge: b })));
  const changes = [
    ...config.groups.map((g) => ({ name: g.name, items: firedIn(g.symbols.map((s) => s.key)) })),
    { name: "不在自选里", items: firedIn(Object.keys(badges).filter((key) => !watched.has(key))) },
  ].filter((g) => g.items.length > 0);

  const notes = listNotes(viewer.dir).map((n) => ({ ...n, name: nameOf(n.key), summary: plainFirstLine(n.body) }));

  return (
    <main className="mx-auto w-full max-w-[1400px] px-5 py-5">
      <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
        <section>
          <JournalEditor key={`${viewer.vault}:${week}`} vault={viewer.vault} week={week} initial={current} savedAt={journalMtime(viewer.dir, week)} />
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
            <div className="border-b border-line px-3 py-2 text-xs font-medium">本周触发的警报</div>
            {changes.length === 0 ? (
              <p className="p-3 text-xs text-muted">这周没有警报触发。</p>
            ) : (
              <div className="p-3 text-xs">
                {changes.map((g) => (
                  <div key={g.name} className="mb-2">
                    <div className="mb-1 text-muted">{g.name}</div>
                    <ul className="flex flex-wrap gap-1.5">
                      {g.items.map((it) => (
                        <li key={`${it.key}:${it.badge.id}`}>
                          <Link href={`/chart/${encodeURIComponent(it.key)}`} className="flex h-7 items-center gap-1.5 rounded px-1.5 hover:bg-bg/60" title={`${it.name}\n${it.badge.title}`}>
                            <span>{it.name}</span>
                            <Badge label={it.badge.label} state="fresh" />
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
