import { MESSAGE_KEYS } from "@/lib/constants/keys"
import { getErrorMessage } from "@/lib/error-utils"
import { flushSave } from "@/lib/sqlite/db"

type RuntimeMessage = { type?: string }

type FlushResponse =
  | { success: true }
  | { success: false; error: { status: number; message: string } }

interface SidepanelMessageDependencies {
  flush?: () => Promise<void>
  reload?: () => void
}

export const createSidepanelRuntimeMessageListener = (
  dependencies: SidepanelMessageDependencies = {}
) => {
  const flush = dependencies.flush ?? flushSave
  const reload = dependencies.reload ?? (() => window.location.reload())

  // This listener must stay synchronous for messages it does not handle.
  // Declaring the listener `async` returns Promise<undefined> for every runtime
  // message, which claims unrelated RPC response channels before the background
  // can answer them.
  return (message: RuntimeMessage): Promise<FlushResponse> | undefined => {
    if (message.type === MESSAGE_KEYS.APP.RELOAD) {
      reload()
      return undefined
    }
    if (message.type !== MESSAGE_KEYS.APP.FLUSH_SQLITE) return undefined

    return flush()
      .then(() => ({ success: true }) as const)
      .catch((error) => ({
        success: false as const,
        error: {
          status: 0,
          message: getErrorMessage(error)
        }
      }))
  }
}
