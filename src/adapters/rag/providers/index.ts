// ─────────────────────────────────────────────────────────────────────────────
// Supabase pg_vector Implementation
// SEO Engine - RAG Infrastructure
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from '@supabase/supabase-js'
import {
  SupabaseVectorStore,
  EMBEDDING_DIMENSION,
  EMBEDDING_BATCH_SIZE,
  DEFAULT_EMBEDDING_MODEL,
} from './SupabaseVectorStore'
import type { EmbeddingConfig } from '../VectorStore'

export { SupabaseVectorStore } from './SupabaseVectorStore'

/**
 * Factory pour créer une instance SupabaseVectorStore.
 *
 * `dimension` is not negotiable and is therefore not read from the caller: the
 * `vector_embeddings.embedding` column is VECTOR(1536), and letting a caller ask
 * for anything else only moves the failure to insert time — after the embeddings
 * have already been paid for.
 */
export function createSupabaseVectorStore(
  supabaseUrl: string,
  supabaseKey: string,
  embeddingConfig?: Partial<EmbeddingConfig>
): SupabaseVectorStore {
  const client = createClient(supabaseUrl, supabaseKey)

  return new SupabaseVectorStore(client, {
    provider: embeddingConfig?.provider ?? 'openai',
    model: embeddingConfig?.model ?? DEFAULT_EMBEDDING_MODEL,
    dimension: EMBEDDING_DIMENSION,
    batchSize: embeddingConfig?.batchSize ?? EMBEDDING_BATCH_SIZE,
  })
}
