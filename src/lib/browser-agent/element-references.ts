export interface AgentReferenceIdentity {
  snapshotId: string
  generation: number
  documentId: string
  frameId: 0
}

export interface AgentElementReferenceSnapshot extends AgentReferenceIdentity {
  reference(element: Element): string
  verificationId(element: Element): string
  matchesFormState(ref: string, identity: AgentReferenceIdentity): boolean
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
  matchesFormState(ref: string, identity: AgentReferenceIdentity): boolean
  resolve(ref: string, identity: AgentReferenceIdentity): Element | undefined
}

const associatedForm = (element: Element): HTMLFormElement | null =>
  element instanceof HTMLButtonElement ||
  element instanceof HTMLInputElement ||
  element instanceof HTMLSelectElement ||
  element instanceof HTMLTextAreaElement
    ? element.form
    : null

/**
 * This state never crosses the content-script boundary. In particular, hidden
 * and sensitive values are compared exactly here instead of being exposed in
 * an observation or weakened into a public, attacker-visible checksum.
 */
const privateFormState = (element: Element): string | undefined => {
  const form = associatedForm(element)
  if (!form) return undefined
  return JSON.stringify({
    attributes: Array.from(form.attributes).map(({ name, value }) => [
      name,
      value
    ]),
    action: form.action,
    method: form.method,
    enctype: form.enctype,
    noValidate: form.noValidate,
    target: form.target,
    controls: Array.from(form.elements).map((control) => {
      if (!(control instanceof Element)) return null
      const input = control as HTMLInputElement
      return {
        tag: control.tagName.toLowerCase(),
        type: input.type?.toLowerCase() ?? "",
        attributes: Array.from(control.attributes).map(({ name, value }) => [
          name,
          value
        ]),
        value: "value" in control ? String(input.value) : "",
        checked: "checked" in control ? Boolean(input.checked) : undefined,
        disabled: "disabled" in control ? Boolean(input.disabled) : undefined,
        selected:
          control instanceof HTMLSelectElement
            ? Array.from(control.options).map((option) => option.selected)
            : undefined
      }
    })
  })
}

export const createAgentElementReferenceStore = (input: {
  documentId: string
  createVerificationId?: () => string
}): AgentElementReferenceStore => {
  let generation = 0
  let active: AgentElementReferenceSnapshot | undefined
  const verificationIds = new WeakMap<Element, string>()
  const createVerificationId =
    input.createVerificationId ??
    (() =>
      Array.from(globalThis.crypto.getRandomValues(new Uint32Array(2)))
        .map((value) => value.toString(16).padStart(8, "0"))
        .join(""))

  return {
    beginSnapshot({ minimumGeneration, createSnapshotId }) {
      generation = Math.max(generation + 1, minimumGeneration)
      const snapshotId = createSnapshotId()
      const byElement = new WeakMap<Element, string>()
      const byRef = new Map<string, Element>()
      const formStateByRef = new Map<string, string | undefined>()
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
          formStateByRef.set(ref, privateFormState(element))
          return ref
        },
        verificationId(element) {
          const existing = verificationIds.get(element)
          if (existing) return existing
          const id = createVerificationId()
          verificationIds.set(element, id)
          return id
        },
        matchesFormState(ref, candidate) {
          const element = snapshot.resolve(ref, candidate)
          if (!element || !formStateByRef.has(ref)) return false
          return formStateByRef.get(ref) === privateFormState(element)
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
    matchesFormState(ref, identity) {
      return active?.matchesFormState(ref, identity) ?? false
    },
    resolve(ref, identity) {
      return active?.resolve(ref, identity)
    }
  }
}
