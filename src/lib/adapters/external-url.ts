import { DataAdapter, Candle } from "./types";

interface ExternalConfig {
  url: string;
}

export class ExternalUrlAdapter implements DataAdapter {
  async fetchData(config: any, _symbol: string): Promise<Candle[]> {
    const { url } = config as ExternalConfig;
    
    if (!url) {
      throw new Error("Missing URL in config");
    }

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch data from ${url}`);
    }

    const json = await response.json();
    
    // Assume response is array of objects compatible with Candle, 
    // or needs simple mapping. For now assume direct compatibility or standard TV format.
    // If it's standard TV format (time, open, high, low, close), it fits.
    
    if (!Array.isArray(json)) {
      throw new Error("Invalid data format: expected array");
    }

    return json.map((item: any) => ({
      time: item.time || item.timestamp || item.t,
      open: Number(item.open || item.o),
      high: Number(item.high || item.h),
      low: Number(item.low || item.l),
      close: Number(item.close || item.c),
      volume: item.volume || item.v ? Number(item.volume || item.v) : undefined,
    }));
  }
}
