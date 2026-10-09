/** The words and colors hebi8/market signs with: the site header, metadata, social images and exported charts. */
export const BRAND = "hebi8/market";
export const SLOGAN = "第八天，观测市场";
export const TAGLINE = "hebi（蛇）首尾相衔，七天一个轮回；多出来的第八天，用来观测市场";
export const DESCRIPTION = "七天一个轮回，第八天观测市场。周度复盘：总览、长期图表、对比、笔记。";

/** The dark theme of globals.css, which the social images always use (a crawler has no color scheme). */
export const DARK = { bg: "#0d0d0e", card: "#151517", fg: "#e8e6e1", muted: "#8b877f", line: "#26262a", green: "#2fbf71", red: "#f0545c" };

/** An address as printed under a chart: no scheme, the key readable (`host/chart/yahoo:NVDA`). */
export const bareUrl = (url: string) => decodeURIComponent(url.replace(/^https?:\/\//, ""));
