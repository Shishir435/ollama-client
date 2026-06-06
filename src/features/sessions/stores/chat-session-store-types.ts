import type { StateCreator } from "zustand"

import type { ChatSessionState } from "@/types"

export type ChatSessionSet = Parameters<StateCreator<ChatSessionState>>[0]
export type ChatSessionGet = Parameters<StateCreator<ChatSessionState>>[1]
