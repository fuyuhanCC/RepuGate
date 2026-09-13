import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

import { buildApp } from "./app";
import { loadLiveErc8004Runtime } from "./config/live-erc8004";

try {
  loadEnvFile(fileURLToPath(new URL("../../../.env", import.meta.url)));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
    throw error;
  }
}

const app = buildApp({
  logger: true,
  liveErc8004: loadLiveErc8004Runtime(process.env),
});
const port = Number.parseInt(process.env.PORT ?? "3001", 10);

if (!Number.isSafeInteger(port) || port <= 0 || port > 65_535) {
  throw new RangeError("PORT must be an integer between 1 and 65535");
}

await app.listen({ host: "127.0.0.1", port });
