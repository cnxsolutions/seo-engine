// ─────────────────────────────────────────────────────────────────────────────
// The words of the client space, in one place
// docs/design.md § 10 — the tone of the CNX site, never a technical term.
// ─────────────────────────────────────────────────────────────────────────────

import { formatDay } from '@/lib/dates'
import { REQUEST_STATUS_TERMS } from '@/lib/glossary'
import type { ClientRequestView } from '@/src/core/domain/keyword-requests/client-view'
import type { SubmissionProblem } from '@/src/core/domain/keyword-requests/normalize'

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

/**
 * The « Demandes » screen (KW-1 to KW-9). What the engine concluded, said as
 * what it found and what happens next — « refusé » never appears (§ 3.3).
 * To be proofread by CNX (docs/cadrage.md § 5).
 */
export const REQUEST_TEXT = {
  eyebrow: 'Vos demandes',
  title: 'Proposer un mot-clé',
  intro: 'Une recherche que vos clients tapent sur Google, et sur laquelle vous voulez être trouvé ? Proposez-la : nous la comparons à votre site et à votre programme, en quelques minutes.',
  keywordsLabel: 'Mot-clé',
  keywordsHint: 'Un par ligne, 10 au plus. Par exemple : débouchage canalisation.',
  cityLabel: 'Ville',
  cityHint: 'Facultatif : une des communes de votre zone.',
  cityHintNational: 'Facultatif : laissez vide si la recherche ne vise pas une ville.',
  noteLabel: 'Pourquoi ce mot-clé ?',
  noteHint: 'Facultatif : un service nouveau, une question de vos clients… CNX Solutions le lira.',
  desiredByLabel: 'Pour quand ?',
  desiredByHint: 'Facultatif : la date à laquelle vous aimeriez la voir en ligne.',
  submit: 'Envoyer',
  submitted: (count: number) =>
    count === 1 ? 'Demande reçue : l’analyse prend quelques minutes.' : `${count} demandes reçues : l’analyse prend quelques minutes.`,
  // No final period: the day (« 26 nov. ») brings its own.
  duplicate: (keyword: string, day: string) => `« ${keyword} » : vous l’avez déjà demandé le ${day}`,
  full: 'Vous avez déjà 30 demandes en cours sur ce site : CNX Solutions vous recontacte pour en parler.',
  tooMany: (seconds: number) => `Beaucoup d’envois en peu de temps. Réessayez dans ${Math.max(1, Math.ceil(seconds / 60))} min.`,
  unavailable: 'L’envoi n’a pas abouti. Réessayez dans quelques minutes.',
  unreachable: 'Impossible de joindre le serveur. Vérifiez votre connexion.',
  problems: {
    none: 'Saisissez au moins un mot-clé.',
    tooMany: '10 mots-clés au plus par envoi.',
    line: (line: number, problem: 'empty' | 'too_long' | 'too_many_words' | 'url') =>
      `Ligne ${line} : ${
        {
          empty: 'ce mot-clé est vide.',
          too_long: '80 caractères au plus.',
          too_many_words: '8 mots au plus.',
          url: 'une adresse de site n’est pas un mot-clé.',
        }[problem]
      }`,
    cityTooLong: 'Ce nom de ville est trop long.',
    cityUrl: 'Saisissez un nom de ville, pas une adresse.',
    noteTooLong: '500 caractères au plus.',
    desiredByInvalid: 'Cette date n’existe pas.',
    desiredByPast: 'Choisissez une date à venir.',
    desiredByTooFar: 'Choisissez une date dans l’année qui vient.',
  },
  listTitle: 'Vos demandes',
  listEmpty: 'Aucune demande pour l’instant. Proposez un premier mot-clé : CNX Solutions s’occupe du reste.',
  latestTitle: 'Vos dernières demandes',
  propose: 'Proposer un mot-clé',
  seeAll: 'Voir toutes vos demandes',
  desiredBy: (day: string) => `Souhaitée pour le ${day}`,
  viewPage: 'Voir la page',
  withdraw: 'Retirer',
  withdrawTitle: 'Retirer cette demande ?',
  withdrawBody: 'CNX Solutions ne la traitera pas. Vous pourrez la proposer de nouveau plus tard.',
  withdrawConfirm: 'Retirer la demande',
  withdrawLocked: 'Cette demande est déjà en rédaction : elle ne peut plus être retirée.',
  withdrawFailed: 'Le retrait n’a pas abouti. Réessayez dans quelques minutes.',
} as const

/** Each refusal of the form, under its field (rule 1 of § 3.1: refused at input, never stored). */
export function requestProblemMessage(problem: SubmissionProblem): string {
  const { problems } = REQUEST_TEXT
  switch (problem.field) {
    case 'keywords':
      if ('line' in problem) return problems.line(problem.line, problem.code)
      return problem.code === 'too_many' ? problems.tooMany : problems.none
    case 'city':
      return problem.code === 'url' ? problems.cityUrl : problems.cityTooLong
    case 'note':
      return problems.noteTooLong
    case 'desiredBy':
      return problem.code === 'past' ? problems.desiredByPast : problem.code === 'too_far' ? problems.desiredByTooFar : problems.desiredByInvalid
  }
}

