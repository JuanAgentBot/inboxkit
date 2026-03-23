/**
 * Vitest config for unit tests.
 *
 * Uses the default Node.js pool (not Workers). For tests that mock
 * fetch and module dependencies. No API keys or workerd needed.
 */

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.unit.test.ts"],
  },
});
