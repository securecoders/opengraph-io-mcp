import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Tests live outside src/: tsconfig's rootDir is "./src" and package.json ships
// `files: ["dist"]`, so tests under src/ would land in dist/ and the .mcpb bundle.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    setupFiles: ["tests/setup.ts"],
  },
});
