export const MAX_AGENT_REQUIREMENTS = 8
export const MAX_AGENT_REQUIREMENT_CHARS = 200
export const MAX_AGENT_REQUIREMENT_ID_CHARS = 8
/** The goal text an entry quotes as its reason to exist. */
export const MAX_AGENT_REQUIREMENT_SOURCE_CHARS = 200
/** Repeated items one requirement may enumerate, and how long each may be. */
export const MAX_AGENT_REQUIREMENT_ITEMS = 12
export const MAX_AGENT_REQUIREMENT_ITEM_CHARS = 80
/**
 * Items across the whole plan. The plan rides every decision prompt and every
 * checkpoint, so its enumeration is bounded as a whole, not only per entry.
 */
export const MAX_AGENT_PLAN_ITEMS = 24
export const MAX_AGENT_CONSTRAINTS = 8
/** How much of a planner's stated limitation the failed run keeps. */
export const MAX_AGENT_PLAN_LIMITATION_CHARS = 1_000
/** Amendments a run records; each one is a user answer the plan absorbed. */
export const MAX_AGENT_PLAN_AMENDMENTS = 10
