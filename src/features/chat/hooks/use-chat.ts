import { useStorage } from "@plasmohq/storage/hook"
import { useEffect, useMemo, useRef } from "react"
import { useChatConfig } from "@/features/chat/hooks/use-chat-config"
import { useChatResponse } from "@/features/chat/hooks/use-chat-response"
import { useChatSessionLifecycle } from "@/features/chat/hooks/use-chat-session-lifecycle"
import { useChatStreaming } from "@/features/chat/hooks/use-chat-streaming"
import { useChatTurnController } from "@/features/chat/hooks/use-chat-turn-controller"
import { useChatInput } from "@/features/chat/stores/chat-input-store"
import { useLoadStream } from "@/features/chat/stores/load-stream-store"
import { useChatSessions } from "@/features/sessions/stores/chat-session-store"
import { useOpenTabs } from "@/features/tabs/hooks/use-open-tab"
import { useSelectedTabs } from "@/features/tabs/stores/selected-tabs-store"
import { useTabContent } from "@/features/tabs/stores/tab-content-store"
import { useToast } from "@/hooks/use-toast"
import { DEFAULT_TABS_ACCESS, STORAGE_KEYS } from "@/lib/constants"
import {
  DEFAULT_PER_SITE_PROFILE_SETTINGS,
  type PerSiteProfileSettings,
  resolveGroundedOnlyModeForUrls
} from "@/lib/per-site-profiles"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"

const EMPTY_PROFILE_LIST: PerSiteProfileSettings["profiles"] = []

export const useChat = () => {
  const config = useChatConfig()
  const { toast } = useToast()

  const { input, setInput } = useChatInput()
  const { selectedTabIds, setSelectedTabIds } = useSelectedTabs()
  const { builtContent: contextText, documents: tabDocuments } = useTabContent()
  const [tabAccess] = useStorage<boolean>(
    {
      key: STORAGE_KEYS.BROWSER.TABS_ACCESS,
      instance: plasmoGlobalStorage
    },
    DEFAULT_TABS_ACCESS
  )
  const [perSiteProfiles] = useStorage<PerSiteProfileSettings>(
    {
      key: STORAGE_KEYS.BROWSER.PER_SITE_PROFILES,
      instance: plasmoGlobalStorage
    },
    DEFAULT_PER_SITE_PROFILE_SETTINGS
  )
  const { tabs: openTabs } = useOpenTabs(Boolean(tabAccess))
  const perSiteProfileList = perSiteProfiles?.profiles ?? EMPTY_PROFILE_LIST
  const { isLoading, setIsLoading, isStreaming, setIsStreaming } =
    useLoadStream()

  const {
    currentSessionId,
    sessions,
    addMessage,
    updateMessage,
    renameSessionTitle,
    createSession,
    setCurrentSessionId,
    hasMoreMessages,
    loadMoreMessages
  } = useChatSessions()

  const scrollRef = useRef<HTMLDivElement>(null)
  const previousSessionIdRef = useRef<string | null>(null)

  const currentSession = sessions.find((s) => s.id === currentSessionId)
  const messages = currentSession?.messages ?? []

  const { startStream, stopStream, currentStreamingMessageIdRef } =
    useChatStreaming({
      currentSessionId,
      updateMessage,
      setIsLoading,
      setIsStreaming
    })

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [])

  useEffect(() => {
    if (
      previousSessionIdRef.current &&
      currentSessionId &&
      previousSessionIdRef.current !== currentSessionId &&
      selectedTabIds.length > 0
    ) {
      setSelectedTabIds([])
    }
    previousSessionIdRef.current = currentSessionId
  }, [currentSessionId, selectedTabIds.length, setSelectedTabIds])

  const { ensureSessionId, autoRenameSession } = useChatSessionLifecycle({
    currentSessionId,
    sessions,
    createSession,
    setCurrentSessionId,
    renameSessionTitle
  })

  const { generateResponse, setNextResponseMetrics, clearNextResponseMetrics } =
    useChatResponse({
      config,
      currentSessionId,
      messages,
      addMessage,
      startStream,
      currentStreamingMessageIdRef
    })

  const effectiveConfig = useMemo(() => {
    const selectedUrls = selectedTabIds
      .map((id) => openTabs.find((tab) => String(tab.id) === id)?.url)
      .filter(Boolean) as string[]
    return {
      ...config,
      groundedOnlyMode: resolveGroundedOnlyModeForUrls(
        selectedUrls,
        perSiteProfileList,
        config.groundedOnlyMode
      )
    }
  }, [config, openTabs, perSiteProfileList, selectedTabIds])

  const { pendingActivityEvents, sendMessage } = useChatTurnController({
    config: effectiveConfig,
    input,
    setInput,
    selectedTabIds,
    contextText,
    tabDocuments,
    messages,
    setIsLoading,
    setIsStreaming,
    ensureSessionId,
    autoRenameSession,
    addMessage,
    setNextResponseMetrics,
    clearNextResponseMetrics,
    generateResponse,
    toast
  })

  const isModelReady = Boolean(
    config.selectedModelRef?.modelId || config.selectedModel
  )

  return {
    messages,
    pendingActivityEvents,
    isLoading,
    isStreaming,
    isModelReady,
    sendMessage,
    generateResponse,
    stopGeneration: stopStream,
    scrollRef,
    hasMore: hasMoreMessages,
    onLoadMore: loadMoreMessages
  }
}
