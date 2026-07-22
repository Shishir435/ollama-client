import { describe, expect, it } from "vitest"

import type { DiagnosticsGetBundleResult } from "@/protocol/diagnostics-rpc"
import { buildDiagnosticIssueUrl } from "../diagnostics-settings"

describe("buildDiagnosticIssueUrl", () => {
  it("prefills only the safe summary, not event or provider details", () => {
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

    const decoded = decodeURIComponent(buildDiagnosticIssueUrl(bundle))
    expect(decoded).toContain("OLC-PROVIDER-DISCOVERY-001")
    expect(decoded).not.toContain("openrouter")
    expect(decoded).not.toContain("messageCount")
    expect(decoded).not.toContain("OLC-RPC-PROVIDER-FAILED-12345678")
  })
})
