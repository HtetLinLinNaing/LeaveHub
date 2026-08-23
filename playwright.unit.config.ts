import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "phase1-guardrails.spec.ts",
  fullyParallel: false,
  workers: 1,
  reporter: "line",
});
