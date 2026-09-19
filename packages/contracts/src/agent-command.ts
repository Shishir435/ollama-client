import { z } from "zod"

import { AgentKeyCombinationSchema } from "./agent-keys"

/**
 * The longest destination a command may name, matching the cap an observed
 * link carries. It also bounds the work the egress detector does per command.
 */
export const MAX_AGENT_DESTINATION_URL_CHARS = 2_048

/** Bounded text editing supports ordinary documents, not only short fields. */
export const MAX_AGENT_TEXT_CHARS = 20_000

/**
 * How many controls one `fill_form` may set.
 *
 * Twelve covers the forms this is for — an address, a profile, a checkout
 * step — without becoming a general action script. The bound is what keeps a
 * batch reviewable: the user approves it once, so what they are approving has
 * to fit in one prompt, and a partial result has to stay legible as a list.
 */
export const MAX_AGENT_FORM_FIELDS = 12

/**
 * How much text a batched field may carry.
 *
 * Far below `MAX_AGENT_TEXT_CHARS`, and deliberately: a batch is for the
 * predictable fields of a form, not for composing a document. A long edit is
 * its own step, where it gets its own approval and its own verification
 * rather than being one line of a twelve-part receipt.
 */
export const MAX_AGENT_FORM_FIELD_CHARS = 1_000

/**
 * How many questions one `extract` may ask.
 *
 * Six, because the answer is bounded as a whole: every query shares one
 * match budget, and a model that asks twelve questions gets two rows each,
 * which answers none of them.
 */
export const MAX_AGENT_EXTRACT_QUERIES = 6

const GroundedCommandSchema = z.object({
  snapshotId: z.string().min(1),
  generation: z.number().int().nonnegative()
})

const ElementCommandSchema = GroundedCommandSchema.extend({
  ref: z.string().min(1)
})

/**
 * One control a `fill_form` sets, and the value to set it to.
 *
 * The four operations are the ones whose whole effect is a value: text,
 * selection and the two checkbox directions. Clicking, pressing a key,
 * navigating and submitting are deliberately absent — a batch that could
 * click could submit, and the submission is the step the user is asked
 * about. Keeping it out is what makes one approval for the batch honest.
 */
export const AgentFormFieldSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("clear_and_type"),
      ref: z.string().min(1),
      text: z.string().max(MAX_AGENT_FORM_FIELD_CHARS)
    })
    .strict(),
  z
    .object({
      type: z.literal("type"),
      ref: z.string().min(1),
      text: z.string().min(1).max(MAX_AGENT_FORM_FIELD_CHARS)
    })
    .strict(),
  z
    .object({
      type: z.literal("select"),
      ref: z.string().min(1),
      value: z.string().max(2_000)
    })
    .strict(),
  z.object({ type: z.literal("check"), ref: z.string().min(1) }).strict(),
  z.object({ type: z.literal("uncheck"), ref: z.string().min(1) }).strict()
])
export type AgentFormField = z.infer<typeof AgentFormFieldSchema>

