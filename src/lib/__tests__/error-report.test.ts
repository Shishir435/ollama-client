import type { DiagnosticsGetBundleResult } from "@ollama-client/contracts/diagnostics-rpc"
import { describe, expect, it } from "vitest"
import {
  buildChatMessageErrorReportUrl,
  buildDiagnosticIssueUrl,
  buildGenericIssueReportUrl
} from "@/lib/error-report"

const bodyOf = (url: string) => new URL(url).searchParams.get("body") ?? ""

describe("issue report drafts", () => {
  it("gives the reporter an empty JSON block to paste copied diagnostics into", () => {
    const body = bodyOf(
      buildChatMessageErrorReportUrl({
        role: "assistant",
        content: "Ollama is disabled.",
        error: {
          code: "OLC-PROVIDER-DISABLED",
          providerName: "Ollama",
          incidentId: "INC-69395E52"
        }
      })
    )

    expect(body).toContain("**Diagnostic logs**")
    expect(body).toContain("Copy diagnostics")
    // An empty fence, so pasting lands inside a code block instead of after it.
    expect(body).toContain("```json\n\n```")
  })

  it("never emits a URL long enough for GitHub to reject, and keeps the paste block", () => {
    const oversized = {
      format: "ollama-client-support-v1",
      createdAt: 1,
      appVersion: "0.12.4",
      browserFamily: "Brave",
      osFamily: "macOS",
      capabilities: {},
      permissions: {},
      providers: Array.from({ length: 12 }, (_, index) => ({
        profile: `provider-${index}-${"p".repeat(120)}`,
        wire: "openai",
        enabled: true
      })),
      storage: { backend: "sqlite", messageCount: 1, vectorCount: 0 },
      selfTests: Array.from({ length: 20 }, (_, index) => ({
        id: `test-${index}-${"t".repeat(200)}`,
        status: "fail",
        durationMs: 1,
        code: "X".repeat(200)
      })),
      events: []
    } as never

    const url = buildChatMessageErrorReportUrl(
      {
        role: "assistant",
        content: "x".repeat(4000),
        error: {
          code: "OLC-PROVIDER-HTTP",
          status: 500,
          userMessage: "y".repeat(4000),
          // A base URL is user-supplied and can be up to 4096 chars.
          baseUrl: `http://localhost:11434/${"deep/".repeat(700)}`
        }
      },
      oversized
    )
    const body = bodyOf(url)

    // Per-field clamps keep this under the cap without needing the trim tiers;
    // the assertion is the invariant, not which tier produced it.
    expect(url.length).toBeLessThanOrEqual(7500)
    expect(body).toContain("```json\n\n```")
    expect(body).toContain("**Privacy**")
    // Individually clamped, so one runaway field cannot eat the whole budget.
    expect(body).not.toContain("y".repeat(1000))
    expect(body).not.toContain("deep/".repeat(100))
  })

  it("keeps the whole draft when it already fits", () => {
    const body = bodyOf(
      buildChatMessageErrorReportUrl({
        role: "assistant",
        content: "Ollama is disabled.",
        error: { code: "OLC-PROVIDER-DISABLED", status: 409 }
      })
    )

    expect(body).toContain("- Error code: OLC-PROVIDER-DISABLED")
    expect(body).not.toContain("left out to fit the issue-URL length limit")
  })

  it("includes the paste block in the generic help draft too", () => {
    const body = bodyOf(
      buildGenericIssueReportUrl({ providerId: "ollama", model: "gemma4:e2b" })
    )

    expect(body).toContain("**Diagnostic logs**")
    expect(body).toContain("```json\n\n```")
  })

  it("labels a duration measured on the failure path", () => {
    const body = bodyOf(
      buildChatMessageErrorReportUrl(
        {
          role: "assistant",
          content: "Ollama did not respond.",
          error: { code: "OLC-PROVIDER-UNREACHABLE" }
        },
        undefined,
        { providerReachable: false, latencyMs: 3040 }
      )
    )

    // A latency figure beside "reachable: no" otherwise reads as a contradiction.
    expect(body).toContain("- Provider reachable: no")
    expect(body).toContain(
      "- Provider discovery latency: 3040 ms (time to failure)"
    )
  })

  it("leaves a successful probe's latency unqualified", () => {
    const body = bodyOf(
      buildChatMessageErrorReportUrl(
        {
          role: "assistant",
          content: "Model refused the request.",
          error: { code: "OLC-PROVIDER-HTTP", status: 500 }
        },
        undefined,
        { providerReachable: true, latencyMs: 42 }
      )
    )

    expect(body).toContain("- Provider discovery latency: 42 ms")
    expect(body).not.toContain("time to failure")
  })
})

