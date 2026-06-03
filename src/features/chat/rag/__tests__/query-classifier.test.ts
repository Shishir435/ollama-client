import { describe, expect, it } from "vitest"
import {
  classifyQueriesBatch,
  classifyQuery,
  getIntentDescription
} from "../query-classifier"

describe("classifyQuery — factual intent", () => {
  it("classifies 'What is X' as factual", () => {
    const result = classifyQuery("What is machine learning?")
    expect(result.intent).toBe("factual")
    expect(result.confidence).toBe(0.8)
    expect(result.shouldUseRAG).toBe(true)
    expect(result.suggestedTopK).toBe(3)
    expect(result.suggestedMode).toBe("similarity")
  })

  it("classifies 'Who invented X' as factual", () => {
    expect(classifyQuery("Who invented the internet?").intent).toBe("factual")
  })

  it("classifies 'Define X' as factual", () => {
    expect(classifyQuery("Define recursion").intent).toBe("factual")
  })

  it("classifies 'Explain X' as factual", () => {
    expect(classifyQuery("Explain transformer architecture").intent).toBe(
      "factual"
    )
  })
})

describe("classifyQuery — procedural intent", () => {
  it("classifies 'How do I X' as procedural", () => {
    const result = classifyQuery("How do I deploy a Docker container?")
    expect(result.intent).toBe("procedural")
    expect(result.suggestedTopK).toBe(5)
    expect(result.suggestedMode).toBe("similarity")
  })

  it("classifies 'Steps to X' as procedural", () => {
    expect(classifyQuery("Steps to configure nginx").intent).toBe("procedural")
  })

  it("classifies 'Can I do X' as procedural", () => {
    expect(classifyQuery("Can I use TypeScript with React?").intent).toBe(
      "procedural"
    )
  })
})

describe("classifyQuery — comparison intent", () => {
  it("classifies 'X vs Y' as comparison", () => {
    const result = classifyQuery("React vs Vue performance")
    expect(result.intent).toBe("comparison")
    expect(result.suggestedTopK).toBe(10)
  })

  it("classifies 'X versus Y' as comparison", () => {
    expect(classifyQuery("Python versus JavaScript for ML").intent).toBe(
      "comparison"
    )
  })

  it("classifies 'difference between X and Y' as comparison", () => {
    expect(
      classifyQuery("Performance difference between REST and GraphQL").intent
    ).toBe("comparison")
  })
})

describe("classifyQuery — summarization intent", () => {
  it("classifies 'Summarize X' as summarization with full mode", () => {
    const result = classifyQuery("Summarize the conversation so far")
    expect(result.intent).toBe("summarization")
    expect(result.suggestedMode).toBe("full")
  })

  it("classifies 'tl;dr' as summarization", () => {
    expect(classifyQuery("tl;dr the document").intent).toBe("summarization")
  })

  it("classifies 'overview' as summarization", () => {
    expect(classifyQuery("overview of the project").intent).toBe(
      "summarization"
    )
  })
})

describe("classifyQuery — conversational intent", () => {
  it("classifies short follow-up as conversational without RAG when no history", () => {
    const result = classifyQuery("That sounds interesting")
    expect(result.intent).toBe("conversational")
    expect(result.shouldUseRAG).toBeFalsy()
  })

  it("uses RAG for conversational when chat history exists", () => {
    const history = [{ role: "user", content: "Tell me about embeddings" }]
    const result = classifyQuery("What about it?", history)
    expect(result.shouldUseRAG).toBe(true)
  })

  it("does not classify long questions as conversational", () => {
    const result = classifyQuery(
      "Can you explain this entire topic in great detail?"
    )
    expect(result.intent).not.toBe("conversational")
  })
})

describe("classifyQuery — exploratory default", () => {
  it("falls back to exploratory for unmatched queries", () => {
    const result = classifyQuery("Tell me about the history of computing")
    expect(result.intent).toBe("exploratory")
    expect(result.confidence).toBe(0.5)
    expect(result.suggestedTopK).toBe(5)
  })
})

describe("classifyQuery — entity extraction", () => {
  it("extracts capitalized proper nouns", () => {
    const result = classifyQuery("Tell me about React and Vue frameworks")
    expect(result.entities).toContain("React")
    expect(result.entities).toContain("Vue")
  })

  it("extracts camelCase technical terms", () => {
    const result = classifyQuery("Explain useState hook")
    expect(result.entities).toContain("useState")
  })

  it("extracts acronyms", () => {
    const result = classifyQuery("Compare RAG and NLP approaches")
    expect(result.entities).toContain("RAG")
    expect(result.entities).toContain("NLP")
  })

  it("deduplicates entities", () => {
    const result = classifyQuery("React vs React performance")
    const reactCount = result.entities.filter((e) => e === "React").length
    expect(reactCount).toBe(1)
  })
})

describe("classifyQueriesBatch", () => {
  it("classifies multiple queries", () => {
    const results = classifyQueriesBatch([
      "What is TypeScript?",
      "How do I install npm?",
      "React vs Angular"
    ])
    expect(results).toHaveLength(3)
    expect(results[0].intent).toBe("factual")
    expect(results[1].intent).toBe("procedural")
    expect(results[2].intent).toBe("comparison")
  })

  it("returns empty array for empty input", () => {
    expect(classifyQueriesBatch([])).toEqual([])
  })

  it("passes chat history to each query", () => {
    const history = [{ role: "user", content: "context" }]
    const results = classifyQueriesBatch(["What about it?"], history)
    expect(results[0].shouldUseRAG).toBe(true)
  })
})

describe("getIntentDescription", () => {
  it("returns description for each intent", () => {
    const intents = [
      "factual",
      "exploratory",
      "procedural",
      "comparison",
      "summarization",
      "conversational"
    ] as const

    for (const intent of intents) {
      const desc = getIntentDescription(intent)
      expect(typeof desc).toBe("string")
      expect(desc.length).toBeGreaterThan(0)
    }
  })

  it("returns factual description", () => {
    expect(getIntentDescription("factual")).toContain("facts")
  })

  it("returns procedural description", () => {
    expect(getIntentDescription("procedural")).toContain("step")
  })
})
