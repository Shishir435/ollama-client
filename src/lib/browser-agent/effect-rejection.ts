/**
 * Why a page refused an approved effect before performing any of it.
 *
 * A rejection crosses the control port as a type, not as a sentence: the
 * document that refuses is untrusted, so nothing it composes may travel. The
 * codes below are the whole vocabulary, and each one is raised at exactly one
 * place in this build.
 *
 * The port used to carry no reason at all. Every refusal — a covered control,
 * a value the run no longer recognises, a target that was replaced — reached
 * the run as the same bare error and was recorded as "Target changed; no
 * browser effect was attempted". Two live runs died that way with nothing in
 * the record to say which of those had happened.
 */
export const AGENT_EFFECT_REJECTIONS = {
  /** The referenced node is gone from its document. */
  targetReplaced: "target_replaced",
  /** An identity field of the control no longer matches what was approved. */
  targetChanged: "target_changed",
  /** The control holds a different value than the resolved effect was built from. */
  valueChanged: "value_changed",
  /** The field holds more text than the run can verify it wrote. */
  valueTooLong: "value_too_long",
  /** No click point on the control hit-tests to it. */
  targetCovered: "target_covered",
  /** The approved point no longer lands on the control it was approved for. */
  visualTargetMoved: "visual_target_moved",
  /** The text to replace is no longer present exactly once. */
  textNotUnique: "text_not_unique",
  /** The editing host refused text through the browser's editing pipeline. */
  editorRefusedText: "editor_refused_text",
  /** Form state outside the target moved after the submission was approved. */
  formStateChanged: "form_state_changed",
  /** A rejection this build raises without naming a reason. */
  unspecified: "unspecified"
} as const

export type AgentEffectRejectionReason =
  (typeof AGENT_EFFECT_REJECTIONS)[keyof typeof AGENT_EFFECT_REJECTIONS]

export const AGENT_EFFECT_REJECTION_REASONS = Object.values(
  AGENT_EFFECT_REJECTIONS
) as readonly AgentEffectRejectionReason[]

/**
 * The sentence each reason is raised with. A rejection is thrown as an error
 * so it reads in a stack, and classified back to its code at the port; both
 * halves come from here so they cannot drift apart.
 */
const REJECTION_MESSAGES: Record<AgentEffectRejectionReason, string> = {
  target_replaced: "Agent mutation target was replaced",
  target_changed: "Agent mutation target changed after approval",
  value_changed: "Agent mutation target value changed after approval",
  value_too_long: "Agent field exceeds the verifiable text limit",
  target_covered: "Agent target is covered by another element",
  visual_target_moved: "Agent visual target moved before execution",
  text_not_unique: "Agent text to replace is no longer unique in the target",
  editor_refused_text:
    "Agent cannot edit this host through the browser's editing pipeline",
  form_state_changed: "Agent mutation form state changed after approval",
  unspecified: "Agent effect was refused by the page"
}

/**
 * A refused identity check also names the field that moved. The field name is
 * this build's own vocabulary, never a value read from the page.
 */
export const agentRejectionMessage = (
  reason: AgentEffectRejectionReason,
  field?: string
): string =>
  field ? `${REJECTION_MESSAGES[reason]}: ${field}` : REJECTION_MESSAGES[reason]

/**
 * Classify a refusal back to its code at the port. An unrecognised message is
 * `unspecified` rather than forwarded, because only the codes above are known
 * to have been composed by this build.
 */
export const agentRejectionReason = (
  error: unknown
): AgentEffectRejectionReason => {
  const message = error instanceof Error ? error.message : ""
  for (const reason of AGENT_EFFECT_REJECTION_REASONS) {
    if (message.startsWith(REJECTION_MESSAGES[reason])) return reason
  }
  return AGENT_EFFECT_REJECTIONS.unspecified
}
