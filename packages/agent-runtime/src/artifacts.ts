import {
  AGENT_ARTIFACT_RETENTION_MS,
  type AgentArtifact,
  AgentArtifactSchema,
  type AgentDownloadState,
  MAX_AGENT_ARTIFACT_BYTES,
  MAX_AGENT_ARTIFACT_TEXT_CHARS,
  MAX_AGENT_ARTIFACTS
} from "@ollama-client/contracts"
import type { AgentCancellationSignal } from "./ports"

/** A durable upload intent is never automatically replayed, even after restart. */
export interface AgentArtifactUpload {
  id: string
  runId: string
  artifactId: string
  sha256: string
  destination: string
  stepId: string
  status: "claimed" | "completed" | "uncertain"
}

/** Storage must atomically enforce run bounds and unique upload identities. */
export interface AgentArtifactStore {
  list(runId: string): Promise<AgentArtifact[]>
  get(
    runId: string,
    artifactId: string
  ): Promise<{ artifact: AgentArtifact; bytes: Uint8Array } | undefined>
  put(
    artifact: AgentArtifact,
    bytes: Uint8Array,
    maxArtifacts: number
  ): Promise<void>
  prune(now: number): Promise<void>
  claimUpload(upload: AgentArtifactUpload): Promise<boolean>
  settleUpload(id: string, status: "completed" | "uncertain"): Promise<void>
}

/** Browser adapters report actual transfer/file-input evidence, not model claims. */
export interface AgentArtifactPorts {
  store: AgentArtifactStore
  now(): number
  newId(): string
  hash(bytes: Uint8Array): Promise<string>
  ownerActive(runId: string): Promise<boolean>
  /** Revalidate the exact tuple against the persisted host policy/effect claim. */
  authorizeUpload(authorization: AgentArtifactAuthorization): Promise<boolean>
  parse(artifact: AgentArtifact, bytes: Uint8Array): Promise<string>
  upload(
    input: {
      artifact: AgentArtifact
      bytes: Uint8Array
      destination: string
      stepId: string
    },
    signal: AgentCancellationSignal
  ): Promise<{ sha256: string; destination: string }>
}

/** The host supplies this from a persisted policy decision, never from page text. */
export interface AgentArtifactAuthorization {
  runId: string
  stepId: string
  destination: string
  artifactId: string
  sha256: string
}

const httpDestination = (value: string): string => {
  if (!/^https?:\/\/[^/@?#\s]+(?:[/?][^#\s]*)?$/.test(value))
    throw new Error("Artifact destination must be an exact HTTP(S) destination")
  return value
}

const checkCancellation = (signal?: AgentCancellationSignal): void => {
  if (signal?.aborted) throw new Error("Artifact operation canceled")
}

/** Port-driven file workflow. No method accepts or returns a filesystem path. */
export const createAgentArtifactService = (ports: AgentArtifactPorts) => {
  const active = async (runId: string, signal?: AgentCancellationSignal) => {
    checkCancellation(signal)
    if (!(await ports.ownerActive(runId)))
      throw new Error("Artifact run has no active owner")
    checkCancellation(signal)
  }
  const load = async (runId: string, id: string) => {
    await ports.store.prune(ports.now())
    const stored = await ports.store.get(runId, id)
    if (
      !stored ||
      stored.artifact.runId !== runId ||
      stored.artifact.expiresAt <= ports.now()
    )
      throw new Error("Artifact is unavailable to this run")
    const artifact = AgentArtifactSchema.parse(stored.artifact)
    const bytes = stored.bytes.slice()
    if (
      bytes.byteLength !== artifact.size ||
      (await ports.hash(bytes)) !== artifact.sha256
    )
      throw new Error("Artifact content does not match its identity")
    return { artifact, bytes }
  }
  return {
    async retain(
      input: {
        runId: string
        name: string
        mime: AgentArtifact["mime"]
        bytes: Uint8Array
        provenance: AgentArtifact["provenance"]
        /** Required when provenance names a completed browser download. */
        downloadState?: AgentDownloadState
      },
      signal: AgentCancellationSignal
    ): Promise<AgentArtifact> {
      await active(input.runId, signal)
      if (input.bytes.byteLength > MAX_AGENT_ARTIFACT_BYTES)
        throw new Error("Artifact exceeds byte limit")
      if (
        input.provenance.kind === "download" &&
        input.downloadState !== "completed"
      )
        throw new Error("An incomplete download is not an artifact")
      const bytes = input.bytes.slice()
      const createdAt = ports.now()
      const artifact = AgentArtifactSchema.parse({
        id: ports.newId(),
        runId: input.runId,
        name: input.name,
        mime: input.mime,
        size: bytes.byteLength,
        sha256: await ports.hash(bytes),
        provenance: input.provenance,
        createdAt,
        expiresAt: createdAt + AGENT_ARTIFACT_RETENTION_MS
      })
      await ports.store.prune(ports.now())
      await active(input.runId, signal)
      await ports.store.put(artifact, bytes, MAX_AGENT_ARTIFACTS)
      return artifact
    },
    async inspect(
      runId: string,
      artifactId: string,
      signal: AgentCancellationSignal
    ) {
      await active(runId, signal)
      const stored = await load(runId, artifactId)
      const text = await ports.parse(stored.artifact, stored.bytes)
      await active(runId, signal)
      if (stored.artifact.expiresAt <= ports.now())
        throw new Error("Artifact expired during parsing")
      return {
        artifact: stored.artifact,
        text: text.slice(0, MAX_AGENT_ARTIFACT_TEXT_CHARS),
        truncated: text.length > MAX_AGENT_ARTIFACT_TEXT_CHARS,
        /** Source content remains untrusted, even though parsing succeeded. */
        trust: "untrusted_document" as const
      }
    },
    async upload(
      inputAuthorization: AgentArtifactAuthorization,
      signal: AgentCancellationSignal
    ): Promise<"completed" | "uncertain"> {
      const authorization = { ...inputAuthorization }
      await active(authorization.runId, signal)
      if (!(await ports.authorizeUpload(authorization)))
        throw new Error("Artifact upload destination or effect is not approved")
      const stored = await load(authorization.runId, authorization.artifactId)
      const destination = httpDestination(authorization.destination)
      if (stored.artifact.sha256 !== authorization.sha256)
        throw new Error("Approval names another artifact")
      const id = `${authorization.runId}:${authorization.artifactId}`
      const upload: AgentArtifactUpload = {
        ...authorization,
        destination,
        id,
        status: "claimed"
      }
      await active(authorization.runId, signal)
      if (!(await ports.store.claimUpload(upload)))
        throw new Error(
          "Artifact upload already claimed; reconcile without replay"
        )
      let status: "completed" | "uncertain" = "uncertain"
      try {
        await active(authorization.runId, signal)
        if (stored.artifact.expiresAt <= ports.now())
          throw new Error("Artifact expired before upload")
        const evidence = await ports.upload(
          { ...stored, destination, stepId: authorization.stepId },
          signal
        )
        await active(authorization.runId, signal)
        if (
          evidence.sha256 === stored.artifact.sha256 &&
          evidence.destination === destination
        )
          status = "completed"
      } catch {
        /** Dispatch may have reached the page; never retry on lost acknowledgement. */
      }
      await ports.store.settleUpload(id, status)
      return status
    }
  }
}
