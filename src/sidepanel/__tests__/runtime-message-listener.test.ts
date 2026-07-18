import { describe, expect, it, vi } from "vitest"
import { MESSAGE_KEYS } from "@/lib/constants/keys"
import { RPC_REQUEST_MESSAGE_TYPE } from "@/protocol/rpc"

import { createSidepanelRuntimeMessageListener } from "../runtime-message-listener"

describe("sidepanel runtime message listener", () => {
  it("does not claim provider RPC response channels", () => {
    const listener = createSidepanelRuntimeMessageListener()

    expect(listener({ type: RPC_REQUEST_MESSAGE_TYPE })).toBeUndefined()
  })

  it("responds only to the SQLite flush message", async () => {
    const flush = vi.fn().mockResolvedValue(undefined)
    const listener = createSidepanelRuntimeMessageListener({ flush })

    await expect(
      listener({ type: MESSAGE_KEYS.APP.FLUSH_SQLITE })
    ).resolves.toEqual({ success: true })
    expect(flush).toHaveBeenCalledOnce()
  })

  it("reports flush failures without throwing transport errors", async () => {
    const listener = createSidepanelRuntimeMessageListener({
      flush: vi.fn().mockRejectedValue(new Error("disk unavailable"))
    })

    await expect(
      listener({ type: MESSAGE_KEYS.APP.FLUSH_SQLITE })
    ).resolves.toEqual({
      success: false,
      error: { status: 0, message: "disk unavailable" }
    })
  })
})
