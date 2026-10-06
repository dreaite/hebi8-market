/** Shown instead of a page when hebi8.yaml does not parse or validate. */
export function ConfigErrorView({ error, vaultPath }: { error: string | null; vaultPath: string }) {
  return (
    <main className="mx-auto w-full max-w-[800px] px-5 py-10">
      <h1 className="mb-2 text-base font-medium text-down">配置有问题</h1>
      <p className="mb-4 font-mono text-sm">{error}</p>
      <p className="text-xs text-muted">
        修改 <code className="text-fg">{vaultPath}/hebi8.yaml</code> 后刷新页面即可，服务不需要重启。
      </p>
    </main>
  );
}
