import { defineConfig } from "@playwright/test"

const chromiumProject = (
  name: string,
  testMatch: string,
  extensionBuildPath: string
) => ({
  name,
  testMatch,
  metadata: { extensionBuildPath }
})

export default defineConfig({
  testDir: "./e2e/chromium",
  outputDir: "artifacts/e2e/test-results",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: Boolean(process.env.CI),
  timeout: 60_000,
  expect: {
    timeout: 10_000
  },
  reporter: [
    ["list"],
    ["html", { outputFolder: "artifacts/e2e/html", open: "never" }]
  ],
  // The extension fixture launches its own persistent context so profiles can
  // survive full browser restarts. It therefore owns trace, screenshot, and
  // video capture instead of relying on Playwright's `use` context.
  projects: [
    chromiumProject(
      "chromium-production",
      "**/install-and-boot.spec.ts",
      "build/chrome-mv3-prod"
    ),
    chromiumProject(
      "chromium-persistence",
      "**/persistence.spec.ts",
      "build/chrome-mv3-benchmark"
    ),
    chromiumProject(
      "chromium-provider-streaming",
      "**/provider-streaming.spec.ts",
      "build/chrome-mv3-benchmark"
    )
  ]
})
