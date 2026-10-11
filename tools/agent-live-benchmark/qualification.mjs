/** Uses the existing chat → browser_task → controller runner, with a frozen controlled corpus. */
if (!process.env.AUDIT_MODEL)
  throw new Error("Set AUDIT_MODEL to the designated capable model")
process.env.AUDIT_SUITE = "qualification"
process.env.AUDIT_SPLIT ??= "development"
await import("./synthetic.mjs")
