import { queryNvidiaEmbedding } from '../config/nvidia';

/**
 * Standard cosine similarity between two equal-length embedding vectors.
 * Returns 0 for missing/mismatched vectors instead of throwing, since
 * callers treat "no signal" the same as "unrelated".
 */
export function cosineSimilarity(a?: number[], b?: number[]): number {
  if (!a || !b || a.length === 0 || b.length === 0 || a.length !== b.length) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Embeds a single piece of text via the NVIDIA NIM embeddings endpoint.
 * Returns null (rather than throwing) if no NVIDIA key is configured or the
 * call fails, so callers can gracefully fall back to keyword matching.
 */
export async function embedText(
  text: string,
  inputType: 'query' | 'passage' = 'passage'
): Promise<number[] | null> {
  const nvidiaKey = process.env.NVIDIA_API_KEY;
  if (!nvidiaKey || nvidiaKey === 'your_nvidia_api_key_here') return null;
  if (!text || !text.trim()) return null;

  try {
    const [vector] = await queryNvidiaEmbedding([text.slice(0, 4000)], inputType);
    return vector || null;
  } catch (err) {
    console.error('[Embeddings] Failed to embed text:', err);
    return null;
  }
}
