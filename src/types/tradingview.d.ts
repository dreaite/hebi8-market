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

  export interface MarketInfos {
    name?: string;
    description?: string;
    exchange?: string;
    currency_code?: string;
    timezone?: string;
    type?: string;
    /** The regular session on the exchange's clock: `0930-1600`, `1700-1600`, `24x7` */
    session?: string;
    /** Days without trading, `20261126,20261225`, past years included */
    session_holidays?: string;
    /** Which of `subsessions` `session` is: `regular` */
    subsession_id?: string;
    /** `session-correction`: days with other hours, `0930-1300:20261127,20261224;dayoff:20250109` */
    subsessions?: { id: string; session?: string; "session-correction"?: string }[];
  }

  interface ChartSession {
    readonly periods: PricePeriod[];
    readonly infos: MarketInfos;
    setMarket(
      symbol: string,
      options?: { timeframe?: string; range?: number; adjustment?: "splits" | "dividends" },
    ): void;
    onUpdate(callback: () => void): void;
    /** The symbol info (`infos`) arrived, before any bars */
    onSymbolLoaded(callback: () => void): void;
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

  interface UserCredentials {
    id: string;
    session: string;
    signature?: string;
  }

  const TradingView: {
    Client: new (options?: { token?: string; signature?: string }) => Client;
    /** The token charts-storage requests carry for a layout (`/chart-token`) */
    getChartToken(layout: string, credentials?: UserCredentials): Promise<string>;
  };
  export default TradingView;
}
