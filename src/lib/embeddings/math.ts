/**
 * Normalizes a vector to unit length (L2 normalization)
 * Returns the normalized vector and its norm
 */
export const normalizeVector = (
  embedding: number[]
): { normalized: number[]; norm: number } => {
  const len = embedding.length
  if (len === 0) {
    return { normalized: [], norm: 0 }
  }

  // Calculate L2 norm
  let norm = 0
  for (let i = 0; i < len; i++) {
    norm += embedding[i] * embedding[i]
  }
  norm = Math.sqrt(norm)

  if (norm === 0) {
    return { normalized: Array.from({ length: len }, () => 0), norm: 0 }
  }

  // Normalize
  const normalized: number[] = []
  for (let i = 0; i < len; i++) {
    normalized[i] = embedding[i] / norm
  }

  return { normalized, norm }
}

/** Inserts a scored row in stable descending order while retaining only top K. */
export const insertTopKBySimilarity = <T extends { similarity: number }>(
  results: T[],
  candidate: T,
  limit: number
): void => {
  if (limit <= 0) return
  if (
    results.length >= limit &&
    candidate.similarity <= results[results.length - 1].similarity
  )
    return

  let low = 0
  let high = results.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (results[middle].similarity >= candidate.similarity) low = middle + 1
    else high = middle
  }
  results.splice(low, 0, candidate)
  if (results.length > limit) results.pop()
}

/**
 * Computes cosine similarity without allocating typed-array copies per row.
 * If normalized embeddings are available, uses dot product directly.
 */
export const cosineSimilarityOptimized = (
  queryNormalized: number[],
  queryNorm: number,
  docEmbedding: number[],
  docNorm?: number,
  docNormalized?: number[]
): number => {
  const len = queryNormalized.length

  if (len === 0) return 0
  if (len !== docEmbedding.length) {
    return 0
  }

  // If document has normalized embedding, use dot product directly (fastest)
  // Both vectors are normalized, so dot product = cosine similarity
  if (docNormalized) {
    let dotProduct = 0

    // Unrolled loop for better performance
    const unrollFactor = 4
    const remainder = len % unrollFactor
    let i = 0

    for (; i < len - remainder; i += unrollFactor) {
      dotProduct +=
        queryNormalized[i] * docNormalized[i] +
        queryNormalized[i + 1] * docNormalized[i + 1] +
        queryNormalized[i + 2] * docNormalized[i + 2] +
        queryNormalized[i + 3] * docNormalized[i + 3]
    }

    for (; i < len; i++) {
      dotProduct += queryNormalized[i] * docNormalized[i]
    }

    // Both vectors are normalized, so dot product equals cosine similarity
    return dotProduct
  }

  // Fallback: compute similarity with pre-computed norms (faster than full computation)
  if (docNorm !== undefined) {
    let dotProduct = 0

    const unrollFactor = 4
    const remainder = len % unrollFactor
    let i = 0

    for (; i < len - remainder; i += unrollFactor) {
      dotProduct +=
        queryNormalized[i] * docEmbedding[i] +
        queryNormalized[i + 1] * docEmbedding[i + 1] +
        queryNormalized[i + 2] * docEmbedding[i + 2] +
        queryNormalized[i + 3] * docEmbedding[i + 3]
    }

    for (; i < len; i++) {
      dotProduct += queryNormalized[i] * docEmbedding[i]
    }

    const denominator = queryNorm * docNorm
    return denominator === 0 ? 0 : dotProduct / denominator
  }

  // Fallback: compute similarity manually using normalized query
  // This handles cases where document doesn't have normalized embedding
  let dotProduct = 0
  let docNormSquared = 0

  const unrollFactor = 4
  const remainder = len % unrollFactor
  let i = 0

  for (; i < len - remainder; i += unrollFactor) {
    const q0 = queryNormalized[i]
    const q1 = queryNormalized[i + 1]
    const q2 = queryNormalized[i + 2]
    const q3 = queryNormalized[i + 3]
    const d0 = docEmbedding[i]
    const d1 = docEmbedding[i + 1]
    const d2 = docEmbedding[i + 2]
    const d3 = docEmbedding[i + 3]

    dotProduct += q0 * d0 + q1 * d1 + q2 * d2 + q3 * d3
    docNormSquared += d0 * d0 + d1 * d1 + d2 * d2 + d3 * d3
  }

  for (; i < len; i++) {
    dotProduct += queryNormalized[i] * docEmbedding[i]
    docNormSquared += docEmbedding[i] * docEmbedding[i]
  }

  const calculatedDocNorm = Math.sqrt(docNormSquared)
  const denominator = queryNorm * calculatedDocNorm
  return denominator === 0 ? 0 : dotProduct / denominator
}
