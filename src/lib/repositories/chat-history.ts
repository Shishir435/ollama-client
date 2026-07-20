import * as sqliteRepo from "./sqlite-chat-history"

/**
 * SQLite-only chat-history facade.
 *
 * Dexie chat-history fallback has been retired. Vector and knowledge
 * databases still use Dexie separately; chat sessions/messages/files
 * route only through SQLite now.
 */

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
export const appendMessage = sqliteRepo.appendMessage
export const updateMessage = sqliteRepo.updateMessage
export const finalizeInterruptedMessages =
  sqliteRepo.finalizeInterruptedMessages
export const touchMessageActivity = sqliteRepo.touchMessageActivity
export const deleteMessagesBySession = sqliteRepo.deleteMessagesBySession
export const bulkDeleteMessages = sqliteRepo.bulkDeleteMessages

export const getFilesByMessageIds = sqliteRepo.getFilesByMessageIds
export const bulkAddFiles = sqliteRepo.bulkAddFiles
export const deleteFilesBySession = sqliteRepo.deleteFilesBySession
export const deleteFilesByMessageIds = sqliteRepo.deleteFilesByMessageIds

export const dropDatabase = sqliteRepo.dropDatabase
