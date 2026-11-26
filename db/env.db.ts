// ─────────────────────────────────────────────────────────────────────────────
// Setup file of `npm run test:db`, run in each test worker
// Points lib/supabase.ts and lib/client-space at the LOCAL stack that
// db/test-setup.db.ts found — whatever .env.local says.
// ─────────────────────────────────────────────────────────────────────────────

import { inject } from 'vitest'

process.env.NEXT_PUBLIC_SUPABASE_URL = inject('supabaseApiUrl')
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = inject('supabaseAnonKey')
process.env.SUPABASE_SERVICE_ROLE_KEY = inject('supabaseServiceKey')
