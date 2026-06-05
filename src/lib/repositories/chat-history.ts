import * as sqliteRepo from "./sqlite-chat-history"

/**
 * SQLite-only chat-history facade.
 *
 * Dexie chat-history fallback has been retired. Vector and knowledge
 * databases still use Dexie separately; chat sessions/messages/files
 * route only through SQLite now.
 */

export type ChatHistoryBackend = "sqlite"

export const getActiveBackend = (): ChatHistoryBackend => "sqlite"

export const initChatHistoryBackend = async (): Promise<ChatHistoryBackend> =>
  "sqlite"

export const setActiveBackend = async (
  backend: ChatHistoryBackend,
  _options?: { persist?: boolean }
): Promise<void> => {
  if (backend !== "sqlite") {
    throw new Error(`Unsupported chat history backend: ${backend}`)
  }
}

export const getAllSessionsOrderedByRecency =
  sqliteRepo.getAllSessionsOrderedByRecency
export const getAllSessions = sqliteRepo.getAllSessions
export const getSession = sqliteRepo.getSession
export const getLatestSession = sqliteRepo.getLatestSession
export const addSession = sqliteRepo.addSession
export const bulkPutSessions = sqliteRepo.bulkPutSessions
export const updateSession = sqliteRepo.updateSession
export const deleteSessionRow = sqliteRepo.deleteSessionRow

export const getMessage = sqliteRepo.getMessage
export const countMessages = sqliteRepo.countMessages
export const getAllMessages = sqliteRepo.getAllMessages
export const getMessagesPaginated = sqliteRepo.getMessagesPaginated
export const getMessagesBySessionOrderedByTimestamp =
  sqliteRepo.getMessagesBySessionOrderedByTimestamp
export const getMessagesBySession = sqliteRepo.getMessagesBySession
export const getMessagesBySessionAtTimestamp =
  sqliteRepo.getMessagesBySessionAtTimestamp
export const getMessagesByParents = sqliteRepo.getMessagesByParents
export const getRootMessagesForSession = sqliteRepo.getRootMessagesForSession
export const addMessage = sqliteRepo.addMessage
export const updateMessage = sqliteRepo.updateMessage
export const deleteMessagesBySession = sqliteRepo.deleteMessagesBySession
export const bulkDeleteMessages = sqliteRepo.bulkDeleteMessages

export const getFilesByMessageIds = sqliteRepo.getFilesByMessageIds
export const bulkAddFiles = sqliteRepo.bulkAddFiles
export const deleteFilesBySession = sqliteRepo.deleteFilesBySession
export const deleteFilesByMessageIds = sqliteRepo.deleteFilesByMessageIds

export const dropDatabase = sqliteRepo.dropDatabase
