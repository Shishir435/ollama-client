import fs from "node:fs"

const replaceExact = (path, before, after) => {
  const source = fs.readFileSync(path, "utf8")
  if (!source.includes(before)) {
    throw new Error(`Expected refactor target not found in ${path}`)
  }
  fs.writeFileSync(path, source.replace(before, after))
}

replaceExact(
  "e2e/chromium/critical/__tests__/provider-streaming.spec.ts",
  'import { createServer } from "node:http"\nimport type { IncomingMessage, ServerResponse } from "node:http"',
  'import type { IncomingMessage, ServerResponse } from "node:http"\nimport { createServer } from "node:http"'
)

replaceExact(
  "src/application/context/rag/rag-retriever.ts",
  "const useFallbackCandidates = (",
  "const appendFallbackCandidates = ("
)
replaceExact(
  "src/application/context/rag/rag-retriever.ts",
  "  useFallbackCandidates(results, allCandidates, minSimilarity)",
  "  appendFallbackCandidates(results, allCandidates, minSimilarity)"
)

replaceExact(
  "src/lib/embeddings/embedding-strategy.ts",
  "/**\n * Robust embedding generation that tries multiple providers and models based on user preference.",
  `const recordEmbeddingRouteFailure = async ({
  error,
  attempt,
  sharedAttempt,
  attemptedRoutes,
  routeErrors,
  routeFailures
}: {
  error: unknown
  attempt: EmbedAttempt
  sharedAttempt?: EmbedAttempt
  attemptedRoutes: EmbeddingRoute[]
  routeErrors: string[]
  routeFailures: unknown[]
}): Promise<void> => {
  if (isAbortError(error)) throw error

  const errorMessage = getErrorMessage(error)
  routeErrors.push(\`${"${attempt.route}: ${errorMessage}"}\`)
  routeFailures.push(error)
  logger.warn(\`Embedding route failed: ${"${attempt.route}"}\`, "EmbeddingStrategy", {
    providerId: attempt.providerId,
    model: attempt.model,
    error
  })

  if (attempt.route !== "shared-model" || !sharedAttempt) return
  attemptedRoutes.push("shared-model-warmup")
  const config = await getEmbeddingConfig()
  if (!config.warmupEmbeddingsInBackground) return
  void scheduleSharedModelWarmup(sharedAttempt.providerId, sharedAttempt.model)
}

/**
 * Robust embedding generation that tries multiple providers and models based on user preference.`
)

replaceExact(
  "src/lib/embeddings/embedding-strategy.ts",
  `    } catch (error) {
      // A cancelled request is not a failed route: falling through to the next
      // provider would start the network work the caller just asked to stop.
      if (isAbortError(error)) {
        throw error
      }

      const errorMessage = getErrorMessage(error)
      routeErrors.push(\`${"${attempt.route}: ${errorMessage}"}\`)
      routeFailures.push(error)
      logger.warn(
        \`Embedding route failed: ${"${attempt.route}"}\`,
        "EmbeddingStrategy",
        {
          providerId: attempt.providerId,
          model: attempt.model,
          error
        }
      )

      // Shared model failure in auto path triggers best-effort background warmup.
      if (attempt.route === "shared-model" && sharedAttempt) {
        attemptedRoutes.push("shared-model-warmup")
        const config = await getEmbeddingConfig()
        if (config.warmupEmbeddingsInBackground) {
          void scheduleSharedModelWarmup(
            sharedAttempt.providerId,
            sharedAttempt.model
          )
        }
      }
    }`,
  `    } catch (error) {
      await recordEmbeddingRouteFailure({
        error,
        attempt,
        sharedAttempt,
        attemptedRoutes,
        routeErrors,
        routeFailures
      })
    }`
)

console.log("Applied temporary cognitive-complexity refactor pass")
