"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { copyText } from "@/lib/copy-text";
import type { HelpInfo } from "@/lib/help-info";
import { IconExternal } from "./chart-icons";
import type { ToastOptions } from "./UiProvider";

/** A device-flow login in progress. Module-level so closing and reopening the drawer resumes it. */
interface PendingLogin {
  flowId: string;
  userCode: string;
  verificationUri: string;
  /** ms */
  expiresAt: number;
  /** seconds between polls */
  interval: number;
}

let pendingLogin: PendingLogin | null = null;

const currentLogin = () => (pendingLogin && pendingLogin.expiresAt > Date.now() ? pendingLogin : null);

/**
 * The web login: a full-page trip to github.com that comes back to `next` (this page by default).
 * Only where the server said this origin has it.
 */
export function startWebLogin(next = `${window.location.pathname}${window.location.search}`): void {
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- a route handler that redirects to github.com, not a page
  window.location.assign(`/api/github/login?next=${encodeURIComponent(next)}`);
}

export const postJson = (url: string, body: unknown, method = "POST") =>
  fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });

/**
 * Who is logged in, or 用 GitHub 登录: the web login where this origin has it, else the device
 * flow, shown here while in progress. Logging in or out changes which vault the pages show on a
 * shared instance, so both refresh the page behind the drawer.
 */
