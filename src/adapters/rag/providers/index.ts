// ─────────────────────────────────────────────────────────────────────────────
// Supabase pg_vector Implementation
// SEO Engine - RAG Infrastructure
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from '@supabase/supabase-js'
import { SupabaseVectorStore } from './SupabaseVectorStore'

export { SupabaseVectorStore } from './SupabaseVectorStore'

/**
 * Factory pour créer une instance SupabaseVectorStore
 */
export function createSupabaseVectorStore(
  supabaseUrl: string,
  supabaseKey: string,
  embeddingConfig?: {
    provider: 'openai' | 'anthropic' | 'local'
    model: string
    dimension?: number
  }
): SupabaseVectorStore {
  const client = createClient(supabaseUrl, supabaseKey)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new SupabaseVectorStore(client, embeddingConfig as any)
}
