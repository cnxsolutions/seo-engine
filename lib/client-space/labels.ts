// ─────────────────────────────────────────────────────────────────────────────
// The words of the client space, in one place
// docs/design.md § 10 — the tone of the CNX site, never a technical term.
// ─────────────────────────────────────────────────────────────────────────────

export const SIGN_IN_TEXT = {
  codeSent: 'Si cette adresse a accès à un espace, un code vient d’y être envoyé. Pensez à regarder dans les indésirables.',
  invalidEmail: 'Saisissez une adresse e-mail valide.',
  invalidCodeFormat: 'Le code compte 6 chiffres.',
  codeRejected: 'Ce code ne fonctionne pas : il est peut-être erroné ou expiré. Demandez-en un nouveau si besoin.',
  tooMany: (seconds: number) => `Trop de tentatives. Réessayez dans ${Math.max(1, Math.ceil(seconds / 60))} min.`,
  unavailable: 'L’espace client est momentanément indisponible. Réessayez dans quelques minutes.',
  unreachable: 'Impossible de joindre le serveur. Vérifiez votre connexion.',
  sessionRequired: 'Votre session a pris fin. Reconnectez-vous.',
} as const

/** Why someone lands on the sign-in page, read from `?motif=`. */
export const SIGN_IN_NOTICES = {
  expiree: { tone: 'info', title: 'Votre session a expiré', body: 'Par sécurité, une connexion dure 30 jours. Demandez un nouveau code pour continuer.' },
  revoque: { tone: 'warning', title: 'Votre accès a été retiré', body: 'Cet espace ne vous est plus ouvert. Si c’est une erreur, écrivez à contact@cnx-solutions.fr.' },
  lien: { tone: 'warning', title: 'Ce lien ne fonctionne plus', body: 'Un lien de connexion ne sert qu’une fois et pendant une heure. Demandez un nouveau code ci-dessous.' },
  deconnecte: { tone: 'good', title: 'Vous êtes déconnecté', body: 'À bientôt.' },
} as const

export type SignInNotice = keyof typeof SIGN_IN_NOTICES

export function readSignInNotice(raw: string | string[] | undefined): SignInNotice | null {
  const value = Array.isArray(raw) ? raw[0] : raw
  // `hasOwn`, not `in`: `?motif=constructor` must not reach Object.prototype.
  return value && Object.hasOwn(SIGN_IN_NOTICES, value) ? (value as SignInNotice) : null
}

/** The words of the member's screens (L2). */
export const CLIENT_SPACE_TEXT = {
  noSiteTitle: 'Votre espace est prêt',
  noSiteBody: 'Aucun site n’y est encore rattaché. CNX Solutions s’en occupe : écrivez à contact@cnx-solutions.fr si cela dure.',
  periodEyebrow: 'Période en cours',
  noPeriodTitle: 'Votre prochaine période se prépare',
  noPeriodBody: 'CNX Solutions prépare les prochaines pages de votre site. Elles apparaîtront ici dès le début de la période.',
  upcomingTitle: 'Prochaines pages',
  upcomingEmpty: 'Toutes les pages de la période sont en ligne. Les suivantes arrivent avec la prochaine période.',
  onlineTitle: 'Pages en ligne',
  onlineEmpty: 'Aucune page n’est encore en ligne. Les premières arrivent aux dates prévues ci-dessus.',
  onlineEmptyNoPeriod: 'Aucune page n’est encore en ligne.',
  onlineSource: 'Pages écrites et publiées par CNX Solutions sur votre site.',
} as const

/** What Google makes of a page, said plainly (src/core/domain/client-space/overview.ts). */
export const PAGE_STATE_LABELS = {
  visible: { label: 'Visible sur Google', hint: 'Google a enregistré cette page : elle peut apparaître dans ses résultats.' },
  indexing: { label: 'En cours d’indexation', hint: 'Google ne l’a pas encore enregistrée. Il faut souvent quelques jours, parfois quelques semaines.' },
  checking: { label: 'CNX vérifie cette page', hint: 'Quelque chose empêche Google de l’enregistrer. CNX Solutions s’en occupe.' },
} as const

/** The « Résultats » screen (ESP-5, design.md § 9.4). */
export const RESULTS_TEXT = {
  eyebrow: 'Résultats Google',
  title: (days: number) => `Vos ${days} derniers jours`,
  clicks: 'Visites depuis Google',
  impressions: 'Apparitions dans Google',
  explain: 'Une visite, c’est un clic sur votre site depuis les résultats de Google. Une apparition, c’est votre site affiché dans une recherche, cliqué ou non.',
  versus: (days: number) => `par rapport aux ${days} jours d’avant`,
  noComparison: 'Pas encore assez d’historique pour comparer.',
  curveTitle: 'Visites par jour',
  topPages: 'Les pages qui amènent le plus de visites',
  topQueries: 'Les recherches qui vous trouvent',
  homePage: 'Page d’accueil',
  visits: (count: number) => `${count} ${count > 1 ? 'visites' : 'visite'}`,
  source: (from: string, to: string) => `Source : Google Search Console · du ${from} au ${to} · mise à jour chaque nuit.`,
  notLinkedTitle: 'Vos résultats arrivent bientôt',
  notLinkedBody: 'Ils apparaîtront ici dès que CNX Solutions aura relié votre site à Google. Vous n’avez rien à faire.',
  waitingTitle: 'Les premières données sont en route',
  waitingBody: 'Votre site est relié à Google. Les premiers chiffres arrivent sous quelques jours : Google les publie avec un peu de retard.',
  emptyList: 'Pas encore de visite sur cette période.',
} as const
