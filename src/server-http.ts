import dotenv from "dotenv";
import { createApp, resolveBindHost } from "@/http/app";

dotenv.config();

const app = createApp();

const PORT = Number(process.env.PORT) || 3010;
const HOST = resolveBindHost();
app.listen(PORT, HOST, () => {
  console.log(`MCP server (Streamable HTTP) listening on ${HOST}:${PORT}`);
});
