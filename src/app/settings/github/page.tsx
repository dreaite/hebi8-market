import os from "node:os";
import path from "node:path";
import { headers } from "next/headers";
import Link from "next/link";
import type { ReactNode } from "react";
import { CheckInstallationButton, CreateAppForm } from "@/components/GitHubSetupForms";
import { REPO, REPO_FULL_NAME, REPO_URL } from "@/lib/app-info";
import { CALLBACK_PATH, callbackUrlsFor, requestOrigin } from "@/lib/github";
import { readApp, secretsDir } from "@/lib/secrets";

export const dynamic = "force-dynamic";

const tilde = (p: string) => (p.startsWith(os.homedir() + path.sep) ? `~${p.slice(os.homedir().length)}` : p);

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-4 py-1">
      <dt className="w-20 shrink-0 text-muted">{label}</dt>
      <dd className="min-w-0 flex-1 break-words">{children}</dd>
    </div>
  );
}

/** Set up in-app feedback: create the GitHub App from a manifest, install it, then log in from the help panel. */
export default async function GitHubSettings({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { error } = await searchParams;
  const origin = requestOrigin(await headers());
  const app = readApp();
  const setup = !app ? "none" : app.installation_id ? "installed" : "created";
  const appSettingsUrl = app ? `https://github.com/organizations/${REPO.owner}/settings/apps/${app.slug}` : null;
  const ext = "text-accent hover:underline";

  return (
    <main className="mx-auto w-full max-w-[720px] px-5 py-8 text-sm">
      <h1 className="mb-1 text-base font-medium">GitHub 反馈设置</h1>
      <p className="mb-6 text-xs leading-relaxed text-muted">
        应用内反馈（右上角 ? → 反馈）会以你的 GitHub 账号在 {REPO_FULL_NAME} 上开 issue。为此在组织 {REPO.owner} 下建一个只给本应用用的 GitHub App：只有这个仓库的
        Issues 读写和元数据只读权限，没有 webhook。
      </p>

      {typeof error === "string" && <p className="mb-5 rounded border border-down/40 px-3 py-2 text-xs text-down">{error}</p>}

      <dl className="mb-6 text-xs">
        <Row label="仓库">
          <a href={REPO_URL} target="_blank" rel="noreferrer" className={ext}>
            {REPO_FULL_NAME}
          </a>
        </Row>
        <Row label="App">
          {app ? (
            <a href={app.html_url} target="_blank" rel="noreferrer" className={ext}>
              {app.slug}
            </a>
          ) : (
            "未创建"
          )}
        </Row>
        <Row label="安装">{setup === "installed" ? `已安装到 ${REPO_FULL_NAME}` : app ? "未安装" : "—"}</Row>
        {app && (
          <Row label="回调地址">
            <span className="text-muted">创建时登记的：</span>
            {app.callback_urls.length ? (
              <ul className="font-mono">
                {app.callback_urls.map((u) => (
                  <li key={u} className={u === `${origin}${CALLBACK_PATH}` ? "text-fg" : "text-muted"}>
                    {u}
                  </li>
                ))}
              </ul>
            ) : (
              "（未记录）"
            )}
          </Row>
        )}
        <Row label="凭据">
          <code className="font-mono">{tilde(path.join(secretsDir(), "github-app.json"))}</code>
          <span className="text-muted">（权限 600，不在仓库和 vault 里；HEBI8_SECRETS 可改位置）</span>
        </Row>
      </dl>

      {setup === "none" && (
        <section>
          <ol className="mb-4 list-decimal space-y-1 pl-5 text-xs leading-relaxed">
            <li>点下面的按钮，浏览器会带着 App 的配置（manifest）跳到 GitHub 组织 {REPO.owner} 的「Create GitHub App」页面，点 Create GitHub App。</li>
            <li>GitHub 跳回来后本应用保存凭据，再跳到安装页：选 Only select repositories → {REPO.name} → Install。</li>
            <li>回到本应用，自动打开 ? → 反馈，点「用 GitHub 登录」并授权。</li>
          </ol>
          <CreateAppForm defaultCallbacks={callbackUrlsFor(origin)} />
        </section>
      )}

      {setup === "created" && app && (
        <section className="flex flex-wrap items-start gap-2">
          <a href={`https://github.com/apps/${app.slug}/installations/new`} className="btn btn-primary">
            安装到 {REPO_FULL_NAME}
          </a>
          <CheckInstallationButton />
        </section>
      )}

      {setup === "installed" && app && (
        <section className="flex flex-col gap-3 text-xs">
          <p>
            配置完成。在任意页面按 <kbd className="font-mono">?</kbd> 打开反馈；第一次需要用 GitHub 登录。
          </p>
          <div className="flex flex-wrap items-start gap-2">
            <Link href="/?help=feedback" className="btn btn-primary">
              打开反馈
            </Link>
            <CheckInstallationButton label="重新检查安装" />
          </div>
          {appSettingsUrl && (
            <p className="text-muted">
              要增删回调地址或调整权限，去{" "}
              <a href={appSettingsUrl} target="_blank" rel="noreferrer" className={ext}>
                GitHub 上的 App 设置
              </a>
              。
            </p>
          )}
        </section>
      )}
    </main>
  );
}
