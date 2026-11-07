import assert from "node:assert/strict"
import { test } from "node:test"
import {
  createUsageBudget,
  createWireUsageBudget,
  usageCapsFromEnv,
  wireUsage,
  withUsageAccounting
} from "../usage.mjs"

const stream = (...usages) =>
  [
    'data: {"choices":[{"delta":{"content":"hi"}}]}',
    ...usages.map((usage) => `data: ${JSON.stringify({ usage })}`),
    "data: [DONE]"
  ].join("\n")
const call = (response, extra = {}) => ({
  path: "/v1/chat/completions",
  status: 200,
  response,
  ...extra
})

test("usage is read from each response's last usage frame", () => {
  const usage = wireUsage([
    call(
      stream(
        { prompt_tokens: 10, completion_tokens: 1 },
        { prompt_tokens: 10, completion_tokens: 5, cost: 0.002 }
      )
    ),
    call(JSON.stringify({ usage: { prompt_tokens: 3, completion_tokens: 2 } })),
    { path: "/v1/models", status: 200, response: "{}" }
  ])
  assert.deepEqual(usage, {
    tokens: 20,
    unreported: 0,
    uncosted: 1,
    costUsd: 0.002
  })
})

test("one priced call cannot hide another call's unknown cost", () => {
  const budget = createUsageBudget({ maxCostUsd: 1 })
  budget.add({ tokens: 20, unreported: 0, uncosted: 1, costUsd: 0.002 })
  assert.equal(budget.spent.costUnknown, true)
  assert.equal(budget.exceeded(), true)
})

test("an answered call with no usage is counted as unreported; injected faults cost nothing", () => {
  assert.deepEqual(
    wireUsage([
      call(stream()),
      call("", { status: 503, injected: true }),
      call("", { status: 502 })
    ]),
    { tokens: 0, unreported: 2, uncosted: 0 }
  )
})

test("caps come from the environment and refuse an empty or negative value", () => {
  assert.deepEqual(usageCapsFromEnv({}), {})
  assert.deepEqual(
    usageCapsFromEnv({ AUDIT_MAX_COST_USD: "0.5", AUDIT_MAX_TOKENS: "1000" }),
    { maxCostUsd: 0.5, maxTokens: 1000 }
  )
  assert.throws(() => usageCapsFromEnv({ AUDIT_MAX_COST_USD: " " }))
  assert.throws(() => usageCapsFromEnv({ AUDIT_MAX_TOKENS: "-1" }))
  assert.throws(() => usageCapsFromEnv({ AUDIT_MAX_COST_USD: "lots" }))
})

test("the budget stops at the cap, and with no cap never stops", () => {
  const capped = createUsageBudget({ maxCostUsd: 0.01 })
  capped.add({ tokens: 100, unreported: 0, costUsd: 0.006 })
  assert.equal(capped.exceeded(), false)
  capped.add({ tokens: 100, unreported: 0, costUsd: 0.005 })
  assert.equal(capped.exceeded(), true)

  const tokens = createUsageBudget({ maxTokens: 150 })
  tokens.add({ tokens: 100, unreported: 0 })
  assert.equal(tokens.exceeded(), false)
  tokens.add({ tokens: 60, unreported: 0 })
  assert.equal(tokens.exceeded(), true)

  const open = createUsageBudget()
  open.add({ tokens: 1e9, unreported: 3 })
  assert.equal(open.exceeded(), false)
})

test("a cap that cannot be checked counts as reached", () => {
  const cost = createUsageBudget({ maxCostUsd: 10 })
  cost.add({ tokens: 50, unreported: 0 })
  assert.equal(cost.exceeded(), true)

  const tokens = createUsageBudget({ maxTokens: 1e6 })
  tokens.add({ tokens: 0, unreported: 1 })
  assert.equal(tokens.exceeded(), true)
})

test("only OpenRouter chat completions are asked to report cost, and only under a cost cap", () => {
  const body = JSON.stringify({ model: "m", messages: [] })
  const caps = { maxCostUsd: 1 }
  const asked = JSON.parse(
    withUsageAccounting(
      "/v1/chat/completions",
      body,
      "https://openrouter.ai/api",
      caps
    )
  )
  assert.deepEqual(asked.usage, { include: true })
  assert.equal(
    withUsageAccounting(
      "/v1/chat/completions",
      body,
      "https://example.test",
      caps
    ),
    body
  )
  assert.equal(
    withUsageAccounting(
      "/v1/chat/completions",
      body,
      "https://openrouter.ai/api",
      {}
    ),
    body
  )
  assert.equal(
    withUsageAccounting("/v1/models", body, "https://openrouter.ai/api", caps),
    body
  )
})

test("a capped stream requests tokens and preserves other streaming options", () => {
  const body = JSON.stringify({
    stream: true,
    stream_options: { other: true },
    messages: []
  })
  for (const caps of [{ maxTokens: 100 }, { maxCostUsd: 1 }]) {
    const asked = JSON.parse(
      withUsageAccounting(
        "/v1/chat/completions",
        body,
        "http://127.0.0.1:8083",
        caps
      )
    )
    assert.deepEqual(asked.stream_options, { other: true, include_usage: true })
    assert.equal(asked.usage, undefined)
  }
  assert.equal(
    withUsageAccounting(
      "/v1/chat/completions",
      body,
      "http://127.0.0.1:8083",
      {}
    ),
    body
  )
})

test("a request is charged once and blocks the next call before the task ends", () => {
  const budget = createWireUsageBudget({ maxCostUsd: 0.01 })
  const first = call(
    stream({ prompt_tokens: 10, completion_tokens: 2, cost: 0.006 })
  )
  budget.charge(first)
  budget.settle([first])
  assert.equal(budget.spent.costUsd, 0.006)
  assert.equal(budget.exceeded(), false)
  const second = call(
    stream({ prompt_tokens: 10, completion_tokens: 2, cost: 0.005 })
  )
  budget.charge(second)
  assert.equal(budget.exceeded(), true)
  budget.settle([first, second])
  assert.equal(budget.spent.tokens, 24)
})

test("failed retries cannot hide unknown spend behind the successful response", () => {
  const budget = createWireUsageBudget({ maxCostUsd: 1 })
  budget.charge(
    call(stream({ prompt_tokens: 1, completion_tokens: 2, cost: 0.001 }), {
      retries: 1
    })
  )
  assert.equal(budget.spent.costUnknown, true)
  assert.equal(budget.exceeded(), true)
})

test("partial token counts cannot satisfy a token cap, while reported cost remains usable", () => {
  const record = call(stream({ completion_tokens: 2, cost: 0.001 }))
  const tokens = createWireUsageBudget({ maxTokens: 100 })
  tokens.charge(record)
  assert.equal(tokens.exceeded(), true)
  const cost = createWireUsageBudget({ maxCostUsd: 1 })
  cost.charge(record)
  assert.equal(cost.exceeded(), false)
  assert.equal(cost.spent.costUnknown, false)
})

test("a final in-flight overshoot or unknown accounting cannot pass cap validation", () => {
  const budget = createWireUsageBudget({ maxCostUsd: 0.01 })
  budget.charge(
    call(stream({ prompt_tokens: 10, completion_tokens: 2, cost: 0.02 }))
  )
  assert.equal(budget.withinCaps(), false)
  const unknown = createWireUsageBudget({ maxTokens: 100 })
  unknown.charge(call(stream()))
  assert.equal(unknown.withinCaps(), false)
  assert.equal(createWireUsageBudget().withinCaps(), true)
})
