// server.js
import app from "./app.js";

app.listen(3001, "127.0.0.1", () => {
  console.log("Backend actif sur http://127.0.0.1:3001");
});