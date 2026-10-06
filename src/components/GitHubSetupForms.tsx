"use client";

import { useRef, useState, useTransition } from "react";
import { checkInstallation, startManifest } from "@/app/settings/github/actions";

/**
 * The manifest form. The browser itself POSTs it to github.com (that is how the manifest flow
 * works); the server action first sets the state cookie and builds the manifest.
 */
export function CreateAppForm({ defaultCallbacks }: { defaultCallbacks: string[] }) {
  const formRef = useRef<HTMLFormElement>(null);
  const manifestRef = useRef<HTMLInputElement>(null);
  const [callbacks, setCallbacks] = useState(defaultCallbacks.join("\n"));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const go = () =>
    startTransition(async () => {
      setError(null);
      const result = await startManifest(callbacks);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const form = formRef.current!;
      manifestRef.current!.value = result.manifest;
      form.action = result.action;
      form.submit();
    });

  return (
    <form
      ref={formRef}
      method="post"
      onSubmit={(e) => {
        e.preventDefault();
        go();
      }}
      className="flex flex-col gap-2"
      data-testid="manifest-form"
    >
      <input ref={manifestRef} type="hidden" name="manifest" />
      <label className="text-xs text-muted" htmlFor="callback-urls">
        登录回调地址（Callback URL，一行一个，最多 10 个；从这些地址打开本应用才能登录）
      </label>
      <textarea
        id="callback-urls"
        className="input h-28 w-full resize-y py-1.5 font-mono leading-relaxed"
        value={callbacks}
        onChange={(e) => setCallbacks(e.target.value)}
        spellCheck={false}
      />
      {error && <p className="text-xs text-down">{error}</p>}
      <div>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "准备中…" : "在 GitHub 上创建 App"}
        </button>
      </div>
    </form>
  );
}

export function CheckInstallationButton({ label = "我已安装，检查" }: { label?: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <span className="inline-flex flex-col gap-1">
      <button
        type="button"
        className="btn btn-secondary"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await checkInstallation();
            setError(result.ok ? null : (result.error ?? "检查失败"));
          })
        }
      >
        {pending ? "检查中…" : label}
      </button>
      {error && <span className="text-xs text-down">{error}</span>}
    </span>
  );
}
