// Minimal typings for the parts of @mathieuc/tradingview v3 used here (the package ships JS only).
declare module "@mathieuc/tradingview" {
  interface PricePeriod {
    time: number;
    open: number;
    close: number;
    max: number;
    min: number;
    volume: number;
  }

  interface MarketInfos {
    description?: string;
    timezone?: string;
  }

  interface ChartSession {
    readonly periods: PricePeriod[];
    readonly infos: MarketInfos;
    setMarket(
      symbol: string,
      options?: { timeframe?: string; range?: number; adjustment?: "splits" | "dividends" },
    ): void;
    onUpdate(callback: () => void): void;
    onError(callback: (...args: unknown[]) => void): void;
    delete(): void;
  }

  interface Client {
    Session: { Chart: new () => ChartSession };
    end(): Promise<void>;
  }

  const TradingView: { Client: new (options?: { token?: string; signature?: string }) => Client };
  export default TradingView;
}
