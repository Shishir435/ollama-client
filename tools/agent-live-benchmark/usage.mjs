/**
 * What a pass has spent upstream, and the cap that stops it.
 *
 * A live pass pays per token. The cap is checked between attempts: once the
 * provider-reported usage so far reaches it, every remaining attempt is
 * recorded as not run rather than started, so a scheduled pass cannot spend
 * past what its owner set aside.
 */

/** The usage objects a recorded response carries, streamed or not. */
const usageFrames = (response) => {
  const text = String(response ?? "")
  if (!text.includes("data: ")) {
    try {
      const usage = JSON.parse(text)?.usage
      return usage ? [usage] : []
    } catch {
      return []
    }
  }
  const frames = []
  for (const line of text.split("\n")) {
    if (!line.startsWith("data: ") || line === "data: [DONE]") continue
    try {
      const usage = JSON.parse(line.slice(6))?.usage
      if (usage) frames.push(usage)
    } catch {
      /** A cut stream's partial line carries no usage. */
    }
  }
  return frames
}

const finite = (value) =>
  Number.isFinite(value) && value >= 0 ? value : undefined

/**
 * Provider-reported usage across every chat completion in `wire`. Only the
 * last usage frame of a response counts, since streams repeat a running
 * total. `unreported` counts answered calls that reported no usage at all,
 * and `uncosted` calls that reported tokens but no cost, so one priced call
 * cannot hide another's unknown cost.
 * `costUsd` is present only when the provider reported a cost (as OpenRouter
 * does in `usage.cost`); it is never estimated from token counts. A fault the
 * harness injected never reached the provider and costs nothing.
 */
export const wireUsage = (wire) => {
  let tokens = 0
  let unreported = 0
  let uncosted = 0
  let costUsd
  for (const record of wire ?? []) {
    if (!record.path?.endsWith("/chat/completions") || record.injected) continue
    const usage = usageFrames(record.response).at(-1)
    if (!usage) {
      /** An answered call with no usage still cost something unknown. */
      if (record.status === 200) unreported += 1
      continue
    }
    tokens +=
      (finite(usage.prompt_tokens) ?? 0) +
      (finite(usage.completion_tokens) ?? 0)
    const cost = finite(usage.cost)
    if (cost !== undefined) costUsd = (costUsd ?? 0) + cost
    else uncosted += 1
  }
  return {
    tokens,
    unreported,
    uncosted,
    ...(costUsd === undefined ? {} : { costUsd })
  }
}

/**
 * Reads `AUDIT_MAX_COST_USD` and `AUDIT_MAX_TOKENS`. Unset means no cap; a
 * value that is set but not a non-negative number stops the pass before it
 * starts, since an empty shell variable must not become a cap of zero.
 */
export const usageCapsFromEnv = (env = process.env) => {
  const read = (name) => {
    const raw = env[name]
    if (raw === undefined) return undefined
    const value = Number(raw)
    if (!String(raw).trim() || !Number.isFinite(value) || value < 0)
      throw new Error(`${name} takes a non-negative number`)
    return value
  }
  const maxCostUsd = read("AUDIT_MAX_COST_USD")
  const maxTokens = read("AUDIT_MAX_TOKENS")
  return {
    ...(maxCostUsd === undefined ? {} : { maxCostUsd }),
    ...(maxTokens === undefined ? {} : { maxTokens })
  }
}

/**
 * A running total against the caps. A cap that cannot be checked counts as
 * reached: a call that reported no usage leaves both totals unknown, and
 * tokens reported without a cost leave the cost unknown. A pass that cannot
 * tell what it spent does not keep spending.
 */
export const createUsageBudget = ({ maxCostUsd, maxTokens } = {}) => {
  const spent = {
    tokens: 0,
    costUsd: 0,
    tokensUnknown: false,
    costUnknown: false
  }
  return {
    spent,
    add(usage) {
      spent.tokens += usage.tokens ?? 0
      if (usage.unreported > 0) {
        spent.tokensUnknown = true
        spent.costUnknown = true
      }
      if (usage.uncosted > 0) spent.costUnknown = true
      if (usage.costUsd === undefined) {
        if (usage.tokens > 0) spent.costUnknown = true
      } else spent.costUsd += usage.costUsd
    },
    exceeded() {
      if (
        maxTokens !== undefined &&
        (spent.tokensUnknown || spent.tokens >= maxTokens)
      )
        return true
      return (
        maxCostUsd !== undefined &&
        (spent.costUnknown || spent.costUsd >= maxCostUsd)
      )
    }
  }
}

/**
 * OpenRouter reports a request's cost only when asked, through
 * `usage: { include: true }`. Added to chat completions sent to it, and only
 * to it, when a cost cap is set: another provider may reject a field it does
 * not know. Any other body is forwarded untouched.
 */
export const withUsageAccounting = (path, body, upstream, caps) => {
  if (
    caps?.maxCostUsd === undefined ||
    !path.endsWith("/chat/completions") ||
    new URL(upstream).hostname !== "openrouter.ai"
  )
    return body
  try {
    return JSON.stringify({ ...JSON.parse(body), usage: { include: true } })
  } catch {
    return body
  }
}
