/**
 * Edits of the watchlist's groups as pure functions. The page applies them at once (optimistic) while
 * the matching Server Action writes the yaml; the overview table and the chart's side panel share them.
 */

export interface ListGroup<T extends { key: string }> {
  name: string;
  items: T[];
}

/** Indexes count without the moved entry, like the Server Actions. */
export type WatchlistOp =
  | { type: "moveSymbol"; key: string; group: string; index: number }
  | { type: "removeSymbol"; key: string }
  | { type: "moveGroup"; name: string; index: number }
  | { type: "addGroup"; name: string }
  | { type: "renameGroup"; name: string; next: string }
  | { type: "deleteGroup"; name: string };

/** Which groups are folded is a browser preference, shared by the overview and the chart's panel. */
export const COLLAPSED_KEY = "hebi8:watchlist:collapsed";

const insert = <T>(list: T[], index: number, item: T) => [...list.slice(0, index), item, ...list.slice(index)];

/** The group a deleted group's symbols join: the one above, or below for the first; null when it is the only one. */
export function mergeTarget<T extends { key: string }>(groups: ListGroup<T>[], name: string): string | null {
  const i = groups.findIndex((g) => g.name === name);
  return groups[i - 1]?.name ?? groups[i + 1]?.name ?? null;
}

export function applyOp<T extends { key: string }>(groups: ListGroup<T>[], op: WatchlistOp): ListGroup<T>[] {
  switch (op.type) {
    case "moveSymbol": {
      const item = groups.flatMap((g) => g.items).find((i) => i.key === op.key);
      if (!item) return groups;
      const without = groups.map((g) => ({ ...g, items: g.items.filter((i) => i.key !== op.key) }));
      const target = without.find((g) => g.name === op.group);
      if (!target) return [...without, { name: op.group, items: [item] }];
      return without.map((g) => (g === target ? { ...g, items: insert(g.items, Math.min(op.index, g.items.length), item) } : g));
    }
    case "removeSymbol":
      return groups.map((g) => ({ ...g, items: g.items.filter((i) => i.key !== op.key) }));
    case "moveGroup": {
      const group = groups.find((g) => g.name === op.name);
      if (!group) return groups;
      const rest = groups.filter((g) => g !== group);
      return insert(rest, Math.min(op.index, rest.length), group);
    }
    case "addGroup":
      return groups.some((g) => g.name === op.name) ? groups : [...groups, { name: op.name, items: [] }];
    case "renameGroup":
      return groups.map((g) => (g.name === op.name ? { ...g, name: op.next } : g));
    case "deleteGroup": {
      const i = groups.findIndex((g) => g.name === op.name);
      if (i < 0) return groups;
      const moving = groups[i].items;
      const into = i > 0 ? i - 1 : 1;
      return groups.flatMap((g, j) => (j === i ? [] : j === into ? [{ ...g, items: i > 0 ? [...g.items, ...moving] : [...moving, ...g.items] }] : [g]));
    }
  }
}

/** One step up or down for the keyboard: across the edge of a group into the next one; null at either end. */
export function stepSymbol<T extends { key: string }>(groups: ListGroup<T>[], key: string, step: 1 | -1): { group: string; index: number } | null {
  const gi = groups.findIndex((g) => g.items.some((i) => i.key === key));
  if (gi < 0) return null;
  const items = groups[gi].items;
  const i = items.findIndex((x) => x.key === key);
  if (step < 0) {
    if (i > 0) return { group: groups[gi].name, index: i - 1 };
    const prev = groups[gi - 1];
    return prev ? { group: prev.name, index: prev.items.length } : null;
  }
  if (i < items.length - 1) return { group: groups[gi].name, index: i + 1 };
  const next = groups[gi + 1];
  return next ? { group: next.name, index: 0 } : null;
}

export function stepGroup<T extends { key: string }>(groups: ListGroup<T>[], name: string, step: 1 | -1): number | null {
  const i = groups.findIndex((g) => g.name === name);
  const to = i + step;
  return i < 0 || to < 0 || to >= groups.length ? null : to;
}
