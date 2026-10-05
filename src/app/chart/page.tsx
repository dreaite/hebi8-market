import { ChartView } from "@/components/ChartView";

export default async function ChartPage({ searchParams }: { searchParams: Promise<{ key?: string | string[] }> }) {
  const { key } = await searchParams;
  const symbolKey = Array.isArray(key) ? key[0] : key;
  if (!symbolKey) {
    return <main className="p-6 text-sm text-muted">缺少 key 参数，例如 /chart?key=yahoo:SPY</main>;
  }
  // Remount per symbol so chart state never leaks between symbols.
  return <ChartView key={symbolKey} symbolKey={symbolKey} />;
}
