import { prisma } from "@/lib/db";
import { DataAdapter, Candle } from "./types";

export class LocalDbAdapter implements DataAdapter {
  async fetchData(_config: any, symbol: string): Promise<Candle[]> {
    const data = await prisma.marketData.findMany({
      where: { symbol },
      orderBy: { timestamp: "asc" },
    });

    return data.map((item: {
        timestamp: number;
        open: number;
        high: number;
        low: number;
        close: number;
        volume: number | null;
    }) => ({
      time: item.timestamp,
      open: item.open,
      high: item.high,
      low: item.low,
      close: item.close,
      volume: item.volume ?? undefined,
    }));
  }
}
