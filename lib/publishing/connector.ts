// ─────────────────────────────────────────────────────────────────────────────
// The connector interface, and the one place that picks one
// SEO Engine - An unknown site type must stop, not fall through.
// ─────────────────────────────────────────────────────────────────────────────
//
// The dispatch used to be written the same way in three places:
//
//   if (site.type === 'nextjs') { … }
//   // …and WordPress is whatever is left
//
// WordPress was the implicit `else`. A site whose type is anything other than
// `nextjs` — a typo, a third connector added later, a row written by a script —
// was sent to `POST /wp-json/wp/v2/pages` with empty credentials. It fails, of
// course, but it fails as an authentication error against a stranger's site
// rather than as "this engine does not know that kind of site".
//
// `connectorFor()` is exhaustive over `SiteType` and throws by name. Adding a
// site type to the union now fails the build until a connector exists, which is
// exactly when it should fail.

import type { SiteType } from '@/lib/types'
import type { PublishOutcome, PublishRequest } from './outcome'
import { nextJsConnector } from './nextjs'
import { wordPressConnector } from './wordpress'

/**
 * Deliberately four members.
 *
 * Everything else a connector might expose — capability tables, dry runs,
 * separate inspect/write steps — was considered and dropped. Two connectors do
 * not justify a plugin surface, and a capability table the compiler cannot
 * verify goes stale silently. What a connector cannot do, it says in its own
 * `PublishOutcome`.
 */
export interface Connector {
  /** Shown in the UI. */
  label: string
  /**
   * Columns of `sites` this connector needs filled to work at all.
   *
   * Used to tell "not configured" from "broken" before any network call.
   */
  credentialColumns: string[]
  /** Human-readable state of the connection, for the site page. */
  describe(site: import('@/lib/types').Site): Promise<{ ok: boolean; message: string }>
  publish(request: PublishRequest): Promise<PublishOutcome>
}

const CONNECTORS: Record<SiteType, Connector> = {
  nextjs: nextJsConnector,
  wordpress: wordPressConnector,
}

export class UnknownConnectorError extends Error {
  constructor(readonly siteType: string) {
    super(
      `Type de site inconnu : « ${siteType} ». Connecteurs disponibles : ` +
        `${Object.keys(CONNECTORS).join(', ')}. Aucune publication tentee.`
    )
    this.name = 'UnknownConnectorError'
  }
}

export function connectorFor(siteType: string): Connector {
  const connector = CONNECTORS[siteType as SiteType]
  if (!connector) throw new UnknownConnectorError(siteType)
  return connector
}

/** Which required credentials are missing, if any. */
export function missingCredentials(site: import('@/lib/types').Site): string[] {
  const connector = connectorFor(site.type)
  const row = site as unknown as Record<string, unknown>
  return connector.credentialColumns.filter((column) => {
    const value = row[column]
    return value === null || value === undefined || value === ''
  })
}
