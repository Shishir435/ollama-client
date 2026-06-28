import { afterEach, describe, expect, it, vi } from "vitest"
import {
  browser,
  supportsOffscreenDocuments,
  supportsSessions,
  supportsSyncedSessions,
  supportsTabCapture,
  supportsTabGroups
} from "@/lib/browser-api"

const originalChrome = globalThis.chrome

afterEach(() => {
  globalThis.chrome = originalChrome
})

describe("browser capability detection", () => {
  it("offers tab groups on Chromium before permission exposes the namespace", () => {
    globalThis.chrome = {
      declarativeNetRequest: {
        updateDynamicRules: vi.fn()
      }
    } as unknown as typeof chrome

    expect(supportsTabGroups()).toBe(true)
  })

  it("offers sessions on Chromium before permission exposes the namespace", () => {
    globalThis.chrome = {
      declarativeNetRequest: {
        updateDynamicRules: vi.fn()
      }
    } as unknown as typeof chrome

    expect(supportsSessions()).toBe(true)
    expect(supportsSyncedSessions()).toBe(true)
  })

  it("detects concrete sessions and Chromium capture methods", () => {
    const browserRecord = browser as unknown as Record<string, unknown>
    const previousSessions = browserRecord.sessions

    browserRecord.sessions = {
      getRecentlyClosed: vi.fn(),
      getDevices: vi.fn()
    }
    globalThis.chrome = {
      declarativeNetRequest: {
        updateDynamicRules: vi.fn()
      },
      tabCapture: {
        getMediaStreamId: vi.fn()
      },
      offscreen: {
        createDocument: vi.fn()
      }
    } as unknown as typeof chrome

    expect(supportsSessions()).toBe(true)
    expect(supportsSyncedSessions()).toBe(true)
    expect(supportsTabCapture()).toBe(true)
    expect(supportsOffscreenDocuments()).toBe(true)

    browserRecord.sessions = previousSessions
  })
})
