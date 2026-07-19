import type { TFunction } from "i18next"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { ChatMessage, ChatSession } from "@/types"

vi.mock("../utils", () => ({
  downloadFile: vi.fn()
}))

import { jsonExporter } from "../json-exporter"
import { downloadFile } from "../utils"

const mockT = vi.fn((key: string) => key) as unknown as TFunction

const makeSession = (overrides: Partial<ChatSession> = {}): ChatSession =>
  ({
    id: "s1",
    title: "My Chat",
    modelId: "llama2",
    createdAt: 1000,
    updatedAt: 2000,
    messages: [
      {
        id: "m1",
        role: "user",
        content: "Hello",
        timestamp: 1000,
        done: true
      },
      {
        id: "m2",
        role: "assistant",
        content: "Hi there",
        timestamp: 1100,
        done: true
      }
    ],
    ...overrides
  }) as unknown as ChatSession

const makeMessage = (overrides: Partial<ChatMessage> = {}): ChatMessage =>
  ({
    id: "m1",
    role: "user",
    content: "Test message",
    timestamp: 1000,
    done: true,
    ...overrides
  }) as unknown as ChatMessage

beforeEach(() => {
  vi.clearAllMocks()
})

// ─── downloadFile util ────────────────────────────────────────────────────────

describe("downloadFile", () => {
  it("creates object URL, clicks anchor, then revokes URL", async () => {
    const { downloadFile: realDownloadFile } =
      await vi.importActual<typeof import("../utils")>("../utils")

    const clickSpy = vi.fn()
    const anchor = {
      href: "",
      download: "",
      click: clickSpy
    } as unknown as HTMLAnchorElement
    vi.spyOn(document, "createElement").mockReturnValue(anchor)
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:fake")
    const revokeSpy = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => {})

    realDownloadFile(new Blob(["hi"]), "out.txt")

    expect(anchor.download).toBe("out.txt")
    expect(anchor.href).toBe("blob:fake")
    expect(clickSpy).toHaveBeenCalled()
    expect(revokeSpy).toHaveBeenCalledWith("blob:fake")

    vi.restoreAllMocks()
  })
})

// ─── jsonExporter ─────────────────────────────────────────────────────────────

describe("jsonExporter", () => {
  it("exportSession calls downloadFile with JSON blob and correct filename", () => {
    const session = makeSession()
    jsonExporter.exportSession(session, mockT)

    expect(downloadFile).toHaveBeenCalledOnce()
    const [blob, filename] = (downloadFile as ReturnType<typeof vi.fn>).mock
      .calls[0]
    expect(filename).toBe("My Chat.json")
    expect(blob.type).toBe("application/json")
    expect(blob).toBeInstanceOf(Blob)
  })

  it("exportSession uses custom fileName from options", () => {
    const session = makeSession()
    jsonExporter.exportSession(session, mockT, { fileName: "custom.json" })
    const [, filename] = (downloadFile as ReturnType<typeof vi.fn>).mock
      .calls[0]
    expect(filename).toBe("custom.json")
  })

  it("exportSession uses fallback title when session has no title", () => {
    const session = makeSession({ title: undefined })
    jsonExporter.exportSession(session, mockT)
    const [, filename] = (downloadFile as ReturnType<typeof vi.fn>).mock
      .calls[0]
    expect(filename).toBe("chat-session.json")
  })

  it("exportAllSessions downloads all-chat-sessions.json", () => {
    jsonExporter.exportAllSessions(
      [makeSession(), makeSession({ id: "s2" })],
      mockT
    )
    const [blob, filename] = (downloadFile as ReturnType<typeof vi.fn>).mock
      .calls[0]
    expect(filename).toBe("all-chat-sessions.json")
    expect(blob.type).toBe("application/json")
  })

  it("exportMessage downloads message JSON with correct filename", () => {
    const msg = makeMessage()
    jsonExporter.exportMessage(msg, mockT)
    const [blob, filename] = (downloadFile as ReturnType<typeof vi.fn>).mock
      .calls[0]
    expect(filename).toBe("message-m1.json")
    expect(blob.type).toBe("application/json")
  })

  it("exportMessage uses custom fileName from options", () => {
    jsonExporter.exportMessage(makeMessage(), mockT, { fileName: "msg.json" })
    const [, filename] = (downloadFile as ReturnType<typeof vi.fn>).mock
      .calls[0]
    expect(filename).toBe("msg.json")
  })

  it("exportMessage falls back to 'export' when message has no id", () => {
    jsonExporter.exportMessage(makeMessage({ id: undefined }), mockT)
    const [, filename] = (downloadFile as ReturnType<typeof vi.fn>).mock
      .calls[0]
    expect(filename).toBe("message-export.json")
  })
})
