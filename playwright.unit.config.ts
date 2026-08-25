import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: [
    "phase1-guardrails.spec.ts",
    "phase2-auth-contract.spec.ts",
    "bootstrap-demo-auth.spec.ts",
    "e2e-auth-helper.spec.ts",
  ],
  fullyParallel: false,
  workers: 1,
  reporter: "line",
});
