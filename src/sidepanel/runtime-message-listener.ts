import { MESSAGE_KEYS } from "@/lib/constants/keys"
import { vectorDb } from "@/lib/embeddings/db"
import { getErrorMessage } from "@/lib/error-utils"
import { knowledgeDb } from "@/lib/knowledge/knowledge-sets"
import { flushSave } from "@/lib/sqlite/db"

type RuntimeMessage = { type?: string }

type FlushResponse =
  | { success: true }
  | { success: false; error: { status: number; message: string } }

interface SidepanelMessageDependencies {
  flush?: () => Promise<void>
  reload?: () => void
  closeDexie?: () => void
  reopenDexie?: () => void
}

const closeDexieHandles = (): void => {
  vectorDb.close()
  knowledgeDb.close()
}

const reopenDexieHandles = (): void => {
  void vectorDb.open().catch(() => undefined)
  void knowledgeDb.open().catch(() => undefined)
}

export const createSidepanelRuntimeMessageListener = (
  dependencies: SidepanelMessageDependencies = {}
) => {
  const flush = dependencies.flush ?? flushSave
  const reload = dependencies.reload ?? (() => window.location.reload())
  const closeDexie = dependencies.closeDexie ?? closeDexieHandles
  const reopenDexie = dependencies.reopenDexie ?? reopenDexieHandles

  // This listener must stay synchronous for messages it does not handle.
  // Declaring the listener `async` returns Promise<undefined> for every runtime
  // message, which claims unrelated RPC response channels before the background
  // can answer them.
  return (message: RuntimeMessage): Promise<FlushResponse> | undefined => {
    if (message.type === MESSAGE_KEYS.APP.RELOAD) {
      reload()
      return undefined
    }
    if (message.type === MESSAGE_KEYS.APP.CLOSE_DEXIE) {
      // A backup import is about to delete/recreate the Dexie databases;
      // close this context's handles so the delete is not blocked. The
      // import ends in runtime.reload(), which reopens everything fresh.
      try {
        closeDexie()
      } catch {
        // best effort — a closed or unopened handle is fine
      }
      return Promise.resolve({ success: true } as const)
    }
    if (message.type === MESSAGE_KEYS.APP.REOPEN_DEXIE) {
      // Import finished without a reload (partial failure); restore the
      // handles this context closed for the import.
      try {
        reopenDexie()
      } catch {
        // best effort
      }
      return Promise.resolve({ success: true } as const)
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
