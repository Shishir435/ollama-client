/**
 * Sending a benchmark task through the side panel's composer, and knowing it
 * was sent.
 *
 * A missing "Stop generation" button is not a finished turn. Between a run
 * settling and the chat model streaming its answer about it, and between a
 * tool result and the next model call, the button can be briefly absent
 * while the turn is still going. An Enter pressed in that gap is ignored by
 * the composer, and the case it was meant to start was scored as a timeout
 * that never began. So the panel has to be idle for a whole window, not for
 * one read, and a send counts only once a turn visibly started.
 */

export const CHAT_LABELS = {
  stop: "Stop generation",
  send: "Send message",
  composer: "Type a message or ctrl + /"
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Resolves true once `holds(state)` has been true for `stableMs` straight,
 * or false at `timeoutMs`. A read that throws counts as not holding.
 */
export const waitForChatState = async (
  read,
  holds,
  { stableMs = 0, timeoutMs, pollMs = 250, now = Date.now, wait = sleep }
) => {
  const deadline = now() + timeoutMs
  let since
  for (;;) {
    const state = await read().catch(() => undefined)
    if (state && holds(state)) {
      since ??= now()
      if (now() - since >= stableMs) return true
    } else {
      since = undefined
    }
    if (now() >= deadline) return false
    await wait(pollMs)
  }
}

const chatIdle = (state) => !state.busy && state.sendReady

/**
 * `goalTurns` counts rows showing the goal's own text: the user's message
 * appears there as soon as the composer accepts it, before any model answers.
 */
export const readChatTurn = async (panel, goal) => {
  const [busy, sendReady, goalTurns] = await Promise.all([
    panel.getByRole("button", { name: CHAT_LABELS.stop, exact: true }).count(),
    panel.getByRole("button", { name: CHAT_LABELS.send, exact: true }).count(),
    panel.getByText(goal, { exact: true }).count()
  ])
  return { busy: busy > 0, sendReady: sendReady > 0, goalTurns }
}

/**
 * Waits for the previous turn to finish, stopping it if it will not, then
 * sends `goal` and confirms a turn started. A second Enter is pressed only
 * when the first left no trace at all — no row with the goal, no generation —
 * so it cannot send the task twice.
 *
 * Returns `{ started, attempts }`. `started: false` is a result for the
 * caller to score, not an error: the case never began.
 */
export const sendChatTask = async (
  panel,
  goal,
  {
    idleMs = 1500,
    /**
     * Long enough for a chat answer about a finished run; a turn still busy
     * after this is held by something the case already left, and is stopped.
     */
    idleTimeoutMs = 45_000,
    startTimeoutMs = 15_000,
    read = () => readChatTurn(panel, goal),
    log = console.warn
  } = {}
) => {
  const idle = await waitForChatState(read, chatIdle, {
    stableMs: idleMs,
    timeoutMs: idleTimeoutMs
  })
  if (!idle) {
    log(
      `[benchmark] previous turn still generating; stopping it before: ${goal}`
    )
    await panel
      .getByRole("button", { name: CHAT_LABELS.stop, exact: true })
      .click()
      .catch(() => {})
    const stopped = await waitForChatState(read, chatIdle, {
      stableMs: idleMs,
      timeoutMs: 30_000
    })
    if (!stopped)
      throw new Error("The previous chat turn did not stop; aborting the pass")
  }
  const before = (await read()).goalTurns
  const composer = panel.getByPlaceholder(CHAT_LABELS.composer)
  for (let attempts = 1; attempts <= 2; attempts += 1) {
    await composer.fill(goal)
    await composer.press("Enter")
    const started = await waitForChatState(
      read,
      (state) => state.busy || state.goalTurns > before,
      { timeoutMs: startTimeoutMs }
    )
    if (started) return { started: true, attempts }
    log(
      `[benchmark] composer did not accept the task (try ${attempts}): ${goal}`
    )
  }
  return { started: false, attempts: 2 }
}

/** Run statuses after which nothing more will happen without the user. */
export const SETTLED_RUN_STATUSES = ["completed", "failed", "cancelled"]

/**
 * A chat request is one that offered `browser_task`; the agent's own decision
 * calls never do. The chat's answer is the content its last such call
 * streamed, read from the recorded wire rather than the panel's markup.
 */
export const chatAnswerFromWire = (wire) => {
  const chatCalls = wire.filter(
    (rec) =>
      rec.path?.endsWith("/chat/completions") &&
      JSON.stringify(rec.request?.tools ?? []).includes("browser_task")
  )
  const last = chatCalls.at(-1)
  if (!last?.response) return ""
  let text = ""
  for (const line of last.response.split("\n")) {
    if (!line.startsWith("data: ") || line === "data: [DONE]") continue
    try {
      const content = JSON.parse(line.slice(6)).choices?.[0]?.delta?.content
      if (typeof content === "string") text += content
    } catch {
      /** A partial line from a cut stream carries nothing to score. */
    }
  }
  return text.trim()
}

/**
 * A run left paused or mid-flight holds the chat turn that delegated it, and
 * the next task's `browser_task` then starts nothing. Stopped here so each
 * case begins with no run open.
 */
export const stopOpenRun = async (panel, snapshot) => {
  const run = snapshot?.run
  if (!run || SETTLED_RUN_STATUSES.includes(run.status)) return false
  await panel.evaluate(
    (runId) => window.auditPort?.postMessage({ type: "agent_stop", runId }),
    run.id
  )
  return true
}

/**
 * Every chat completion at the effort `AUDIT_REASONING_EFFORT` names, set on
 * the forwarded body whatever the extension asked for, so a pass measures
 * one model at one effort. Unset, the body is forwarded untouched.
 */
export const withReasoningEffort = (
  path,
  body,
  effort = process.env.AUDIT_REASONING_EFFORT
) => {
  if (!effort || !path.endsWith("/chat/completions")) return body
  try {
    const parsed = JSON.parse(body)
    delete parsed.reasoning
    return JSON.stringify({ ...parsed, reasoning_effort: effort })
  } catch {
    return body
  }
}

/** Clicks a pending chat tool approval, if one is showing. */
export const approveChatTools = (panel) =>
  panel
    .getByRole("button", { name: /^Allow (for this chat|once)$/ })
    .first()
    .click({ timeout: 250 })
    .then(
      () => true,
      () => false
    )
