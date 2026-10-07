/** `npm run notify:test`: send one test message to every channel in notify.json. */
import path from "node:path";
import { channelNames, deliver, readNotifyConfig, testDigest } from "../src/lib/notify";
import { secretsDir } from "../src/lib/secrets";

async function main() {
  const file = path.join(secretsDir(), "notify.json");
  const { config, error } = readNotifyConfig();
  if (error) throw new Error(`${file}: ${error}`);
  const channels = channelNames(config);
  if (channels.length === 0) throw new Error(`${file} 里没有配置 telegram 或 webhook`);
  const { title, text } = testDigest(config.link);
  const delivery = await deliver(config, title, text);
  for (const c of delivery.sent) console.log(`ok   ${c}`);
  for (const f of delivery.failed) console.log(`FAIL ${f.channel}: ${f.error}`);
  if (delivery.failed.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
