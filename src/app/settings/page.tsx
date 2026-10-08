import { ConfigErrorView } from "@/components/ConfigErrorView";
import { TvExport, TvDrawingsImport, TvListImport } from "@/components/TvImport";
import { listSymbols } from "@/lib/store";
import { exportTvList } from "@/lib/tv-import";
import { readConfigSafe } from "@/lib/vault";
import { getViewer } from "@/lib/viewer";

export const dynamic = "force-dynamic";

const card = "rounded-lg border border-line bg-card";
const head = "border-b border-line px-4 py-2.5";

/** Settings that need a page (design §5.5): for now, TradingView in and out. */
export default async function SettingsPage() {
  const viewer = await getViewer();
  const { config, error } = readConfigSafe(viewer.dir);
  if (!config) return <ConfigErrorView error={error} vaultPath={viewer.dir} />;

  const symbols = listSymbols();
  const exported = exportTvList(config.groups.map((g) => ({ name: g.name, items: g.symbols.map((s) => ({ key: s.key, exchange: symbols[s.key]?.exchange })) })));
  const watched = config.groups.map((g) => ({ name: g.name, keys: g.symbols.map((s) => s.key) }));

  return (
    <main className="mx-auto flex w-full max-w-[960px] flex-col gap-5 px-5 py-5">
      <h1 className="text-sm font-medium">设置</h1>
      {!viewer.canWrite && <p className="text-xs text-muted">登录后才能导入到自己的列表；下面可以导出示例列表。</p>}

      <section className={card}>
        <div className={head}>
          <h2 className="text-xs font-medium">从 TradingView 导入自选列表</h2>
          <p className="mt-1 text-[11px] text-muted">在 TradingView 自选列表的菜单里选「导出列表…」，把得到的 .txt 传上来或者把内容贴进来。分节变成分组，新标的用 tv: 数据源。</p>
        </div>
        <TvListImport watched={watched} canWrite={viewer.canWrite} />
      </section>

      <section className={card}>
        <div className={head}>
          <h2 className="text-xs font-medium">导出自选列表到 TradingView</h2>
          <p className="mt-1 text-[11px] text-muted">下载的 .txt 在 TradingView 自选列表菜单的「导入列表…」里打开；每个分组是一节。</p>
        </div>
        <TvExport text={exported.text} count={exported.count} skipped={exported.skipped} />
      </section>

      <section className={card}>
        <div className={head}>
          <h2 className="text-xs font-medium">从 TradingView 导入画线</h2>
          <p className="mt-1 text-[11px] text-muted">按标的追加到各自图表，原有的画线和对比不动；同一条画线导入两次也只有一份。</p>
        </div>
        <TvDrawingsImport groups={config.groups.map((g) => g.name)} canWrite={viewer.canWrite} />
      </section>
    </main>
  );
}