/** A request's state, in the client's words (src/core/domain/keyword-requests/client-view.ts). */
export const REQUEST_STATE_LABELS = {
  analysing: { label: REQUEST_STATUS_TERMS.received.client, tone: 'neutral' },
  review: { label: REQUEST_STATUS_TERMS.review.client, tone: 'info' },
  deferred: { label: REQUEST_STATUS_TERMS.deferred.client, tone: 'info' },
  scheduled: { label: REQUEST_STATUS_TERMS.scheduled.client, tone: 'good' },
  in_production: { label: REQUEST_STATUS_TERMS.in_production.client, tone: 'good' },
  published: { label: REQUEST_STATUS_TERMS.published.client, tone: 'good' },
  covered: { label: REQUEST_STATUS_TERMS.covered.client, tone: 'neutral' },
  declined: { label: REQUEST_STATUS_TERMS.declined.client, tone: 'neutral' },
  withdrawn: { label: REQUEST_STATUS_TERMS.withdrawn.client, tone: 'neutral' },
} as const

/** The one sentence under a request: what was found, what happens next. */
export const REQUEST_DETAIL_TEXT = {
  analysing: 'Nous la comparons à votre site et à votre programme : quelques minutes.',
  reviewCity: (city: string) => `${city} n’est pas encore dans votre zone : CNX Solutions regarde avec vous.`,
  review: 'CNX Solutions regarde votre demande et revient vers vous.',
  deferred: 'Elle passera en priorité dans le programme de votre prochaine période.',
  alreadyPlanned: (day: string | null) => (day ? `Elle était déjà au programme : la page est prévue le ${day}` : 'Elle était déjà au programme.'),
  planned: (day: string | null) => (day ? `Elle est au programme : la page est prévue le ${day}` : 'Elle est au programme de cette période.'),
  inProduction: 'La page est en cours d’écriture.',
  published: 'La page est en ligne.',
  won: (position: number) => `Votre site est déjà en position ${position} sur cette recherche.`,
  covered: 'Une page de votre site y répond déjà.',
  coveredNoPage: 'Votre site répond déjà à cette recherche.',
  declined: 'CNX Solutions vous en dira plus.',
  withdrawn: 'Vous avez retiré cette demande.',
} as const

/** A request's state in a word or two — « Prévue le 12 déc. » once a day is known. */
export function requestStateLabel(request: Pick<ClientRequestView, 'state' | 'detail'>): string {
  if (request.state === 'scheduled' && request.detail.kind === 'planned' && request.detail.day) {
    return `Prévue le ${formatDay(request.detail.day)}`
  }
  return REQUEST_STATE_LABELS[request.state].label
}

/**
 * The one sentence under a request, and the page it points to when there is
 * one. The same for the space (RequestItem) and for the e-mails (lib/email):
 * written twice, the two would drift at the first rewording.
 */
export function requestDetailSentence(request: Pick<ClientRequestView, 'state' | 'detail'>): { text: string; url: string | null } {
  const { detail } = request
  switch (request.state) {
    case 'analysing':
      return { text: REQUEST_DETAIL_TEXT.analysing, url: null }
    case 'review':
      return { text: detail.kind === 'city' ? REQUEST_DETAIL_TEXT.reviewCity(detail.city) : REQUEST_DETAIL_TEXT.review, url: null }
    case 'deferred':
      return { text: REQUEST_DETAIL_TEXT.deferred, url: null }
    case 'scheduled': {
      const day = detail.kind === 'planned' && detail.day ? formatDay(detail.day) : null
      const already = detail.kind === 'planned' && detail.already
      return { text: already ? REQUEST_DETAIL_TEXT.alreadyPlanned(day) : REQUEST_DETAIL_TEXT.planned(day), url: null }
    }
    case 'in_production':
      return { text: REQUEST_DETAIL_TEXT.inProduction, url: null }
    case 'published':
      return { text: REQUEST_DETAIL_TEXT.published, url: detail.kind === 'page' ? detail.url : null }
    case 'covered':
      if (detail.kind === 'won') return { text: REQUEST_DETAIL_TEXT.won(detail.position), url: detail.url }
      return detail.kind === 'page' && detail.url
        ? { text: REQUEST_DETAIL_TEXT.covered, url: detail.url }
        : { text: REQUEST_DETAIL_TEXT.coveredNoPage, url: null }
    case 'declined':
      return { text: detail.kind === 'declined' && detail.reason ? detail.reason : REQUEST_DETAIL_TEXT.declined, url: null }
    case 'withdrawn':
      return { text: REQUEST_DETAIL_TEXT.withdrawn, url: null }
  }
}

/** The unsubscribe page of the client e-mails (L7) — /espace/desinscription/[token]. */
export const EMAIL_PREFERENCE_TEXT = {
  eyebrow: 'E-mails de suivi',
  titleSubscribed: 'Ne plus recevoir nos e-mails de suivi ?',
  titleUnsubscribed: 'Vous ne recevez plus nos e-mails de suivi',
  intro: (maskedEmail: string) =>
    `Ces e-mails préviennent ${maskedEmail} quand une demande de mot-clé avance : prévue, en ligne, ou non retenue. Votre espace, lui, reste accessible et à jour.`,
  unsubscribe: 'Ne plus recevoir ces e-mails',
  resubscribe: 'Recevoir à nouveau ces e-mails',
  doneUnsubscribed: { title: 'C’est fait', body: 'Vous ne recevrez plus d’e-mail de suivi. Vous pouvez changer d’avis ici à tout moment.' },
  doneResubscribed: { title: 'C’est fait', body: 'Vous recevrez de nouveau un e-mail quand une de vos demandes avance.' },
  openSpace: 'Ouvrir mon espace',
  tooMany: 'Trop de tentatives : réessayez dans quelques minutes.',
} as const

export const TIMELINE_LABELS = {
  received: 'Reçue',
  analysed: 'Analysée',
  planned: 'Prévue',
  writing: 'En rédaction',
  online: 'En ligne',
  next_period: 'Période suivante',
  withdrawn: 'Retirée',
} as const
