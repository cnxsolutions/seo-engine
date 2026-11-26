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
