import {
  AGENT_ARTIFACT_RETENTION_MS,
  type AgentArtifact
} from "@ollama-client/contracts"
import { describe, expect, it, vi } from "vitest"
import {
  type AgentArtifactPorts,
  type AgentArtifactUpload,
  createAgentArtifactService
} from "../artifacts"

const setup = () => {
  let now = 1000
  let owner = true
  let number = 1
  const entries = new Map<
    string,
    { artifact: AgentArtifact; bytes: Uint8Array }
  >()
  const intents = new Map<string, AgentArtifactUpload>()
  const hash = vi.fn(async (bytes: Uint8Array) =>
    bytes[0].toString(16).padStart(64, "0")
  )
  const ports: AgentArtifactPorts = {
    now: () => now,
    newId: () =>
      `00000000-0000-4000-8000-${String(number++).padStart(12, "0")}`,
    hash,
    ownerActive: async () => owner,
    authorizeUpload: async () => true,
    parse: vi.fn(async () => "Invoice A: paid"),
    upload: vi.fn(async ({ artifact, destination }) => ({
      sha256: artifact.sha256,
      destination
    })),
    store: {
      list: async (runId) =>
        [...entries.values()]
          .filter((entry) => entry.artifact.runId === runId)
          .map((entry) => entry.artifact),
      get: async (runId, id) =>
        entries.get(id)?.artifact.runId === runId ? entries.get(id) : undefined,
      put: async (artifact, bytes, max) => {
        if (
          [...entries.values()].filter(
            (entry) => entry.artifact.runId === artifact.runId
          ).length >= max
        )
          throw new Error("limit")
        entries.set(artifact.id, { artifact, bytes })
      },
      prune: async (at) => {
        for (const [id, entry] of entries)
          if (entry.artifact.expiresAt <= at) entries.delete(id)
      },
      claimUpload: async (intent) => {
        if (intents.has(intent.id)) return false
        intents.set(intent.id, intent)
        return true
      },
      settleUpload: async (id, status) => {
        const intent = intents.get(id)
        if (!intent) throw new Error("missing intent")
        intent.status = status
      }
    }
  }
  const retain = (service = createAgentArtifactService(ports)) =>
    service.retain(
      {
        runId: "run",
        name: "invoice.txt",
        mime: "text/plain",
        bytes: new Uint8Array([42]),
        provenance: { kind: "user_selected" }
      },
      { aborted: false }
    )
  return {
    ports,
    entries,
    intents,
    retain,
    setNow: (value: number) => {
      now = value
    },
    setOwner: (value: boolean) => {
      owner = value
    }
  }
}
const signal = () => ({ aborted: false })
const authorization = (artifact: AgentArtifact) => ({
  runId: "run",
  stepId: "step",
  artifactId: artifact.id,
  sha256: artifact.sha256,
  destination: "https://approved.test/upload"
})

