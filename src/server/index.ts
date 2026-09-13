import { telemetry } from "./telemetry.js";
const { createApp } = await import("./app.js");
const { app } = await createApp();
await app.listen({ port: Number(process.env.PORT || 3000), host: process.env.HOST || "127.0.0.1" });
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    await app.close();
    await telemetry?.shutdown();
    process.exit(0);
  });
