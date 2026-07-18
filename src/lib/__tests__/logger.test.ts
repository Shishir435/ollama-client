import { afterEach, describe, expect, it, vi } from "vitest"
import { REDACTED_LOG_VALUE, redactLogValue } from "@/lib/log-redaction"
import { Logger, LogLevel } from "@/lib/logger"

describe("privacy-safe logger", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("recursively redacts case-varied credentials and private content", () => {
    const input = {
      safe: "kept",
      Api_Key: "api-secret",
      nested: {
        AUTHORIZATION: "Bearer auth-secret",
        refreshToken: "refresh-secret",
        requestBody: { messages: [{ content: "private prompt" }] },
        messages: [{ content: "private message" }],
        pageContent: "private page",
        file_content: "private file",
        replayArtifact: {
          blocks: [
            { type: "thinking", signature: "opaque-signature" },
            { type: "reasoning.encrypted", data: "opaque-reasoning" }
          ]
        }
      },
      customHeaders: {
        "X-Tenant": "tenant-secret",
        "X-Custom-Auth": "custom-secret"
      }
    }

    expect(redactLogValue(input)).toEqual({
      safe: "kept",
      Api_Key: REDACTED_LOG_VALUE,
      nested: {
        AUTHORIZATION: REDACTED_LOG_VALUE,
        refreshToken: REDACTED_LOG_VALUE,
        requestBody: REDACTED_LOG_VALUE,
        messages: REDACTED_LOG_VALUE,
        pageContent: REDACTED_LOG_VALUE,
        file_content: REDACTED_LOG_VALUE,
        replayArtifact: REDACTED_LOG_VALUE
      },
      customHeaders: {
        "X-Tenant": REDACTED_LOG_VALUE,
        "X-Custom-Auth": REDACTED_LOG_VALUE
      }
    })
  })

  it("sanitizes errors, URLs, free-form credentials, and cycles", () => {
    const error = new Error(
      "Request failed with Bearer bearer-secret and sk-1234567890secret"
    )
    const value: Record<string, unknown> = {
      error,
      endpoint: "https://user:pass@example.com/path?api_key=query-secret",
      note: "authorization=inline-secret cookie=cookie-secret"
    }
    value.self = value

    const result = redactLogValue(value) as Record<string, unknown>
    const serialized = JSON.stringify(result)

    expect(serialized).not.toContain("bearer-secret")
    expect(serialized).not.toContain("1234567890secret")
    expect(serialized).not.toContain("user:pass")
    expect(serialized).not.toContain("query-secret")
    expect(serialized).not.toContain("inline-secret")
    expect(serialized).not.toContain("cookie-secret")
    expect((result.error as { name: string }).name).toBe("Error")
    expect(result.self).toBe("[Circular]")
  })

  it("parses serialized structured data before redacting it", () => {
    expect(
      redactLogValue(
        JSON.stringify({
          status: 400,
          apiKey: "serialized-secret",
          messages: [{ content: "serialized prompt" }]
        })
      )
    ).toEqual({
      status: 400,
      apiKey: REDACTED_LOG_VALUE,
      messages: REDACTED_LOG_VALUE
    })
  })

  it("fully redacts quoted secrets containing spaces", () => {
    const result = redactLogValue({
      note: [
        "password='correct horse battery staple'",
        'api_key="quoted api secret"',
        String.raw`client_secret="escaped \"quote\" secret"`,
        "token=unquoted-secret safe=value"
      ].join(" ")
    })
    const serialized = JSON.stringify(result)

    expect(serialized).not.toContain("correct horse battery staple")
    expect(serialized).not.toContain("quoted api secret")
    expect(serialized).not.toContain('escaped \\"quote\\" secret')
    expect(serialized).not.toContain("unquoted-secret")
    expect(serialized).toContain("safe=value")
  })

  it("turns invalid dates into an unreadable marker without throwing", () => {
    expect(() =>
      redactLogValue({ createdAt: new Date(Number.NaN) })
    ).not.toThrow()
    expect(redactLogValue({ createdAt: new Date(Number.NaN) })).toEqual({
      createdAt: "[Unreadable]"
    })
  })

  it("sends only redacted snapshots to the console sink", () => {
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => {})
    const logger = new Logger(LogLevel.DEBUG)
    const data = {
      apiKey: "sink-secret",
      status: 401,
      headers: { Authorization: "Bearer header-secret" }
    }

    logger.info("Failed with token=message-secret", "Provider", data, "session")
    data.apiKey = "mutated-later"

    expect(consoleInfo).toHaveBeenCalledTimes(1)
    const [message, safeData] = consoleInfo.mock.calls[0]
    expect(message).not.toContain("message-secret")
    expect(safeData).toEqual({
      apiKey: REDACTED_LOG_VALUE,
      status: 401,
      headers: { Authorization: REDACTED_LOG_VALUE }
    })
    expect(JSON.stringify(consoleInfo.mock.calls)).not.toContain("sink-secret")
    expect(JSON.stringify(consoleInfo.mock.calls)).not.toContain(
      "header-secret"
    )
    expect(JSON.stringify(consoleInfo.mock.calls)).not.toContain(
      "mutated-later"
    )
  })

  it("does not inspect data below the configured log level", () => {
    const logger = new Logger(LogLevel.ERROR)
    const value = Object.defineProperty({}, "apiKey", {
      enumerable: true,
      get: () => {
        throw new Error("should not be read")
      }
    })

    expect(() => logger.debug("skipped", "Test", value)).not.toThrow()
  })
})
