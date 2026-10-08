/** Inject one declared lifecycle fault at the first relevant decision, not by sleeping. */
export const injectQualificationFault = async (state, fixture, request) => {
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
