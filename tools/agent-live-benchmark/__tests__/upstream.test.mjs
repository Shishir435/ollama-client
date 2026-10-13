import assert from "node:assert/strict"
import { test } from "node:test"
import {
  backoffDelay,
  createAttemptScope,
  fetchWithBackoff,
  waitForProvider
} from "../upstream.mjs"

const reply = (status, headers = {}) =>
  new Response(status === 200 ? "ok" : "busy", { status, headers })

/** A fetch that answers from a script and records what it was asked. */
const scripted = (...answers) => {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url, init })
    const next = answers.shift()
    if (next instanceof Error) throw next
    return next
  }
  return { calls, fetchImpl }
}

test("a provider 503 is retried before anything reaches the extension", async () => {
  const waits = []
  const { calls, fetchImpl } = scripted(reply(503), reply(429), reply(200))
  const { response, retries } = await fetchWithBackoff(
    "http://upstream/v1/chat/completions",
    { method: "POST" },
    { fetchImpl, wait: async (ms) => waits.push(ms) }
  )
  assert.equal(response.status, 200)
  assert.equal(retries, 2)
  assert.equal(calls.length, 3)
  assert.deepEqual(waits, [2000, 4000])
})

test("Retry-After is honoured, and capped", () => {
  assert.equal(backoffDelay(1, "3"), 3000)
  assert.equal(backoffDelay(1, "600"), 30_000)
  assert.equal(backoffDelay(3, undefined), 8000)
  assert.equal(backoffDelay(9, " "), 30_000)
})

test("a client error is the extension's to see, not retried", async () => {
  const { calls, fetchImpl } = scripted(reply(400))
  const { response, retries } = await fetchWithBackoff(
    "http://upstream",
    {},
    { fetchImpl, wait: async () => {} }
  )
  assert.equal(response.status, 400)
  assert.equal(retries, 0)
  assert.equal(calls.length, 1)
})

test("retries are bounded; the last answer is passed on", async () => {
  const { calls, fetchImpl } = scripted(reply(503), reply(503), reply(503))
  const { response, retries } = await fetchWithBackoff(
    "http://upstream",
    {},
    { retries: 2, fetchImpl, wait: async () => {} }
  )
  assert.equal(response.status, 503)
  assert.equal(retries, 2)
  assert.equal(calls.length, 3)
})

test("a network error is retried, but an aborted attempt is not", async () => {
  const flaky = scripted(new TypeError("fetch failed"), reply(200))
  const { response } = await fetchWithBackoff(
    "http://upstream",
    {},
    { fetchImpl: flaky.fetchImpl, wait: async () => {} }
  )
  assert.equal(response.status, 200)

  const scope = createAttemptScope()
  scope.abort()
  scope.abort()
  const aborted = scripted(new DOMException("aborted", "AbortError"))
  await assert.rejects(
    fetchWithBackoff(
      "http://upstream",
      { signal: scope.signal },
      { fetchImpl: aborted.fetchImpl, wait: async () => {} }
    )
  )
  assert.equal(aborted.calls.length, 1)
})

test("an attempt that ends during a back-off wait does not ask again", async () => {
  const scope = createAttemptScope()
  const { calls, fetchImpl } = scripted(reply(503), reply(200))
  await assert.rejects(
    fetchWithBackoff(
      "http://upstream",
      { signal: scope.signal },
      { fetchImpl, wait: async () => scope.abort() }
    )
  )
  assert.equal(calls.length, 1)
})

test("an attempt waits for a provider that comes back, and gives up on one that doesn't", async () => {
  let clock = 0
  const timing = {
    now: () => clock,
    wait: async (ms) => {
      clock += ms
    }
  }
  const back = scripted(reply(503), new TypeError("down"), reply(200))
  assert.equal(
    await waitForProvider(
      "http://upstream",
      {},
      {
        ...timing,
        fetchImpl: back.fetchImpl
      }
    ),
    true
  )
  assert.equal(back.calls[0].url, "http://upstream/v1/models")
  /** A proxy without a model listing is up, not down. */
  assert.equal(
    await waitForProvider(
      "http://upstream",
      {},
      { ...timing, fetchImpl: async () => reply(404) }
    ),
    true
  )

  clock = 0
  const gone = { fetchImpl: async () => reply(503) }
  assert.equal(
    await waitForProvider(
      "http://upstream",
      {},
      {
        ...timing,
        ...gone,
        timeoutMs: 60_000
      }
    ),
    false
  )
  assert.ok(clock >= 60_000)
})
