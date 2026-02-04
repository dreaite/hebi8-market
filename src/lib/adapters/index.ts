import { LocalDbAdapter } from "./local-db";
import { ExternalUrlAdapter } from "./external-url";
import { DataAdapter } from "./types";

export * from "./types";
export * from "./local-db";
export * from "./external-url";

export function getAdapter(type: string): DataAdapter {
  switch (type) {
    case "LOCAL_DB":
      return new LocalDbAdapter();
    case "EXTERNAL_URL":
      return new ExternalUrlAdapter();
    default:
      throw new Error(`Unsupported data source type: ${type}`);
  }
}