describe("run-scoped artifacts", () => {
  it("retains immutable bytes, source identity and bounded independent parsing", async () => {
    const test = setup()
    const service = createAgentArtifactService(test.ports)
    const artifact = await test.retain(service)
    const parsed = await service.inspect("run", artifact.id, signal())
    expect(parsed.text).toBe("Invoice A: paid")
    expect(parsed.artifact.sha256).toBe(artifact.sha256)
    expect(parsed.trust).toBe("untrusted_document")
    expect(parsed.truncated).toBe(false)
  })
  it.each([
    "initiated",
    "failed",
    "canceled"
  ] as const)("refuses %s downloads as complete artifacts", async (downloadState) => {
    const test = setup()
    await expect(
      createAgentArtifactService(test.ports).retain(
        {
          runId: "run",
          name: "file.txt",
          mime: "text/plain",
          bytes: new Uint8Array([1]),
          provenance: {
            kind: "download",
            downloadId: 1,
            sourceUrl: "https://source.test/document"
          },
          downloadState
        },
        signal()
      )
    ).rejects.toThrow("incomplete")
    expect(test.entries.size).toBe(0)
  })
  it("refuses cross-run handles, expired artifacts, changed bytes and unselected files", async () => {
    const test = setup()
    const service = createAgentArtifactService(test.ports)
    const artifact = await test.retain(service)
    await expect(
      service.inspect("other", artifact.id, signal())
    ).rejects.toThrow("unavailable")
    await expect(
      service.inspect("run", "unselected", signal())
    ).rejects.toThrow("unavailable")
    const entry = test.entries.get(artifact.id)
    if (!entry) throw new Error("missing entry")
    entry.bytes[0] = 99
    await expect(service.inspect("run", artifact.id, signal())).rejects.toThrow(
      "identity"
    )
    test.setNow(1000 + AGENT_ARTIFACT_RETENTION_MS)
    await expect(service.inspect("run", artifact.id, signal())).rejects.toThrow(
      "unavailable"
    )
  })
  it("bounds retention, names and MIME types without exposing local paths", async () => {
    const test = setup()
    for (let i = 0; i < 8; i++) await test.retain()
    await expect(test.retain()).rejects.toThrow("limit")
    await expect(
      createAgentArtifactService(test.ports).retain(
        {
          runId: "run",
          name: "/private/file.txt",
          mime: "text/plain",
          bytes: new Uint8Array([1]),
          provenance: { kind: "user_selected" }
        },
        signal()
      )
    ).rejects.toThrow()
  })
  it("uploads exact approved bytes once and persists the claim before dispatch", async () => {
    const test = setup()
    const artifact = await test.retain()
    test.ports.upload = vi.fn(async ({ artifact, destination }) => {
      expect([...test.intents.values()][0].status).toBe("claimed")
      return { sha256: artifact.sha256, destination }
    })
    const service = createAgentArtifactService(test.ports)
    expect(await service.upload(authorization(artifact), signal())).toBe(
      "completed"
    )
    await expect(
      createAgentArtifactService(test.ports).upload(
        authorization(artifact),
        signal()
      )
    ).rejects.toThrow("already claimed")
    expect(test.ports.upload).toHaveBeenCalledTimes(1)
  })
  it("refuses an approval for another artifact and non-HTTP destinations before dispatch", async () => {
    const test = setup()
    const artifact = await test.retain()
    const service = createAgentArtifactService(test.ports)
    await expect(
      service.upload(
        { ...authorization(artifact), sha256: "0".repeat(64) },
        signal()
      )
    ).rejects.toThrow("another artifact")
    await expect(
      service.upload(
        { ...authorization(artifact), destination: "file:///private/file" },
        signal()
      )
    ).rejects.toThrow("destination")
    expect(test.ports.upload).not.toHaveBeenCalled()
    expect(test.intents.size).toBe(0)
  })
  it.each([
    "throw",
    "wrong_artifact",
    "wrong_destination",
    "owner_loss"
  ])("retains %s as uncertain and prevents retries", async (fault) => {
    const test = setup()
    const artifact = await test.retain()
    test.ports.upload = vi.fn(async ({ artifact, destination }) => {
      if (fault === "throw") throw new Error("lost acknowledgement")
      if (fault === "owner_loss") test.setOwner(false)
      return {
        sha256: fault === "wrong_artifact" ? "0".repeat(64) : artifact.sha256,
        destination:
          fault === "wrong_destination"
            ? "https://elsewhere.test/"
            : destination
      }
    })
    const service = createAgentArtifactService(test.ports)
    expect(await service.upload(authorization(artifact), signal())).toBe(
      "uncertain"
    )
    expect([...test.intents.values()][0].status).toBe("uncertain")
    test.setOwner(true)
    await expect(
      createAgentArtifactService(test.ports).upload(
        authorization(artifact),
        signal()
      )
    ).rejects.toThrow("already claimed")
    expect(test.ports.upload).toHaveBeenCalledTimes(1)
  })
  it("refuses disallowed destinations through host policy before claiming an effect", async () => {
    const test = setup()
    const artifact = await test.retain()
    test.ports.authorizeUpload = async () => false
    await expect(
      createAgentArtifactService(test.ports).upload(
        authorization(artifact),
        signal()
      )
    ).rejects.toThrow("not approved")
    expect(test.ports.upload).not.toHaveBeenCalled()
    expect(test.intents.size).toBe(0)
  })
  it("aborts before registration or upload when the run loses ownership", async () => {
    const test = setup()
    test.setOwner(false)
    await expect(test.retain()).rejects.toThrow("owner")
    test.setOwner(true)
    const artifact = await test.retain()
    const canceled = { aborted: true }
    await expect(
      createAgentArtifactService(test.ports).upload(
        authorization(artifact),
        canceled
      )
    ).rejects.toThrow()
    expect(test.intents.size).toBe(0)
  })
})
