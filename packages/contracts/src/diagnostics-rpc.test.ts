import { describe, expect, it } from "vitest"
import {
  DiagnosticEventSchema,
  DiagnosticsGetBundleResultSchema
} from "./diagnostics-rpc"

describe("diagnostics RPC contracts", () => {
  it("accepts sanitized diagnostic events and rejects free-form fields", () => {
    const event = {
      id: "123e4567-e89b-12d3-a456-426614174000",
      at: 1,
      level: "error",
      code: "PROVIDER_TIMEOUT",
      operation: "providers.testConnection",
      surface: "background",
      metadata: { attempt: 2, retryable: true }
    } as const

    expect(DiagnosticEventSchema.parse(event)).toEqual(event)
    expect(
      DiagnosticEventSchema.safeParse({
        ...event,
        rawError: "credential-bearing upstream response"
      }).success
    ).toBe(false)
  })

  it("keeps support bundles strict at the export boundary", () => {
    const result = {
      bundle: {
        format: "ollama-client-support-v1",
        createdAt: 1,
        appVersion: "0.13.0",
        browserFamily: "chromium",
        osFamily: "macos",
        capabilities: { opfs: true },
        permissions: { storage: true },
        providers: [{ profile: "ollama", wire: "ollama", enabled: true }],
        storage: {
          backend: "opfs",
          messageCount: 10,
          vectorCount: 2,
          migration: {
            outcome: "verified",
            attempts: 1,
            recordedAt: 1,
            extensionVersion: "0.13.0",
            mismatches: []
          }
        },
        events: [],
        selfTests: []
      }
    } as const

    expect(DiagnosticsGetBundleResultSchema.parse(result)).toEqual(result)
    expect(
      DiagnosticsGetBundleResultSchema.safeParse({
        bundle: { ...result.bundle, chatContent: "must-not-cross-rpc" }
      }).success
    ).toBe(false)
  })
})
