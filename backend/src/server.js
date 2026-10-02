import cors from "cors";
import express from "express";

const app = express();
const port = 3001;

app.use(cors({ origin: "http://localhost:5173" }));
app.use(express.json());

app.get("/api/health", (_request, response) => {
  response.json({ status: "ok", message: "Backend WiFi Heatmapper actif" });
});

app.listen(port, "127.0.0.1", () => {
  console.log(`Backend actif sur http://127.0.0.1:${port}`);
});