describe("buildDiagnosticIssueUrl", () => {
  const bundle: DiagnosticsGetBundleResult["bundle"] = {
    format: "ollama-client-support-v1",
    createdAt: 1,
    appVersion: "1.2.3",
    browserFamily: "chromium",
    osFamily: "linux",
    capabilities: {},
    permissions: {},
    providers: [{ profile: "openrouter", wire: "openai", enabled: true }],
    storage: { backend: "opfs", messageCount: 20, vectorCount: 4 },
    events: [
      {
        id: crypto.randomUUID(),
        at: 1,
        level: "error",
        code: "RPC_FAILED",
        operation: "providers.listModels",
        surface: "background",
        supportCode: "OLC-RPC-PROVIDER-FAILED-12345678"
      }
    ],
    selfTests: [
      {
        id: "provider_discovery",
        status: "fail",
        durationMs: 10,
        code: "OLC-PROVIDER-DISCOVERY-001"
      }
    ]
  }

  it("prefills only the safe summary, not event or provider details", () => {
    const body = bodyOf(buildDiagnosticIssueUrl(bundle))

    expect(body).toContain("OLC-PROVIDER-DISCOVERY-001")
    expect(body).toContain("up to seven days")
    expect(body).toContain("Nothing is uploaded automatically")
    expect(body).not.toContain("openrouter")
    expect(body).not.toContain("messageCount")
    expect(body).not.toContain("OLC-RPC-PROVIDER-FAILED-12345678")
  })

  it("carries the same paste block and privacy statement as a chat draft", () => {
    const body = bodyOf(buildDiagnosticIssueUrl(bundle))

    // This draft had its own hand-rolled body with none of the three.
    expect(body).toContain("**Diagnostic logs**")
    expect(body).toContain("```json\n\n```")
    expect(body).toContain("**Privacy**")
  })

  it("says nothing about migration when the profile never had a legacy blob", () => {
    const body = bodyOf(buildDiagnosticIssueUrl(bundle))

    expect(body).not.toContain("Chat migration")
  })

  it("reports a failed migration in the detail a maintainer needs", () => {
    const body = bodyOf(
      buildDiagnosticIssueUrl({
        ...bundle,
        storage: {
          ...bundle.storage,
          backend: "legacy",
          migration: {
            outcome: "verification-failed",
            attempts: 3,
            recordedAt: 1,
            extensionVersion: "0.12.6",
            sourceSchemaVersion: 11,
            importedIntegrity: "ok",
            foreignKeyViolations: 2,
            mismatches: ["messages short by 5"],
            failure: "Migration verification failed: messages short by 5"
          }
        }
      })
    )

    expect(body).toContain("Chat migration: verification-failed (attempt 3")
    expect(body).toContain("schema v11")
    expect(body).toContain("messages short by 5")
    expect(body).toContain("Migration orphan rows: 2")
    // The shortfall is diagnosable; the row counts it came from are not in the
    // draft a reporter would submit.
    expect(body).not.toContain("39204")
    expect(body).not.toContain("39199")
  })

  it("keeps a clean migration to a single line", () => {
    const body = bodyOf(
      buildDiagnosticIssueUrl({
        ...bundle,
        storage: {
          ...bundle.storage,
          migration: {
            outcome: "migrated",
            attempts: 1,
            recordedAt: 1,
            extensionVersion: "0.12.6",
            sourceSchemaVersion: 11,
            importedIntegrity: "ok",
            foreignKeyViolations: 0
          }
        }
      })
    )

    expect(body).toContain("Chat migration: migrated (attempt 1")
    expect(body).not.toContain("Migration integrity")
    expect(body).not.toContain("Migration orphan rows")
    expect(body).not.toContain("Migration failure")
  })

  it("stays inside the URL limit when every self-test fails", () => {
    const url = buildDiagnosticIssueUrl({
      ...bundle,
      selfTests: Array.from({ length: 40 }, (_, index) => ({
        id: `test-${index}-${"t".repeat(300)}`,
        status: "fail" as const,
        durationMs: 1,
        code: "X".repeat(300)
      }))
    })

    expect(url.length).toBeLessThanOrEqual(7500)
    expect(bodyOf(url)).toContain("**Privacy**")
  })
})
