// ─────────────────────────────────────────────────────────────────────────────
// Publication d'un post de fiche, a la demande
// POST /api/gbp/posts/publish — relancer la fiche a partir d'un post nomme
// ─────────────────────────────────────────────────────────────────────────────
//
// CE QUE CETTE ROUTE FAIT, ET CE QU'ELLE NE FAIT PAS. A lire avant de l'appeler.
//
// Elle NE REPOUSSE PAS la ligne nommee. C'est deliberé et ce n'est pas un
// raccourci : `lib/gbp/posts/run.ts` n'expose aucun point d'entree qui reprenne
// une ligne existante, parce que sa sequence est indivisible — le doute est leve,
// l'angle est choisi, la ligne est ecrite AVANT l'appel distant, puis le gate, le
// connecteur et l'enregistrement s'enchainent. Ecrire ici un second chemin
// « gate → connecteur → record » donnerait au depot deux implementations du
// raisonnement le plus couteux qu'il contienne — « ai-je ecrit ? » — et un
// desaccord entre les deux se paierait en posts doubles sur la fiche d'un client.
//
// Elle relance donc la SEQUENCE COMPLETE pour la fiche de ce post, via
// `runGbpPostNow`. Le post nomme sert a deux choses, et a deux choses seulement :
// designer la campagne qui autorise l'ecriture, et permettre de refuser tout de
// suite les etats depuis lesquels rien ne doit partir.
//
// POURQUOI C'EST QUAND MEME LE BON GESTE POUR UN OPERATEUR. Le premier acte de
// `runGbpPostNow` est la RECONCILIATION des lignes 'incertain' de ce site : une
// relecture de la fiche, jamais un rejeu, avec appariement par empreinte de
// resume. C'est la seule action du produit capable de lever un doute d'ecriture,
// et rien ne part tant qu'il en reste un. Un operateur qui voit une ligne
// incertaine et clique ici obtient exactement ce dont il a besoin : la
// verification, puis la suite — ou le report, avec la phrase qui dit pourquoi.
//
// L'ANGLE ET LA PAGE DU POST NOMME NE SONT PAS REPRIS. Ils seraient refuses par
// construction : la ligne nommee est elle-meme dans la fenetre de rotation, donc
// son propre angle est en cooldown et sa propre page a annoncer aussi. La
// politique choisit a neuf, ce qui est le seul choix qui puisse aboutir.
//
// LE STATUT LU ICI N'EST PAS UN VERROU. La reclamation qui protege reellement est
// interne a `runGbpPostNow` ; un statut lu une fois ne protege rien, deux clics
// simultanes le liraient tous les deux a la meme valeur. Les controles ci-dessous
// existent pour repondre VITE et clairement a un humain, pas pour tenir lieu de
// verrou.

import { NextRequest, NextResponse } from 'next/server'
import { runGbpPostNow } from '@/lib/gbp/posts/run'
import { createServiceClient } from '@/lib/supabase'
import {
  GBP_MIGRATION_MISSING,
  GBP_POST_STATUSES,
  isMissingGbpTable,
  splitReasons,
  type GbpPostStatus,
} from '../feed-types'

/**
 * Ce qu'il faut savoir du post nomme, et rien de plus.
 *
 * Projection deliberement plus etroite que celle du feed : cette route ne rend
 * pas une ligne de liste, elle decide si une sequence peut partir. Le resume, le
 * CTA et les jointures n'entrent dans aucune de ses decisions.
 */
const CLAIM_COLUMNS = 'id,site_id,campaign_id,source,status,remote_name'

/** Ce que la ligne produite rend apres la tentative — l'issue, et rien qu'elle. */
const OUTCOME_COLUMNS = 'status,refusal_kind,error_message,remote_name,remote_search_url,remote_state'

interface ClaimRow {
  id: string
  site_id: string
  campaign_id: string | null
  source: string
  status: string
  remote_name: string | null
}

interface OutcomeRow {
  status: string
  refusal_kind: string | null
  error_message: string | null
  remote_name: string | null
  remote_search_url: string | null
  remote_state: string | null
}

