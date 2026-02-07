import type { VectorDocument } from "@/lib/embeddings/types"
import type { ChatMessage, ChatSession, FileAttachment } from "@/types"

export interface ChatRepository {
  // Session operations
  createSession(session: ChatSession): Promise<void>
  getSession(id: string): Promise<ChatSession | undefined>
  getAllSessions(): Promise<ChatSession[]>
  updateSession(id: string, updates: Partial<ChatSession>): Promise<void>
  deleteSession(id: string): Promise<void>

  // Message operations
  getMessages(sessionId: string): Promise<ChatMessage[]>
  addMessage(sessionId: string, message: ChatMessage): Promise<number> // Returns Message ID
  updateMessage(id: number, updates: Partial<ChatMessage>): Promise<void>
  deleteMessage(id: number): Promise<void>

  // File operations
  addFile(
    file: FileAttachment & { sessionId: string; messageId?: number }
  ): Promise<number>
  getFiles(sessionId: string): Promise<FileAttachment[]>
  getFile(id: number): Promise<FileAttachment | undefined>
}

export interface VectorRepository {
  addVector(vector: VectorDocument): Promise<number>
  getVectors(filter?: Record<string, unknown>): Promise<VectorDocument[]>
  deleteVector(id: number): Promise<void>
  clearIndex(): Promise<void>
}
