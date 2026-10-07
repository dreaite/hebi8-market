export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startScheduler } = await import("./lib/scheduler");
    const { startQuotes } = await import("./lib/quotes");
    const { startUsage } = await import("./lib/usage");
    startScheduler();
    startQuotes();
    startUsage();
  }
}
