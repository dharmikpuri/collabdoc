import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Unit tests for the pure logic in src/lib: no database, network or browser.
 * The end-to-end suites (scripts/verify-flows.mjs, scripts/e2e-ui.mjs) cover
 * the running app; see the "e2e" job in .github/workflows/ci.yml.
 */
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
