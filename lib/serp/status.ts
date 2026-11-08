// ─────────────────────────────────────────────────────────────────────────────
// SERP source status — is SerpApi actually answering?
// SEO Engine - The diagnostic the owner can read without a server shell.
// ─────────────────────────────────────────────────────────────────────────────
//
// The last SERP the engine read is dated 2026-08-10. For three months every
// plan was built without result pages, and the only trace was a console line
// on the VPS: the Stratégie tab said « aucune SERP exploitable » without ever
// saying why. A missing key, a refused key and an exhausted quota call for
// three different fixes; this module tells them apart.
//
// The last failure lives in memory: one process, one instance (CLAUDE.md), and
// a restart forgetting it is fine — the next plan records it again. The key
// itself never leaves this module, not even masked.

import { createServiceClient } from '@/lib/supabase'
import type { SerpUnavailableError } from './fetch'

export type SerpFailureKind = SerpUnavailableError['kind']

export interface SerpAccount {
  plan: string | null
  /** Searches left this month on the plan, extra credits included when reported. */
  searchesLeft: number | null
  searchesPerMonth: number | null
  usedThisMonth: number | null
}

export interface SerpStatus {
  /** SERPAPI_KEY is set in the process environment. */
  configured: boolean
  /** What SerpApi says about the account — null without a key, or when it could not be asked. */
  account: SerpAccount | null
  /** Why the account could not be read: a refused key reads here. */
  accountError: string | null
  lastFailure: { kind: SerpFailureKind; message: string; at: string } | null
  lastSuccessAt: string | null
  /** The most recent result page stored, live or not: the only date that survives a restart. */
  lastSnapshotAt: string | null
}

let lastFailure: SerpStatus['lastFailure'] = null
let lastSuccessAt: string | null = null

export function recordSerpFailure(kind: SerpFailureKind, message: string): void {
  lastFailure = { kind, message, at: new Date().toISOString() }
}

export function recordSerpSuccess(): void {
  lastSuccessAt = new Date().toISOString()
}

/** Tests only. */
export function resetSerpStatus(): void {
  lastFailure = null
  lastSuccessAt = null
  accountCache = null
}

const ACCOUNT_ENDPOINT = 'https://serpapi.com/account.json'
const ACCOUNT_TIMEOUT_MS = 8000
/** The account endpoint is free, but the page may be reloaded often. */
const ACCOUNT_CACHE_MS = 5 * 60_000

let accountCache: { at: number; value: Pick<SerpStatus, 'account' | 'accountError'> } | null = null

export async function getSerpStatus(): Promise<SerpStatus> {
  const key = process.env.SERPAPI_KEY?.trim()
  const [accountPart, lastSnapshotAt] = await Promise.all([
    key ? readAccount(key) : Promise.resolve({ account: null, accountError: null }),
    readLastSnapshotAt(),
  ])

  return {
    configured: Boolean(key),
    ...accountPart,
    lastFailure,
    lastSuccessAt,
    lastSnapshotAt,
  }
}

async function readAccount(key: string): Promise<Pick<SerpStatus, 'account' | 'accountError'>> {
  if (accountCache && Date.now() - accountCache.at < ACCOUNT_CACHE_MS) return accountCache.value

  let value: Pick<SerpStatus, 'account' | 'accountError'>
  try {
    const url = new URL(ACCOUNT_ENDPOINT)
    url.searchParams.set('api_key', key)
    const response = await fetch(url.toString(), { signal: AbortSignal.timeout(ACCOUNT_TIMEOUT_MS) })
    const data = (await response.json().catch(() => null)) as Record<string, unknown> | null

    if (response.status === 401 || response.status === 403) {
      value = { account: null, accountError: 'Clé refusée par SerpApi (401/403).' }
    } else if (!response.ok || !data) {
      value = { account: null, accountError: `SerpApi a répondu HTTP ${response.status}.` }
    } else if (typeof data.error === 'string') {
      value = { account: null, accountError: `SerpApi : ${data.error}` }
    } else {
      value = { account: accountOf(data), accountError: null }
    }
  } catch (error) {
    value = { account: null, accountError: `SerpApi injoignable : ${error instanceof Error ? error.message : String(error)}` }
  }

  accountCache = { at: Date.now(), value }
  return value
}

/** Exported for tests: the account payload, read field by field. */
export function accountOf(data: Record<string, unknown>): SerpAccount {
  const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null)
  return {
    plan: typeof data.plan_name === 'string' ? data.plan_name : typeof data.plan_id === 'string' ? data.plan_id : null,
    searchesLeft: num(data.total_searches_left) ?? num(data.plan_searches_left),
    searchesPerMonth: num(data.searches_per_month),
    usedThisMonth: num(data.this_month_usage),
  }
}

async function readLastSnapshotAt(): Promise<string | null> {
  try {
    const { data, error } = await createServiceClient()
      .from('serp_snapshots')
      .select('fetched_at')
      .order('fetched_at', { ascending: false })
      .limit(1)
    if (error) return null
    return (data?.[0]?.fetched_at as string | undefined) ?? null
  } catch {
    return null
  }
}

/**
 * The status in one sentence, and how bad it is. Shared by the API and the
 * screen so that both say the same thing.
 */
export function describeSerpStatus(status: SerpStatus): { tone: 'good' | 'warning' | 'critical'; text: string } {
  if (!status.configured) {
    return {
      tone: 'critical',
      text:
        'SERPAPI_KEY absente du serveur : aucune page de résultats n’est lue, ni questions « Autres questions posées », ' +
        'ni recherches associées, ni longueur des concurrents. Ajouter la clé dans /opt/seo-engine/.env puis redémarrer le conteneur.',
    }
  }
  if (status.accountError) {
    return { tone: 'critical', text: `${status.accountError} Vérifier la valeur de SERPAPI_KEY dans /opt/seo-engine/.env.` }
  }
  if (status.account?.searchesLeft === 0) {
    return {
      tone: 'critical',
      text: `Quota SerpApi épuisé${status.account.plan ? ` (plan ${status.account.plan})` : ''} : les plans sont construits sans SERP jusqu’au renouvellement.`,
    }
  }
  if (status.lastFailure && (!status.lastSuccessAt || status.lastFailure.at > status.lastSuccessAt)) {
    return { tone: 'warning', text: `Dernière lecture en échec (${status.lastFailure.kind}) : ${status.lastFailure.message}` }
  }

  const left = status.account?.searchesLeft
  return {
    tone: 'good',
    text:
      'SerpApi répond' +
      (left !== null && left !== undefined ? ` — ${left.toLocaleString('fr-FR')} recherches restantes` : '') +
      (status.account?.plan ? ` (plan ${status.account.plan})` : '') +
      '.',
  }
}
