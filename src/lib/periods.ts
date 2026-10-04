/** Change periods the overview can show; the user picks which ones. */
export const CHANGE_PERIODS = [
  { key: "1W", label: "1周", days: 7 },
  { key: "1M", label: "1月", days: 30 },
  { key: "3M", label: "3月", days: 91 },
  { key: "YTD", label: "今年", days: null },
  { key: "1Y", label: "1年", days: 365 },
  { key: "3Y", label: "3年", days: 3 * 365 },
  { key: "5Y", label: "5年", days: 5 * 365 },
] as const;

export type ChangePeriod = (typeof CHANGE_PERIODS)[number]["key"];

export const DEFAULT_PERIODS: ChangePeriod[] = ["1W", "1M", "1Y"];
export const MAX_PERIODS = 4;
