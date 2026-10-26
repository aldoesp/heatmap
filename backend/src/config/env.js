import "dotenv/config";

const required = ["PORT", "CORS_ORIGIN"];
for (const k of required) {
  if (!process.env[k]) throw new Error(`Variable manquante : ${k}`);
}

export const env = {
  PORT: Number(process.env.PORT),
  CORS_ORIGIN: process.env.CORS_ORIGIN,
  NODE_ENV: process.env.NODE_ENV || "development",
};