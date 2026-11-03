import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["tests/**/*.test.{ts,tsx}"],
    setupFiles: ["tests/setup.ts"],
    fileParallelism: false,
    env: { DATABASE_URL: "file:./test.sqlite" },
  },
});
