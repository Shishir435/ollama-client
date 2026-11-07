/**
 * What a pass has spent upstream, and the cap that stops it.
 *
 * A live pass pays per token. The cap is checked between requests; remaining
 * attempts stay counted as void. An already admitted request may cross the
 * cap, so a strict dollar ceiling also needs a provider-side spending limit.
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
  let incompleteTokens = 0
  let costUsd
  for (const record of wire ?? []) {
    if (!record.path?.endsWith("/chat/completions") || record.injected) continue
    const usage = usageFrames(record.response).at(-1)
    if (!usage) {
      /** An answered call with no usage still cost something unknown. */
      unreported += 1 + (record.retries ?? 0)
      continue
    }
    unreported += record.retries ?? 0
    const prompt = finite(usage.prompt_tokens)
    const completion = finite(usage.completion_tokens)
    if (prompt === undefined || completion === undefined) incompleteTokens += 1
    tokens += (prompt ?? 0) + (completion ?? 0)
    const cost = finite(usage.cost)
    if (cost !== undefined) costUsd = (costUsd ?? 0) + cost
    else uncosted += 1
  }
  return {
    tokens,
    unreported,
    uncosted,
    ...(incompleteTokens ? { incompleteTokens } : {}),
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
      if (usage.incompleteTokens > 0) spent.tokensUnknown = true
      if (usage.unreported > 0) {
        spent.tokensUnknown = true
        spent.costUnknown = true
      }
      if (usage.uncosted > 0) spent.costUnknown = true
      if (usage.costUsd === undefined) {
        if (usage.tokens > 0) spent.costUnknown = true
      } else spent.costUsd += usage.costUsd
    },
    withinCaps() {
      return (
        (maxTokens === undefined ||
          (!spent.tokensUnknown && spent.tokens <= maxTokens)) &&
        (maxCostUsd === undefined ||
          (!spent.costUnknown && spent.costUsd <= maxCostUsd))
      )
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
 * Request streaming token accounting when capped. OpenRouter additionally
 * needs its own usage flag for cost. Missing accounting still stops the pass;
 * in particular, olc cannot report the cost of a parked Codex tool call.
 */
export const withUsageAccounting = (path, body, upstream, caps) => {
  if (
    !path.endsWith("/chat/completions") ||
    (caps?.maxTokens === undefined && caps?.maxCostUsd === undefined)
  )
    return body
  try {
    const request = JSON.parse(body)
    const tokenAccounting = request.stream === true
    const costAccounting =
      caps?.maxCostUsd !== undefined &&
      new URL(upstream).hostname === "openrouter.ai"
    if (!tokenAccounting && !costAccounting) return body
    return JSON.stringify({
      ...request,
      ...(tokenAccounting
        ? { stream_options: { ...request.stream_options, include_usage: true } }
        : {}),
      ...(costAccounting ? { usage: { ...request.usage, include: true } } : {})
    })
  } catch {
    return body
  }
}

/** Charges finished or cancelled wire records once, so caps apply between requests. */
export const createWireUsageBudget = (caps) => {
  const budget = createUsageBudget(caps)
  const accounted = new WeakSet()
  const charge = (record) => {
    if (!record || accounted.has(record)) return
    accounted.add(record)
    budget.add(wireUsage([record]))
  }
  return { ...budget, charge, settle: (wire) => wire.forEach(charge) }
}