export const AgentCommandSchema = z.discriminatedUnion("type", [
  GroundedCommandSchema.extend({ type: z.literal("read") }).strict(),
  /**
   * Read-only progressive inspection. An overview is bounded, so a large
   * application's controls do not all travel at once; these ask for more of
   * the page the overview summarised. `inspect` expands one region named by
   * its group, `find` surfaces controls matching a query, and `extract_text`
   * returns the page's whole text — the below-fold document included, which
   * the overview omits. None mutates the page, so all resolve as `read` and
   * never ask approval.
   */
  GroundedCommandSchema.extend({
    type: z.literal("inspect"),
    target: z.string().min(1).max(80),
    /** Where to resume when a previous answer stopped with more to give. */
    offset: z.number().int().min(0).max(100_000).optional()
  }).strict(),
  GroundedCommandSchema.extend({
    type: z.literal("find"),
    query: z.string().min(1).max(100),
    offset: z.number().int().min(0).max(100_000).optional()
  }).strict(),
  GroundedCommandSchema.extend({
    type: z.literal("extract_text"),
    offset: z.number().int().min(0).max(10_000_000).optional(),
    frameId: z.number().int().nonnegative().optional()
  }).strict(),
  /**
   * Visual grounding. `click_point` names a pixel in the screenshot attached
   * to the observation the command is grounded in; the executor finds the
   * control under it and clicks that control, never the bare coordinate.
   * `zoom` asks for the next screenshot to be a magnified crop of a region,
   * read-only like `inspect`. Both are offered only to a vision model and only
   * when a screenshot travelled with the observation.
   */
  GroundedCommandSchema.extend({
    type: z.literal("click_point"),
    x: z.number().finite().nonnegative(),
    y: z.number().finite().nonnegative()
  }).strict(),
  GroundedCommandSchema.extend({
    type: z.literal("zoom"),
    x: z.number().finite().nonnegative(),
    y: z.number().finite().nonnegative(),
    width: z.number().finite().positive(),
    height: z.number().finite().positive()
  }).strict(),
  ElementCommandSchema.extend({ type: z.literal("click") }).strict(),
  /**
   * Pointer actions a synthetic DOM event cannot stand in for. A double click
   * is two native clicks the page may read as one gesture, and a hover is a
   * pointer that arrives and stays — neither exists without a real pointer,
   * so both run on the native input backend where one is attached.
   */
  ElementCommandSchema.extend({ type: z.literal("double_click") }).strict(),
  ElementCommandSchema.extend({ type: z.literal("hover") }).strict(),
  ElementCommandSchema.extend({
    type: z.literal("type"),
    text: z.string().min(1).max(MAX_AGENT_TEXT_CHARS)
  }).strict(),
  ElementCommandSchema.extend({
    type: z.literal("clear_and_type"),
    text: z.string().max(MAX_AGENT_TEXT_CHARS)
  }).strict(),
  /**
   * Editing in place. `find` is an exact run of the target's observed value
   * that occurs once; it is replaced with `text`, which may be empty. This is
   * how a word in the middle of a document is corrected without retyping the
   * document, and how the caret is placed: at the replacement, never guessed.
   */
  ElementCommandSchema.extend({
    type: z.literal("replace_text"),
    find: z.string().min(1).max(500),
    text: z.string().max(MAX_AGENT_TEXT_CHARS)
  }).strict(),
  /**
   * A pointer drag from the element `ref` to the element `to`, both observed.
   * The destination is grounded like the source — a drop is an effect on it —
   * and the two must share a frame, since a pointer cannot be placed across
   * documents from either of them.
   */
  ElementCommandSchema.extend({
    type: z.literal("drag"),
    to: z.string().min(1)
  }).strict(),
  /**
   * A key or a combination, `Shift+Tab` or `Control+a` included; see
   * `agent-keys.ts` for the grammar. The target must already hold focus.
   */
  ElementCommandSchema.extend({
    type: z.literal("press_key"),
    key: AgentKeyCombinationSchema
  }).strict(),
  ElementCommandSchema.extend({
    type: z.literal("select"),
    value: z.string().max(2_000)
  }).strict(),
  ElementCommandSchema.extend({
    type: z.literal("check")
  }).strict(),
  ElementCommandSchema.extend({ type: z.literal("uncheck") }).strict(),
  GroundedCommandSchema.extend({
    type: z.literal("scroll"),
    container: z.boolean().optional(),
    direction: z.enum(["up", "down", "left", "right"]),
    amount: z.number().finite().positive().max(10_000).optional(),
    ref: z.string().min(1).optional()
  }).strict(),
  GroundedCommandSchema.extend({
    type: z.literal("navigate"),
    url: z.url().max(MAX_AGENT_DESTINATION_URL_CHARS)
  }).strict(),
  GroundedCommandSchema.extend({ type: z.literal("back") }).strict(),
  GroundedCommandSchema.extend({ type: z.literal("forward") }).strict(),
  GroundedCommandSchema.extend({
    type: z.literal("open_tab"),
    url: z.url().max(MAX_AGENT_DESTINATION_URL_CHARS)
  }).strict(),
  GroundedCommandSchema.extend({
    type: z.literal("switch_tab"),
    tabId: z.number().int().nonnegative()
  }).strict(),
  /**
   * Answers the native dialog `dialogId` names. `accept` is the dialog's
   * primary button — OK on an alert, OK on a confirm, Leave on a
   * beforeunload — and `false` is its dismissal, which is the safe direction
   * and the one that always exists. `promptText` is the value a `prompt`
   * accepts with; a prompt accepted without it takes the page's own default.
   *
   * The id is what makes the answer the one that was decided on: a page may
   * close one dialog and open another, and an answer that named only the tab
   * would confirm whatever is open rather than what the model read.
   */
  GroundedCommandSchema.extend({
    type: z.literal("handle_dialog"),
    dialogId: z.string().min(1).max(80),
    accept: z.boolean(),
    promptText: z.string().max(500).optional()
  }).strict(),
  /**
   * Set several controls from one decision.
   *
   * The point is the round trip, not the milliseconds: a decision costs
   * seconds and an observation costs tens of milliseconds, so ten predictable
   * fields are ten model calls and almost no browser work. Each field is
   * resolved, approved and verified exactly as the single-field command it
   * mirrors — the batch changes who asks, never what is checked.
   *
   * It stops at the first field that cannot be applied and reports what it
   * did, because a form half-filled by a run that claimed success is worse
   * than one that stopped and said where.
   */
  GroundedCommandSchema.extend({
    type: z.literal("fill_form"),
    fields: z.array(AgentFormFieldSchema).min(1).max(MAX_AGENT_FORM_FIELDS)
  }).strict(),
  /**
   * Several scoped queries answered by one walk of the document.
   *
   * `find` already reads the live page, so asking it three questions costs
   * three decisions and three walks. This asks them together: one pass
   * collects every needle, and the answer is grouped by query so the model
   * can tell which question each row belongs to. Read-only, like every other
   * member of the inspection family.
   */
  GroundedCommandSchema.extend({
    type: z.literal("extract"),
    queries: z
      .array(z.string().min(1).max(100))
      .min(1)
      .max(MAX_AGENT_EXTRACT_QUERIES)
  }).strict(),
  GroundedCommandSchema.extend({
    type: z.literal("wait"),
    condition: z.string().min(1).max(500),
    timeoutMs: z.number().int().positive().max(30_000)
  }).strict()
])
export type AgentCommand = z.infer<typeof AgentCommandSchema>
