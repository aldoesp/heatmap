import Fastify from "fastify";
import cors from "@fastify/cors";

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: "http://localhost:5173",
});

app.get("/api/health", async () => {
  return { status: "ok", message: "Backend WiFi Heatmapper actif" };
});

await app.listen({ port: 3001, host: "127.0.0.1" });
