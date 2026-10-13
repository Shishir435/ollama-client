/**
 * Inject one declared lifecycle fault at the first relevant decision, not by
 * sleeping. The Send trap restarts the extension's service worker at the
 * first decision after the send was committed; `restartWorker` is the
 * harness's, and a restart that fails leaves the fault not exercised, which
 * the qualification summary reports.
 */
export const injectQualificationFault = async (
  state,
  fixture,
  request,
  { restartWorker } = {}
) => {
  if (state.task.family === "traps" && state.task.variant === "send_restart") {
    if (
      state.faultInjected ||
      !state.effects.length ||
      !restartWorker ||
      !(request?.tools ?? []).some(
        (tool) => tool.function?.name === "agent_decision"
      )
    )
      return false
    state.faultInjected = await restartWorker().then(
      () => true,
      () => false
    )
    return false
  }
  if (
    state.task.family !== "lifecycle" ||
    state.faultInjected ||
    !(request?.tools ?? []).some(
      (tool) => tool.function?.name === "agent_decision"
    )
  )
    return false
  const variant = state.task.variant
  if (
    ["provider_503", "tab_close", "reload"].includes(variant) &&
    !state.effects.length
  )
    return false
  if (variant === "provider_503") {
    state.faultInjected = true
    return true
  }
  if (variant === "tab_close") await fixture.close()
  else if (variant === "reload") await fixture.reload()
  else if (variant === "stale")
    await fixture.evaluate(() => {
      const button = document.querySelector("button")
      button.replaceWith(button.cloneNode(true))
    })
  else if (variant === "interference")
    await fixture.evaluate(() => {
      const field = document.querySelector("#name")
      field.value = "Human edit"
      field.dispatchEvent(new Event("input", { bubbles: true }))
    })
  else if (variant === "ambiguous") {
    if (!state.effects.length) return false
  }
  state.faultInjected = true
  return false
}
