import { describe, it, expect, beforeEach } from "vitest"
import { loadStreamStore } from "../load-stream-store"

describe("loadStreamStore", () => {
  beforeEach(() => {
    // Reset store to initial state
    loadStreamStore.setState({ isLoading: false, isStreaming: false })
  })

  it("should initialize with false flags", () => {
    const state = loadStreamStore.getState()
    expect(state.isLoading).toBe(false)
    expect(state.isStreaming).toBe(false)
  })

  it("should set isLoading to true", () => {
    const { setIsLoading } = loadStreamStore.getState()
    setIsLoading(true)
    
    expect(loadStreamStore.getState().isLoading).toBe(true)
  })

  it("should set isLoading to false", () => {
    const { setIsLoading } = loadStreamStore.getState()
    setIsLoading(true)
    setIsLoading(false)
    
    expect(loadStreamStore.getState().isLoading).toBe(false)
  })

  it("should set isStreaming to true", () => {
    const { setIsStreaming } = loadStreamStore.getState()
    setIsStreaming(true)
    
    expect(loadStreamStore.getState().isStreaming).toBe(true)
  })

  it("should set isStreaming to false", () => {
    const { setIsStreaming } = loadStreamStore.getState()
    setIsStreaming(true)
    setIsStreaming(false)
    
    expect(loadStreamStore.getState().isStreaming).toBe(false)
  })

  it("should handle both flags independently", () => {
    const { setIsLoading, setIsStreaming } = loadStreamStore.getState()
    
    setIsLoading(true)
    setIsStreaming(true)
    
    expect(loadStreamStore.getState().isLoading).toBe(true)
    expect(loadStreamStore.getState().isStreaming).toBe(true)
    
    setIsLoading(false)
    
    expect(loadStreamStore.getState().isLoading).toBe(false)
    expect(loadStreamStore.getState().isStreaming).toBe(true)
  })
})
