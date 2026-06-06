import { create } from "zustand"

import type { ChatSessionState } from "@/types"

import { createChatSessionListActions } from "./chat-session-list-actions"
import { createChatSessionMessageActions } from "./chat-session-message-actions"

export const chatSessionStore = create<ChatSessionState>((set, get) => ({
  sessions: [],
  currentSessionId: null,
  hasSession: false,
  hydrated: false,
  highlightedMessage: null,
  hasMoreMessages: false,
  ...createChatSessionListActions(set, get),
  ...createChatSessionMessageActions(set, get)
}))

export { useChatSessions } from "./chat-session-selectors"
