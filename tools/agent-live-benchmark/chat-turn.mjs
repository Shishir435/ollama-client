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
    idleTimeoutMs = 120_000,
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
