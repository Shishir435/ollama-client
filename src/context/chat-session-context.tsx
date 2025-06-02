import { createContext, useContext, useEffect, useState } from "react"

import { v4 as uuidv4 } from "uuid"

import { db, type ChatSession } from "@/lib/db"

interface ChatSessionContextValue {
  sessions: ChatSession[]
  currentSessionId: string | null
  setCurrentSessionId: (id: string) => void
  createSession: () => Promise<void>
  deleteSession: (id: string) => Promise<void>
  updateMessages: (
    id: string,
    messages: ChatSession["messages"]
  ) => Promise<void>
  renameSessionTitle: (id: string, title: string) => Promise<void>
  hasSession: boolean
}

const ChatSessionContext = createContext<ChatSessionContextValue | null>(null)

export const useChatSessions = () => {
  const context = useContext(ChatSessionContext)
  if (!context) throw new Error("useChatSessions must be used inside provider")
  return context
}

export const ChatSessionProvider = ({ children }) => {
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)

  useEffect(() => {
    const loadSessions = async () => {
      const all = await db.sessions.orderBy("updatedAt").reverse().toArray()
      setSessions(all)
      if (!currentSessionId && all.length > 0) {
        setCurrentSessionId(all[0].id)
      }
    }
    loadSessions()
  }, [])
  const hasSession = currentSessionId !== null

  const createSession = async () => {
    const id = uuidv4()
    const now = Date.now()
    const newSession: ChatSession = {
      id,
      title: "New Chat",
      createdAt: now,
      updatedAt: now,
      messages: []
    }
    await db.sessions.add(newSession)
    setSessions((prev) => [newSession, ...prev])
    setCurrentSessionId(id)
  }

  const deleteSession = async (id: string) => {
    await db.sessions.delete(id)
    const remaining = sessions.filter((s) => s.id !== id)
    setSessions(remaining)
    if (currentSessionId === id && remaining.length > 0) {
      setCurrentSessionId(remaining[0].id)
    } else if (remaining.length === 0) {
      setCurrentSessionId(null)
    }
  }

  const renameSessionTitle = async (id: string, title: string) => {
    await db.sessions.update(id, { title })
    setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, title } : s)))
  }

  const updateMessages = async (
    id: string,
    messages: ChatSession["messages"]
  ) => {
    const updatedAt = Date.now()
    await db.sessions.update(id, { messages, updatedAt })
    setSessions((prev) =>
      prev.map((s) => (s.id === id ? { ...s, messages, updatedAt } : s))
    )
  }

  return (
    <ChatSessionContext.Provider
      value={{
        sessions,
        currentSessionId,
        setCurrentSessionId,
        createSession,
        deleteSession,
        updateMessages,
        renameSessionTitle,
        hasSession
      }}>
      {children}
    </ChatSessionContext.Provider>
  )
}
