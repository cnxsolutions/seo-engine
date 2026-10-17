// ─────────────────────────────────────────────────────────────────────────────
// Regeneration policy
// SEO Engine - Which refusals a rewrite can fix
// ─────────────────────────────────────────────────────────────────────────────
//
// A page the gate refuses is written again with its refusal reasons as a
// correction list (lib/scheduler/cron.ts, runCampaignNow). That is only worth
// paying for when the defect is in what the model WROTE.

/**
 * Refusals a rewrite cannot fix, because they hang on what every attempt keeps.
 *
 * The address is reserved before the first token and the focus keyword comes
 * from the plan: a regeneration changes neither. A page refused because its
 * address is taken, or because an existing page already targets the same query,
 * would be refused identically twice more — two full generations paid to learn
 * nothing.
 */
export const NON_REGENERABLE_CODES: ReadonlySet<string> = new Set(['SLUG_COLLISION', 'CANNIBALIZATION'])

/**
 * Whether a rewrite can turn this refusal into a publishable page.
 *
 * Reasons are `CODE: message` (formatBlockingReasons). EVERY reason must be
 * fixable: a refusal that mixes a fixable defect with a cannibalisation would
 * still be held by the cannibalisation after the rewrite, so the attempt would
 * be paid for nothing. An empty list is not a refusal at all.
 */
export function isRegenerable(reasons: readonly string[]): boolean {
  if (reasons.length === 0) return false
  return reasons.every(reason => !NON_REGENERABLE_CODES.has(reason.split(':')[0].trim()))
}
