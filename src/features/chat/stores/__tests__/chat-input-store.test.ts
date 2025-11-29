import { describe, it, expect, beforeEach } from "vitest"
import { chatInputStore } from "../chat-input-store"

describe("chatInputStore", () => {
  beforeEach(() => {
    // Reset store to initial state
    chatInputStore.setState({ input: "" })
  })

  it("should initialize with empty input", () => {
    const state = chatInputStore.getState()
    expect(state.input).toBe("")
  })

  it("should set input", () => {
    const { setInput } = chatInputStore.getState()
    setInput("Hello world")
    
    expect(chatInputStore.getState().input).toBe("Hello world")
  })

  it("should append input", () => {
    const { setInput, appendInput } = chatInputStore.getState()
    
    setInput("Hello")
    appendInput(" world")
    
    expect(chatInputStore.getState().input).toBe("Hello world")
  })

  it("should handle multiple appends", () => {
    const { appendInput } = chatInputStore.getState()
    
    appendInput("First")
    appendInput(" Second")
    appendInput(" Third")
    
    expect(chatInputStore.getState().input).toBe("First Second Third")
  })

  it("should replace input with setInput", () => {
    const { setInput } = chatInputStore.getState()
    
    setInput("Initial")
    setInput("Replaced")
    
    expect(chatInputStore.getState().input).toBe("Replaced")
  })
})
