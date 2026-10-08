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
    name?: string;
    description?: string;
    exchange?: string;
    currency_code?: string;
    timezone?: string;
    type?: string;
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

  interface QuoteMarket {
    onData(callback: (data: Record<string, unknown>) => void): void;
    onLoaded(callback: () => void): void;
    onError(callback: (...args: unknown[]) => void): void;
    close(): void;
  }

  interface QuoteSession {
    Market: new (symbol: string, session?: "regular" | "extended") => QuoteMarket;
    delete(): void;
  }

  interface Client {
    Session: {
      Chart: new () => ChartSession;
      Quote: new (options?: { fields?: "all" | "price"; customFields?: string[] }) => QuoteSession;
    };
    end(): Promise<void>;
    readonly isOpen: boolean;
    onConnected(callback: () => void): void;
  }

  interface SearchMarketResult {
    id: string;
    exchange: string;
    fullExchange: string;
    symbol: string;
    description: string;
    type: string;
  }

  interface UserCredentials {
    id: string;
    session: string;
    signature?: string;
  }

  const TradingView: {
    Client: new (options?: { token?: string; signature?: string }) => Client;
    searchMarketV3(search: string, filter?: string, offset?: number): Promise<SearchMarketResult[]>;
    /** Every drawing of the layout's chart, the stored source with its `state` spread over it */
    getDrawings(layout: string, symbol?: string, credentials?: UserCredentials, chartID?: string): Promise<Record<string, unknown>[]>;
  };
  export default TradingView;
}
