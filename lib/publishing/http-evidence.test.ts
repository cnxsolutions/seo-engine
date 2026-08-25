// ─────────────────────────────────────────────────────────────────────────────
// HTTP evidence
// SEO Engine - The one rule that must not be derived twice, pinned once.
// ─────────────────────────────────────────────────────────────────────────────
//
// Two connectors now depend on these five lines to decide whether a retry
// duplicates a page on a client's site or a post on their business listing. The
// connector tests exercise the rule through the network doubles; these exercise
// it directly, on the boundaries no realistic scenario reaches.

import { describe, expect, it } from 'vitest'
import { evidenceFor, rejectedOnArrival } from './http-evidence'

describe('rejectedOnArrival', () => {
  it('un 4xx RECU prouve que rien n a ete ecrit', () => {
    // A revoked password, a template WordPress does not know, a WAF blocking the
    // body because it carries a <script>: all answer 4xx, all before insertion.
    for (const status of [400, 401, 403, 404, 409, 422]) {
      expect(rejectedOnArrival(status)).toBe(true)
    }
  })

  it('408 ne prouve rien : le serveur a pu servir la requete avant le timeout', () => {
    expect(rejectedOnArrival(408)).toBe(false)
  })

  it('429 ne prouve rien : la limite peut etre comptee apres le traitement', () => {
    // The single behaviour change carried by the extraction, and it goes toward
    // prudence: WordPress used to conclude "nothing written" on a 429 and allow
    // an immediate retry. Neither API documents whether its rate limiter sits in
    // front of the handler or behind it, so the retry is no longer free.
    expect(rejectedOnArrival(429)).toBe(false)
  })

  it('un 5xx laisse le doute : une extension peut planter APRES l insertion', () => {
    for (const status of [500, 502, 503, 504]) {
      expect(rejectedOnArrival(status)).toBe(false)
    }
  })

  it('aucun statut du tout — coupure, timeout client, DNS — laisse le doute', () => {
    expect(rejectedOnArrival(undefined)).toBe(false)
  })

  it('200 vaut false, et cela veut dire « n en conclus pas que rien n a ete ecrit »', () => {
    // A 2xx never reaches this function: both callers ask from a failure path.
    // It is pinned so that nobody reads `false` as a second verdict. The function
    // answers ONE question — "did the destination refuse before acting?" — and on
    // a 2xx the answer is no, for the opposite reason to a 502: not because the
    // evidence is thin, but because it proves the write DID land.
    expect(rejectedOnArrival(200)).toBe(false)
    expect(rejectedOnArrival(201)).toBe(false)
    expect(rejectedOnArrival(301)).toBe(false)
  })

  it('les bornes de la fenetre 4xx', () => {
    expect(rejectedOnArrival(399)).toBe(false)
    expect(rejectedOnArrival(400)).toBe(true)
    expect(rejectedOnArrival(499)).toBe(true)
    expect(rejectedOnArrival(500)).toBe(false)
  })

  it('ne differe de la regle WordPress d origine que sur 429', () => {
    // The extraction must remain an extraction. This compares the shared function
    // to the rule as it was written inline in wordpress/index.ts, over every
    // status, and allows exactly one point of disagreement — the one the spec
    // decided. Any other divergence is a rewrite that nobody asked for.
    const inlineWordPressRule = (status: number) => status >= 400 && status < 500 && status !== 408

    const divergences = Array.from({ length: 500 }, (_, offset) => 100 + offset)
      .filter((status) => rejectedOnArrival(status) !== inlineWordPressRule(status))

    expect(divergences).toEqual([429])
  })
})

describe('evidenceFor', () => {
  it('une requete jamais envoyee n a jamais pu etre servie', () => {
    // No status can overrule the position in this direction. This is the failure
    // that marked rows as published with no page anywhere: a lookup that failed
    // BEFORE the POST, reported as written.
    expect(evidenceFor(false, 502)).toBe('certainement-pas-ecrit')
    expect(evidenceFor(false, undefined)).toBe('certainement-pas-ecrit')
    expect(evidenceFor(false, 200)).toBe('certainement-pas-ecrit')
  })

  it('une requete remise puis un 5xx : peut-etre ecrit, donc on ne rejoue pas', () => {
    expect(evidenceFor(true, 502)).toBe('peut-etre-ecrit')
  })

  it('une requete remise puis un 4xx recu : la preuve prime sur la position', () => {
    expect(evidenceFor(true, 400)).toBe('certainement-pas-ecrit')
    expect(evidenceFor(true, 403)).toBe('certainement-pas-ecrit')
  })

  it('une requete remise sans reponse — le timeout de 20 s — reste peut-etre ecrite', () => {
    // The likeliest half-write there is: a shared host takes 25 s to insert the
    // page and the client-side budget fires first.
    expect(evidenceFor(true, undefined)).toBe('peut-etre-ecrit')
    expect(evidenceFor(true, 408)).toBe('peut-etre-ecrit')
    expect(evidenceFor(true, 429)).toBe('peut-etre-ecrit')
  })
})
