import { describe, expect, it } from "vitest"
import type { ProcessedFile } from "@/lib/file-processors/types"
import {
  buildUserMessage,
  evaluateSendPreconditions,
  resolveTurnModel
} from "../turn-preparation"

const okInput = {
  isBusy: false,
  selectionConflictModel: null,
  rawInput: "hello",
  hasFiles: false,
  hasImages: false,
  resolvedModel: "llama3"
}

describe("evaluateSendPreconditions", () => {
  it("proceeds when a model is resolved and there is something to send", () => {
    expect(evaluateSendPreconditions(okInput)).toEqual({ proceed: true })
  })

  it("blocks silently while a stream is busy", () => {
    expect(evaluateSendPreconditions({ ...okInput, isBusy: true })).toEqual({
      proceed: false
    })
  })

  it("blocks silently when there is nothing to send", () => {
    expect(
      evaluateSendPreconditions({
        ...okInput,
        rawInput: "",
        hasFiles: false,
        hasImages: false
      })
    ).toEqual({ proceed: false })
  })

  it("proceeds on files or images alone (no text)", () => {
    expect(
      evaluateSendPreconditions({ ...okInput, rawInput: "", hasFiles: true })
    ).toEqual({ proceed: true })
    expect(
      evaluateSendPreconditions({ ...okInput, rawInput: "", hasImages: true })
    ).toEqual({ proceed: true })
  })

  it("surfaces a destructive toast on an unresolved provider selection", () => {
    const verdict = evaluateSendPreconditions({
      ...okInput,
      selectionConflictModel: "mixtral"
    })
    expect(verdict.proceed).toBe(false)
    expect(verdict).toMatchObject({
      toast: {
        variant: "destructive",
        title: "Model provider selection required"
      }
    })
    expect(verdict.proceed === false && verdict.toast?.description).toContain(
      "mixtral"
    )
  })

  it("surfaces a destructive toast when no model resolves", () => {
    const verdict = evaluateSendPreconditions({
      ...okInput,
      resolvedModel: undefined
    })
    expect(verdict).toMatchObject({
      proceed: false,
      toast: { variant: "destructive", title: "No model selected" }
    })
  })

  it("checks conflict before the empty guard so a bad selection still warns", () => {
    const verdict = evaluateSendPreconditions({
      ...okInput,
      rawInput: "",
      selectionConflictModel: "mixtral"
    })
    expect(verdict).toMatchObject({
      proceed: false,
      toast: { title: "Model provider selection required" }
    })
  })
})

describe("resolveTurnModel", () => {
  it("prefers the explicit override, then the mapped ref, then the plain model", () => {
    expect(
      resolveTurnModel("override", { modelId: "ref" } as any, "plain")
    ).toBe("override")
    expect(
      resolveTurnModel(undefined, { modelId: "ref" } as any, "plain")
    ).toBe("ref")
    expect(resolveTurnModel(undefined, null, "plain")).toBe("plain")
  })
})

describe("buildUserMessage", () => {
  const file = {
    text: "the quick brown fox".repeat(50),
    metadata: {
      fileId: "f1",
      fileName: "notes.txt",
      fileType: "text/plain",
      fileSize: 1024,
      processedAt: 111
    }
  } as unknown as ProcessedFile

  it("builds a user message with a truncated attachment preview", () => {
    const message = buildUserMessage({
      content: "summarize",
      files: [file],
      images: undefined
    })
    expect(message.role).toBe("user")
    expect(message.content).toBe("summarize")
    expect(message.attachments).toHaveLength(1)
    expect(message.attachments?.[0]).toMatchObject({
      fileId: "f1",
      fileName: "notes.txt"
    })
    expect(message.attachments?.[0]?.textPreview?.length).toBeLessThanOrEqual(
      200
    )
  })

  it("omits attachments and images when none are supplied", () => {
    const message = buildUserMessage({
      content: "hi",
      files: undefined,
      images: []
    })
    expect(message.attachments).toBeUndefined()
    expect(message.images).toBeUndefined()
  })

  it("keeps images only when the array is non-empty", () => {
    const images = [{ base64: "abc", mimeType: "image/png" }] as any
    const message = buildUserMessage({ content: "", files: undefined, images })
    expect(message.images).toBe(images)
  })
})
