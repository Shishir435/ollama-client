import type { AgentElement, AgentObservation } from "@ollama-client/contracts"

/**
 * What the model is actually given for a page.
 *
 * The whole observation used to be serialized into the prompt, and most of it
 * is not the model's business: `frameId` is always 0, `verificationId` is the
 * executor's binding, a form fingerprint is a hash the run compares, and a
 * flag whose value is the default says nothing. On a real page that noise is
 * most of the payload, and a payload that large is what pushes the system
 * prompt and the tool schema out of a small model's context window.
 *
 * The projection keeps the same shape rather than inventing a text format:
 * refs stay authoritative and unambiguous, and every field that remains is
 * one a decision can act on. The runtime keeps the exact observation for
 * grounding and verification; this is only what travels.
 */
export interface AgentProjectedElement {
  ref: string
  tag: string
  role?: string
  name?: string
  type?: string
  value?: string
  checked?: boolean
  focused?: boolean
  href?: string
  options?: { value: string; label?: string }[]
  /** The landmark, form or dialog this element belongs to. */
  group?: string
  /** Present only when true, because the default is what most rows are. */
  submits?: boolean
  editable?: boolean
  sensitive?: boolean
  disabled?: boolean
  hidden?: boolean
}

/**
 * A frame the page holds, as the model needs to know it: which frame a ref's
 * prefix names, and whether the run was able to read it. A frame the run did
 * not read shows its origin and why, so the model can ask for it rather than
 * concluding the control is not there.
 */
export interface AgentProjectedFrame {
  frameId: number
  origin: string
  access: AgentObservation["frames"][number]["access"]
}

export interface AgentProjectedObservation {
  url: string
  title: string
  /** Present only when the page has frames beyond its root. */
  frames?: AgentProjectedFrame[]
  scroll: { y: number; ofDocument: number }
  /** Open dialogs and menus, so a decision can act inside the top one. */
  modals?: { id: string; label?: string; kind: string }[]
  /** Text inside the viewport. */
  text: string
  /** The rest of the document, when there is any and it fits. */
  documentText?: string
  documentTextTruncated?: boolean
  elements: AgentProjectedElement[]
}

export const AGENT_PROJECTION_LIMITS = {
  /**
   * A name is prose the model reads and never has to reproduce, so it can be
   * shortened: the observation's own 500-character cap is generous for a
   * prompt, and two thousand rows of it is most of a small model's window.
   *
   * A `value` gets no such cap. For a select it has to match an option
   * exactly, and for any field it is what tells the model whether the field
   * already holds what the goal wants — an altered one is worse than a
   * missing one.
   */
  nameChars: 200
} as const

/**
 * The one field that is not reduced.
 *
 * An option's value is the payload of a `select`, and the executor requires
 * exact equality against the option the page actually holds — so a truncated
 * value is unselectable and an omitted option is unreachable. Capping either
 * does not make the page cheaper to read, it makes part of it impossible to
 * use. Disabled options are dropped because the executor refuses them anyway,
 * and a label travels only when it says something the value does not.
 *
 * The bound that matters is the observation's own: two hundred options, each
 * at most two thousand characters.
 */
const projectOptions = (
  element: AgentElement
): AgentProjectedElement["options"] => {
  if (!element.options?.length) return undefined
  const enabled = element.options.filter((option) => !option.disabled)
  return enabled.length > 0
    ? enabled.map((option) => ({
        value: option.value,
        ...(option.label && option.label !== option.value
          ? { label: option.label }
          : {})
      }))
    : undefined
}

export const projectAgentElement = (
  element: AgentElement
): AgentProjectedElement => {
  const options = projectOptions(element)
  return {
    ref: element.ref,
    tag: element.tag,
    ...(element.role ? { role: element.role } : {}),
    ...(element.name
      ? { name: element.name.slice(0, AGENT_PROJECTION_LIMITS.nameChars) }
      : {}),
    ...(element.type ? { type: element.type } : {}),
    ...(element.value !== undefined ? { value: element.value } : {}),
    ...(element.checked !== undefined ? { checked: element.checked } : {}),
    ...(element.focused ? { focused: true } : {}),
    ...(element.href ? { href: element.href } : {}),
    ...(options ? { options } : {}),
    ...(element.group ? { group: element.group } : {}),
    ...(element.submitter || element.maySubmit ? { submits: true } : {}),
    ...(element.editable ? { editable: true } : {}),
    ...(element.sensitive ? { sensitive: true } : {}),
    ...(element.enabled ? {} : { disabled: true }),
    ...(element.visible ? {} : { hidden: true })
  }
}

export const projectAgentObservation = (
  observation: AgentObservation
): AgentProjectedObservation => ({
  url: observation.url,
  title: observation.title,
  ...(observation.frames.length > 1
    ? {
        frames: observation.frames
          .slice(1)
          .map(({ frameId, origin, access }) => ({ frameId, origin, access }))
      }
    : {}),
  scroll: {
    y: Math.round(observation.scroll.y),
    ofDocument: Math.max(1, Math.round(observation.scroll.documentHeight))
  },
  ...(observation.modals?.length ? { modals: observation.modals } : {}),
  text: observation.visibleText,
  ...(observation.documentText
    ? { documentText: observation.documentText }
    : {}),
  ...(observation.documentTextTruncated ? { documentTextTruncated: true } : {}),
  elements: observation.elements.map(projectAgentElement)
})
