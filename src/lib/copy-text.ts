"use client";

/** Copy without the async clipboard API, which plain-http origins (the tailnet) do not get. */
export function copyText(text: string): boolean {
  const previous = document.activeElement as HTMLElement | null;
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  // next to the focused control, so it is inside the fullscreen element when there is one
  (previous?.parentElement ?? document.body).appendChild(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  area.remove();
  // focus goes back where it was (the drawer, a menu), so its keys (Esc, ?) keep working
  previous?.focus();
  if (!ok && navigator.clipboard) {
    void navigator.clipboard.writeText(text);
    return true;
  }
  return ok;
}
