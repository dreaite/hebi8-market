import type { Metadata } from "next";
import Link from "next/link";
import { peekClaim } from "@/lib/claim";
import { getViewer } from "@/lib/viewer";

export const dynamic = "force-dynamic";
// a one-time link for one person: not for search engines, and its address goes to no other site
export const metadata: Metadata = { title: "登录这台设备", robots: { index: false, follow: false }, referrer: "same-origin" };

/**
 * 在其他设备上登录, the other device (design §5.8). Opening the link logs nobody in: link previews
 * and scanner apps fetch it too, and a link someone else sent must not put you in their account
 * unnoticed. The page says whose login it is; only the button's POST uses the code.
 */
export default async function ClaimPage({ searchParams }: { searchParams: Promise<{ c?: string | string[] }> }) {
  const { c } = await searchParams;
  const code = typeof c === "string" ? c : undefined;
  const claim = peekClaim(code);
  if (!claim) {
    return (
      <main className="mx-auto flex w-full max-w-[1400px] flex-col items-start gap-2 px-5 py-10 text-sm">
        <p>这个登录链接无效，或者已经过期。</p>
        <p className="text-muted">链接生成后 2 分钟内有效，只能用一次。回到已登录的设备，在页头头像菜单的「通知设置」里重新点「在其他设备上登录」。</p>
        <Link href="/" className="btn btn-secondary">
          回首页
        </Link>
      </main>
    );
  }
  const viewer = await getViewer();
  return (
    <main className="mx-auto flex w-full max-w-[1400px] flex-col items-start gap-3 px-5 py-10 text-sm">
      <h1 className="flex flex-wrap items-center gap-1.5">
        以
        {claim.avatarUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- GitHub avatar, no optimisation wanted
          <img src={`${claim.avatarUrl}${claim.avatarUrl.includes("?") ? "&" : "?"}s=48`} alt="" width={20} height={20} className="rounded-full" />
        )}
        <span className="font-medium">{claim.login}</span>
        的身份登录这台设备？
      </h1>
      <p className="leading-relaxed text-muted">
        登录后，这台设备上看到和改动的都是 {claim.login} 的自选、笔记和通知。只在这个链接是你自己刚刚生成的时候确认。
      </p>
      {viewer.login && viewer.login !== claim.login && (
        <p className="leading-relaxed text-muted">
          这台设备现在登录的是 {viewer.login}，确认后换成 {claim.login}。
        </p>
      )}
      <form method="post" action="/api/github/claim/redeem" className="flex items-center gap-2">
        <input type="hidden" name="c" value={code} />
        <button type="submit" className="btn btn-primary">
          登录
        </button>
        <Link href="/" className="btn">
          取消
        </Link>
      </form>
    </main>
  );
}
