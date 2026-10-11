/** A bounded navigation wait expired; the page may have handled the form in place. */
export class AgentNavigationTimeoutError extends Error {
  constructor() {
    super("Agent navigation did not settle")
    this.name = "AgentNavigationTimeoutError"
  }
}