export function AccountBlock({
  info,
  intro,
  aside,
  next,
  autoLogin,
  onStart,
  reload,
  toast,
}: {
  info: HelpInfo;
  intro: ReactNode;
  aside?: string;
  /** Where the web login comes back to, when not just this page */
  next?: () => string;
  /** Opened by 登录: start the device flow right away */
  autoLogin?: boolean;
  onStart?: () => void;
  reload: () => Promise<void>;
  toast: (message: string, opts?: ToastOptions) => void;
}) {
  const router = useRouter();
  const [login, setLogin] = useState<PendingLogin | null>(currentLogin);
  const [starting, setStarting] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const user = info.github.user;

  const startLogin = useCallback(async () => {
    onStart?.();
    if (info.github.webLogin) {
      startWebLogin(next?.());
      return;
    }
    setStarting(true);
    setLoginError(null);
    try {
      const res = await postJson("/api/github/device", {});
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      pendingLogin = {
        flowId: json.flowId,
        userCode: json.user_code,
        verificationUri: json.verification_uri,
        expiresAt: Date.now() + json.expires_in * 1000,
        interval: json.interval,
      };
      setLogin(pendingLogin);
    } catch (err) {
      setLoginError(`登录没能开始：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setStarting(false);
    }
  }, [onStart, info.github.webLogin, next]);

  // 登录 in the header: show the code at once instead of another button to press
  const autoStarted = useRef(false);
  useEffect(() => {
    if (!autoLogin || autoStarted.current || user || currentLogin()) return;
    autoStarted.current = true;
    void startLogin();
  }, [autoLogin, user, startLogin]);

  const endLogin = (error: string | null) => {
    pendingLogin = null;
    setLogin(null);
    setLoginError(error);
  };

  const cancelLogin = () => {
    if (login) void postJson("/api/github/device", { flowId: login.flowId }, "DELETE").catch(() => undefined);
    endLogin(null);
  };

  const logout = async () => {
    await fetch("/api/github/logout", { method: "POST" }).catch(() => undefined);
    router.refresh();
    await reload();
  };

  if (user) {
    return (
      <div className="mb-3 flex items-center gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element -- GitHub avatar, no optimisation wanted */}
        <img src={`${user.avatarUrl}${user.avatarUrl.includes("?") ? "&" : "?"}s=48`} alt="" width={20} height={20} className="rounded-full" />
        <span className="font-medium">{user.login}</span>
        <span className="flex-1" />
        <button type="button" className="btn" onClick={() => void logout()}>
          退出
        </button>
      </div>
    );
  }
  if (login) {
    return (
      <DeviceLogin
        key={login.flowId}
        login={login}
        shared={info.shared}
        toast={toast}
        onCancel={cancelLogin}
        onFailed={endLogin}
        onDone={(who) => {
          endLogin(null);
          toast(`已登录为 ${who}`);
          router.refresh();
          void reload();
        }}
      />
    );
  }
  return (
    <div className="mb-3 flex flex-col gap-2 rounded border border-line px-3 py-2">
      <p className="leading-relaxed">{intro}</p>
      {loginError && <p className="text-down">{loginError}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-primary" disabled={starting} onClick={() => void startLogin()}>
          {starting ? "正在联系 GitHub…" : "用 GitHub 登录"}
        </button>
        {aside && <span className="text-[11px] text-muted">{aside}</span>}
      </div>
    </div>
  );
}

/** 登录中: the user code, a link to github.com/login/device, a countdown; polls our server every `interval` s. */
function DeviceLogin({
  login,
  shared,
  toast,
  onCancel,
  onFailed,
  onDone,
}: {
  login: PendingLogin;
  /** On a shared instance the login is mainly about whose list you see */
  shared: boolean;
  toast: (message: string, opts?: ToastOptions) => void;
  onCancel: () => void;
  onFailed: (message: string) => void;
  onDone: (login: string) => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [status, setStatus] = useState("等你在 GitHub 上输入这个代码并授权…");
  const left = Math.max(0, Math.round((login.expiresAt - now) / 1000));

  const callbacks = useRef({ onFailed, onDone });
  useEffect(() => {
    callbacks.current = { onFailed, onDone };
  });

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    let stopped = false;
    let timer = 0;
    let interval = login.interval;
    const schedule = () => {
      timer = window.setTimeout(() => void poll(), interval * 1000);
    };
    const poll = async () => {
      if (stopped) return;
      if (Date.now() >= login.expiresAt) {
        callbacks.current.onFailed("登录代码已过期，请重新点「用 GitHub 登录」");
        return;
      }
      let res: Response;
      let json: { status?: string; interval?: number; slowDown?: boolean; error?: string; user?: { login: string } };
      try {
        res = await postJson("/api/github/device/poll", { flowId: login.flowId });
        json = await res.json().catch(() => ({}));
      } catch {
        if (!stopped) {
          setStatus("暂时连不上服务器，稍后重试…");
          schedule();
        }
        return;
      }
      if (stopped) return;
      if (!res.ok || json.status === "error") callbacks.current.onFailed(`登录失败：${json.error ?? `HTTP ${res.status}`}`);
      else if (json.status === "done") callbacks.current.onDone(json.user?.login ?? "");
      else if (json.status === "expired") callbacks.current.onFailed("登录代码已过期，请重新点「用 GitHub 登录」");
      else if (json.status === "denied") callbacks.current.onFailed("你在 GitHub 上取消了授权");
      else {
        if (json.slowDown) setStatus("GitHub 要求放慢查询，继续等待授权…");
        if (json.interval) interval = json.interval;
        schedule();
      }
    };
    schedule();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [login]);

  const copy = () => toast(copyText(login.userCode) ? `已复制 ${login.userCode}` : "复制失败，请手动选中代码", { duration: 2500 });
  const label = login.verificationUri.replace(/^https:\/\//, "");

  return (
    <div className="mb-3 flex flex-col gap-2 rounded border border-line px-3 py-2.5" aria-live="polite">
      <p className="leading-relaxed">
        {shared
          ? "在 GitHub 上输入下面的代码登录。登录后用你自己的列表、画线、笔记和通知，反馈也会以你的名义提交："
          : "在 GitHub 上输入下面的代码，授权 hebi8/market 以你的名义提交 issue："}
      </p>
      <div className="flex items-center gap-2">
        <code className="rounded bg-fg/5 px-2 py-1 font-mono text-xl tracking-widest select-all" aria-label="登录代码">
          {login.userCode}
        </code>
        <button type="button" className="btn btn-secondary" onClick={copy}>
          复制
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <a href={login.verificationUri} target="_blank" rel="noreferrer" className="btn btn-primary inline-flex items-center gap-1">
          打开 {label}
          <IconExternal size={12} />
        </a>
        <button type="button" className="btn" onClick={onCancel}>
          取消
        </button>
      </div>
      <p className="text-[11px] text-muted">
        {status} · 剩余 {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}
      </p>
    </div>
  );
}
