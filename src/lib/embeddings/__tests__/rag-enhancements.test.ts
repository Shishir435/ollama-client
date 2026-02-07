import { describe, it, expect, vi } from "vitest"
import { classifyQuery, getWeightsForQueryType } from "../query-classifier"
import { calculateRecencyBoost, applyRecencyBoost } from "../recency-boost"

describe("RAG v3.0 Enhancements", () => {
  describe("Query Classification", () => {
    it("should classify code queries correctly", () => {
      // Direct code keywords
      expect(classifyQuery("function calculateTotal()")).toBe("code")
      expect(classifyQuery("const x = 5")).toBe("code")
      expect(classifyQuery("import React from 'react'")).toBe("code")
      expect(classifyQuery("export interface User")).toBe("code")
      
      // Code syntax
      expect(classifyQuery("items.map(i => i.id)")).toBe("code")
      expect(classifyQuery("JSON.stringify(data)")).toBe("code")
    })

    it("should classify API queries correctly", () => {
      expect(classifyQuery("GET /api/users")).toBe("api")
      expect(classifyQuery("how to use fetch API")).toBe("api")
      expect(classifyQuery("GraphQL mutation example")).toBe("api")
      expect(classifyQuery("https://api.example.com/v1")).toBe("api")
      expect(classifyQuery("REST endpoint for deleting items")).toBe("api")
    })

    it("should classify conceptual queries correctly", () => {
      expect(classifyQuery("what is the meaning of life")).toBe("conceptual")
      expect(classifyQuery("explain dependency injection")).toBe("conceptual")
      expect(classifyQuery("how does the reranker work")).toBe("conceptual")
      expect(classifyQuery("best practices for state management")).toBe("conceptual")
    })

    it("should return correct weights for query types", () => {
      const codeWeights = getWeightsForQueryType("code")
      expect(codeWeights.keywordWeight).toBe(0.8)
      expect(codeWeights.semanticWeight).toBe(0.2)
      
      const apiWeights = getWeightsForQueryType("api")
      expect(apiWeights.keywordWeight).toBe(0.8)
      expect(apiWeights.semanticWeight).toBe(0.2)
      
      const conceptualWeights = getWeightsForQueryType("conceptual")
      expect(conceptualWeights.keywordWeight).toBe(0.3)
      expect(conceptualWeights.semanticWeight).toBe(0.7)
    })
  })

  describe("Temporal Relevance Boosting", () => {
    it("should calculate appropriate boost factors", () => {
      const now = Date.now()
      const day = 24 * 60 * 60 * 1000
      
      // Today: should be close to 1.0
      expect(calculateRecencyBoost(now)).toBeCloseTo(1.0, 1)
      
      // 90 days ago (half-life): should be close to 0.5
      expect(calculateRecencyBoost(now - 90 * day, 90)).toBeCloseTo(0.5, 1)
      
      // 180 days ago (2 * half-life): should be close to 0.25
      expect(calculateRecencyBoost(now - 180 * day, 90)).toBeCloseTo(0.25, 1)
      
      // Very old: should be close to 0
      expect(calculateRecencyBoost(now - 1000 * day)).toBeCloseTo(0.0, 1)
    })

    it("should apply boosts correctly to results", () => {
      const now = Date.now()
      const day = 24 * 60 * 60 * 1000
      
      const results = [
        { 
          score: 1.0, 
          document: { metadata: { timestamp: now } } // Recent
        },
        { 
          score: 1.0, 
          document: { metadata: { timestamp: now - 90 * day } } // 90 days old
        },
        { 
          score: 1.0, 
          document: { metadata: { timestamp: now - 365 * day } } // Old
        },
        { 
          score: 1.0, 
          document: { metadata: {} } // No timestamp
        }
      ]
      
      // Apply 30% max boost
      applyRecencyBoost(results, 0.3, 90)
      
      // Recent: 1.0 * (1 + 1.0 * 0.3) = 1.3
      expect(results[0].score).toBeGreaterThan(1.29)
      
      // 90 days: 1.0 * (1 + 0.5 * 0.3) = 1.15
      expect(results[1].score).toBeCloseTo(1.15, 1)
      
      // Old: 1.0 * (1 + ~0 * 0.3) = 1.0
      expect(results[2].score).toBeLessThan(1.05)
      expect(results[2].score).toBeGreaterThan(1.0)
      
      // No timestamp: no boost
      expect(results[3].score).toBe(1.0)
    })
  })
})
