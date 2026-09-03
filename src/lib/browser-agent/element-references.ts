export interface AgentReferenceIdentity {
  snapshotId: string
  generation: number
  documentId: string
  frameId: 0
}

export interface AgentElementReferenceSnapshot extends AgentReferenceIdentity {
  reference(element: Element): string
  resolve(ref: string, identity: AgentReferenceIdentity): Element | undefined
}

export interface AgentElementReferenceStore {
  beginSnapshot(input: {
    minimumGeneration: number
    createSnapshotId: () => string
  }): AgentElementReferenceSnapshot
  invalidate(): void
  currentGeneration(): number
  matches(identity: AgentReferenceIdentity): boolean
  resolve(ref: string, identity: AgentReferenceIdentity): Element | undefined
}

export const createAgentElementReferenceStore = (input: {
  documentId: string
}): AgentElementReferenceStore => {
  let generation = 0
  let active: AgentElementReferenceSnapshot | undefined

  return {
    beginSnapshot({ minimumGeneration, createSnapshotId }) {
      generation = Math.max(generation + 1, minimumGeneration)
      const snapshotId = createSnapshotId()
      const byElement = new WeakMap<Element, string>()
      const byRef = new Map<string, Element>()
      let nextRef = 0
      const identity: AgentReferenceIdentity = {
        snapshotId,
        generation,
        documentId: input.documentId,
        frameId: 0
      }
      const snapshot: AgentElementReferenceSnapshot = {
        ...identity,
        reference(element) {
          const existing = byElement.get(element)
          if (existing) return existing
          const ref = `e${++nextRef}`
          byElement.set(element, ref)
          byRef.set(ref, element)
          return ref
        },
        resolve(ref, candidate) {
          if (active !== snapshot) return undefined
          if (
            candidate.snapshotId !== snapshotId ||
            candidate.generation !== generation ||
            candidate.documentId !== input.documentId ||
            candidate.frameId !== 0
          ) {
            return undefined
          }
          return byRef.get(ref)
        }
      }
      active = snapshot
      return snapshot
    },
    invalidate() {
      generation += 1
      active = undefined
    },
    currentGeneration: () => generation,
    matches(identity) {
      return Boolean(
        active &&
          active.snapshotId === identity.snapshotId &&
          active.generation === identity.generation &&
          active.documentId === identity.documentId &&
          identity.frameId === 0
      )
    },
    resolve(ref, identity) {
      return active?.resolve(ref, identity)
    }
  }
}
