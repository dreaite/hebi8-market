// src/lib/adapters/types.ts

export interface Candle {
  time: number; // lightweight-charts expects unified time (Unix timestamp)
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface DataAdapter {
  fetchData(config: any, symbol: string): Promise<Candle[]>;
}
