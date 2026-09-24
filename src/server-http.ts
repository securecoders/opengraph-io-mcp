import dotenv from "dotenv";
import { createApp } from "@/http/app";

dotenv.config();

const app = createApp();

const PORT = process.env.PORT || 3010;
app.listen(PORT, () => {
  console.log(`MCP server (Streamable HTTP) listening on port ${PORT}`);
});
