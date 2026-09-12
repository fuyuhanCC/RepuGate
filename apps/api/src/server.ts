import { buildApp } from "./app";

const app = buildApp({ logger: true });
const port = Number.parseInt(process.env.PORT ?? "3001", 10);

if (!Number.isSafeInteger(port) || port <= 0 || port > 65_535) {
  throw new RangeError("PORT must be an integer between 1 and 65535");
}

await app.listen({ host: "127.0.0.1", port });