export async function POST(req: NextRequest) {
  try {
    const body: unknown = await req.json().catch(() => ({}))
    const raw = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>
    const postId = typeof raw.postId === 'string' ? raw.postId.trim() : ''

    if (!postId) {
      return NextResponse.json({ error: 'postId est requis' }, { status: 400 })
    }

    const supabase = createServiceClient()
    const claim = await supabase
      .from('gbp_posts')
      .select(CLAIM_COLUMNS)
      .eq('id', postId)
      .maybeSingle()
      .overrideTypes<ClaimRow | null, { merge: false }>()

    if (isMissingGbpTable(claim.error)) {
      return NextResponse.json({ error: GBP_MIGRATION_MISSING }, { status: 503 })
    }
    if (claim.error) throw new Error(claim.error.message)
    if (!claim.data) {
      return NextResponse.json({ error: 'Post introuvable' }, { status: 404 })
    }

    const post = claim.data
    const status = toStatus(post.status)

    // Un post ecrit a la main par le proprietaire sur sa fiche. Il est dans notre
    // journal parce qu'il entre dans le corpus anti-duplication, pas parce qu'il
    // nous appartient.
    if (post.source === 'remote') {
      return NextResponse.json(
        {
          error:
            'Ce post a été écrit à la main sur la fiche. Le moteur le lit pour éviter de le '
            + 'redire ; il ne s’en sert pas comme point de départ.',
          status,
        },
        { status: 409 }
      )
    }

    const blocked = statusRefusal(status, post.remote_name)
    if (blocked) {
      return NextResponse.json({ error: blocked, status }, { status: 409 })
    }

    // Une ligne detachee de toute campagne n'a personne pour autoriser l'ecriture
    // sur la fiche d'un client. Ce n'est pas une panne : c'est l'opt-in strict de
    // `campaigns.gbp_posts_enabled`, qui vaut false par defaut, et qu'aucune
    // campagne ne peut porter ici puisqu'il n'y en a pas.
    if (!post.campaign_id) {
      return NextResponse.json(
        {
          error:
            'Ce post n’est rattaché à aucune campagne : aucune campagne n’a donc autorisé '
            + 'd’écrire sur cette fiche.',
          status,
        },
        { status: 409 }
      )
    }

    // TOUT le reste est decide la : campagne desactivee, fiche non selectionnee,
    // scope business.manage absent, doute non leve, angle en cooldown, aucune
    // page a annoncer, contexte Google manquant. Chacun revient sous la forme
    // d'une phrase francaise prete a afficher, jamais d'une exception.
    const run = await runGbpPostNow({ campaignId: post.campaign_id })

    // Aucune ligne ouverte : la sequence a REPORTE. Ni un succes ni une panne —
    // et c'est aussi par ce chemin que revient « le doute precedent n'est pas
    // levé », qui est le motif le plus important du canal.
    if (!run.postId) {
      return NextResponse.json(
        {
          error: run.reported ?? 'Rien n’a été publié sur la fiche.',
          // Le doute d'ecriture interdit de rejouer. `written: true` n'est pas un
          // succes degrade : c'est l'instruction d'aller VOIR la fiche plutot que
          // de recliquer.
          ...(run.refusalKind ? { refusal_kind: run.refusalKind } : {}),
          ...(status === 'incertain' ? { written: true } : {}),
          status,
          notes: run.problems,
        },
        { status: 422 }
      )
    }

    // La ligne telle qu'elle est APRES la tentative. Elle, et non le rapport de
    // l'appel, est la source de verite : c'est `recordGbpPost` qui a ecrit le
    // statut, l'ancre d'idempotence et l'etat distant, et c'est ce qu'un
    // rechargement de l'ecran montrerait.
    const outcome = await supabase
      .from('gbp_posts')
      .select(OUTCOME_COLUMNS)
      .eq('id', run.postId)
      .maybeSingle()
      .overrideTypes<OutcomeRow | null, { merge: false }>()

    if (outcome.error) throw new Error(outcome.error.message)
    if (!outcome.data) {
      // La ligne a ete ouverte il y a un instant et elle a disparu. Ne pas
      // relancer : le post est peut-etre parti, et c'est la fiche qui repond a
      // cette question, pas cette base.
      return NextResponse.json(
        {
          error:
            'Le post a disparu de la base pendant la publication. Vérifiez la fiche avant toute '
            + 'nouvelle tentative : elle porte peut-être déjà ce post.',
          written: true,
        },
        { status: 500 }
      )
    }

    const row = outcome.data
    const finalStatus = toStatus(row.status)

    if (run.published && finalStatus === 'published') {
      return NextResponse.json({
        success: true,
        postId: run.postId,
        status: finalStatus,
        // Nuls quand la fiche a repondu 2xx sans corps exploitable. Ce n'est PAS
        // un echec : le post existe, il n'est simplement pas identifie, et c'est
        // la relecture par empreinte qui retrouvera son ancre.
        remoteName: row.remote_name,
        searchUrl: row.remote_search_url,
        state: row.remote_state,
        notes: run.problems,
      })
    }

    if (finalStatus === 'incertain') {
      return NextResponse.json(
        {
          error:
            'La fiche n’a ni confirmé ni refusé : ce post existe peut-être déjà. Ne relancez pas — '
            + 'ouvrez la fiche pour vérifier. Un second envoi publierait un doublon visible par vos '
            + 'prospects.',
          written: true,
          postId: run.postId,
          status: finalStatus,
          notes: run.problems,
        },
        { status: 422 }
      )
    }

    // Refus du gate : les raisons existent et sont redigees, dans la forme
    // `CODE: phrase | CODE: phrase` que `gbpRefusalMessage` produit — la meme que
    // pour une page, pour que l'operateur n'ait qu'une lecture a apprendre.
    if (finalStatus === 'rejected') {
      return NextResponse.json(
        {
          error: row.error_message ?? 'Post refusé par le contrôle qualité — il n’a pas été publié.',
          rejected: { reasons: splitReasons(row.error_message), refusal_kind: row.refusal_kind },
          written: false,
          postId: run.postId,
          status: finalStatus,
          notes: run.problems,
        },
        { status: 422 }
      )
    }

    // Echec du connecteur, ou statut inchange. PAS de `rejected` : il n'y a pas
    // de raisons redigees, et en fabriquer donnerait a un incident reseau
    // l'apparence d'un jugement editorial. La vue rend alors le titre seul.
    // `written` suit l'ancre d'idempotence, seule preuve disponible ici qu'une
    // ressource distante porte notre nom.
    return NextResponse.json(
      {
        error: row.error_message ?? 'La publication sur la fiche n’a pas abouti.',
        written: Boolean(row.remote_name),
        ...(row.refusal_kind ? { refusal_kind: row.refusal_kind } : {}),
        postId: run.postId,
        status: finalStatus,
        notes: run.problems,
      },
      { status: 422 }
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erreur interne'
    console.error('[POST /api/gbp/posts/publish]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Pourquoi ce post ne peut pas servir de point de depart, ou `null`.
 *
 * Une phrase par etat plutot qu'un message unique : « impossible depuis le statut
 * publishing » n'apprend rien, alors que « une publication est deja en cours »
 * dit quoi faire — attendre.
 *
 * 'incertain' N'EST PAS refuse ici, et c'est volontaire : c'est precisement
 * l'etat pour lequel cette route a le plus de valeur. La sequence commence par
 * RELIRE la fiche et apparier par empreinte ; si le doute tombe, la ligne passe a
 * 'published' sans qu'un seul octet n'ait ete ecrit sur la fiche, et si le doute
 * persiste, elle reporte. Refuser le clic laisserait l'operateur sans aucun
 * moyen de lever ce doute depuis le produit.
 *
 * 'rejected' n'est pas refuse non plus : la sequence composera un AUTRE post, ce
 * qui est exactement ce qu'un operateur veut apres un refus editorial.
 */
function statusRefusal(status: GbpPostStatus, remoteName: string | null): string | null {
  switch (status) {
    case 'published':
      return remoteName
        ? `Ce post est déjà sur la fiche (${remoteName}). Composez-en un autre plutôt que de le redire.`
        : 'Ce post est déjà publié sur la fiche.'
    case 'publishing':
      return 'Une publication est déjà en cours sur ce post. Rechargez dans un instant.'
    case 'generating':
      return 'Ce post est encore en cours de composition.'
    default:
      return null
  }
}

/**
 * Le statut de la ligne, ou 'incertain' si la base en porte un que
 * `gbp_posts_status_check` interdit.
 *
 * 'incertain' et non 'pending' : les deux seraient faux, mais celui-ci dit
 * litteralement « nous ne savons pas ou en est cette ligne » et conduit a aller
 * la regarder, quand l'autre inviterait a lancer une publication sur une ligne
 * dont l'etat reel est inconnu.
 */
function toStatus(raw: string): GbpPostStatus {
  const known = GBP_POST_STATUSES.find((status) => status === raw)
  if (known) return known
  console.error('[POST /api/gbp/posts/publish] statut hors gbp_posts_status_check', raw)
  return 'incertain'
}
