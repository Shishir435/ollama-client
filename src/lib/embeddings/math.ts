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
    return { normalized: new Array(len).fill(0), norm: 0 }
  }

  // Normalize
  const normalized = new Array(len)
  for (let i = 0; i < len; i++) {
    normalized[i] = embedding[i] / norm
  }

  return { normalized, norm }
}

/**
 * Optimized cosine similarity using Float32Array and pre-normalized vectors
 * If normalized embeddings are available, uses dot product directly (much faster)
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
    throw new Error("Embeddings must have the same dimension")
  }

  // Convert to Float32Array for better performance
  const queryArr = new Float32Array(queryNormalized)

  // If document has normalized embedding, use dot product directly (fastest)
  // Both vectors are normalized, so dot product = cosine similarity
  if (docNormalized) {
    const docArr = new Float32Array(docNormalized)
    let dotProduct = 0

    // Unrolled loop for better performance
    const unrollFactor = 4
    const remainder = len % unrollFactor
    let i = 0

    for (; i < len - remainder; i += unrollFactor) {
      dotProduct +=
        queryArr[i] * docArr[i] +
        queryArr[i + 1] * docArr[i + 1] +
        queryArr[i + 2] * docArr[i + 2] +
        queryArr[i + 3] * docArr[i + 3]
    }

    for (; i < len; i++) {
      dotProduct += queryArr[i] * docArr[i]
    }

    // Both vectors are normalized, so dot product equals cosine similarity
    return dotProduct
  }

  // Fallback: compute similarity with pre-computed norms (faster than full computation)
  if (docNorm !== undefined) {
    const docArr = new Float32Array(docEmbedding)
    let dotProduct = 0

    const unrollFactor = 4
    const remainder = len % unrollFactor
    let i = 0

    for (; i < len - remainder; i += unrollFactor) {
      dotProduct +=
        queryArr[i] * docArr[i] +
        queryArr[i + 1] * docArr[i + 1] +
        queryArr[i + 2] * docArr[i + 2] +
        queryArr[i + 3] * docArr[i + 3]
    }

    for (; i < len; i++) {
      dotProduct += queryArr[i] * docArr[i]
    }

    const denominator = queryNorm * docNorm
    return denominator === 0 ? 0 : dotProduct / denominator
  }

  // Fallback: compute similarity manually using normalized query
  // This handles cases where document doesn't have normalized embedding
  const docArr = new Float32Array(docEmbedding)
  let dotProduct = 0
  let docNormSquared = 0

  const unrollFactor = 4
  const remainder = len % unrollFactor
  let i = 0

  for (; i < len - remainder; i += unrollFactor) {
    const q0 = queryArr[i]
    const q1 = queryArr[i + 1]
    const q2 = queryArr[i + 2]
    const q3 = queryArr[i + 3]
    const d0 = docArr[i]
    const d1 = docArr[i + 1]
    const d2 = docArr[i + 2]
    const d3 = docArr[i + 3]

    dotProduct += q0 * d0 + q1 * d1 + q2 * d2 + q3 * d3
    docNormSquared += d0 * d0 + d1 * d1 + d2 * d2 + d3 * d3
  }

  for (; i < len; i++) {
    dotProduct += queryArr[i] * docArr[i]
    docNormSquared += docArr[i] * docArr[i]
  }

  const calculatedDocNorm = Math.sqrt(docNormSquared)
  const denominator = queryNorm * calculatedDocNorm
  return denominator === 0 ? 0 : dotProduct / denominator
}
