/**
 * Next.js instrumentation hook.
 *
 * Next compiles this file for BOTH the Node.js and the Edge runtime. The
 * `NEXT_RUNTIME` check below only runs at request time, so a top-level
 * `import { initScheduler } from '@/lib/scheduler/cron'` would still pull the
 * whole scheduler graph — node-cron, the RAG context builders, the vector store
 * and its `node:crypto` dependency — into the Edge bundle, where none of it can
 * load.
 *
 * The dynamic import keeps that graph out of the Edge bundle entirely: it is
 * only resolved once we know we are on the Node.js runtime.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  // Never during `next build`. The build workers load this hook too, and
  // `initScheduler()` fires the reapers immediately: a local `npm run build`
  // with a `.env.local` pointing at the production database would rewrite
  // production rows — a second scheduler, for the length of a build.
  if (process.env.NEXT_PHASE === 'phase-production-build') return

  const { initScheduler } = await import('@/lib/scheduler/cron')
  initScheduler()
}
