# SEO Engine — design : la DA de CNX Solutions appliquée à l'outil

Compagnon de [cadrage.md](cadrage.md) (lots UX-1 à UX-12, écrans ESP et KW). Toute valeur ici est **recopiée** de
la source ; en cas d'écart, la source gagne :

| Source | Ce qu'on y prend |
|---|---|
| `cnx-solutions/brand/README.md` | logo, couleurs de marque, typographie, ton |
| `cnx-solutions/wp-content/themes/cnx-solutions/assets/css/theme.css` (§ 1 Jetons, § 5 Boutons, § 6 Badges, § 7 Cartes) | valeurs exactes et mesurées : contrastes, rayons, ombres, courbe de mouvement |
| `cnx-videos/film-presentation/SPEC.md` et `assets/cnx.css` | les deux registres JOUR / HÉROS, le fil, les règles de mouvement, la liste des interdits |
| `cnx-solutions/.../assets/img/captures/cnx-seo-engine-…` | l'écran actuel du moteur, tel qu'il est montré publiquement |

---

## 1. Ce que l'outil doit dire

Le moteur apparaît déjà dans le film de présentation et sur le site de CNX (« Les vrais écrans de CNX SEO
Engine »). Aujourd'hui, il ne ressemble pas à CNX : palette beige chaude, Inter seule, petits rayons, éclair
générique et sous-titre « AI Content Platform ». Le client qui passe du site CNX à son espace doit sentir qu'il
est **chez le même prestataire**.

Deux registres, empruntés aux films, et rien d'autre :

- **JOUR** — la surface de travail, partout : fond `#f4f5f7`, cartes blanches, filet `#e8eaef`, encre `#08090d`.
  C'est 95 % de l'interface.
- **HÉROS** — le fond marine du site, réservé aux moments qui comptent : écran de connexion, bandeau d'accueil du
  client, en-tête compact d'un site côté opérateur, état vide « première demande ». Jamais derrière un tableau
  de données.

Un seul accent, le **dégradé de marque** (`#0b6cf9 → #5b3df5`), porté par **le fil** (§ 6) et par l'action
principale d'un écran. Une couleur d'accent ne décore pas : elle désigne ce qui se clique ou ce qui avance.

## 2. Avant / après

| | Aujourd'hui (`components/tokens.css`) | Cible CNX |
|---|---|---|
| Fond de page | `#f4f4f1` beige | `#f4f5f7` gris froid |
| Rail | `#edece7` | `#ffffff` + filet `#e8eaef` |
| Carte | `#fcfcfb` | `#ffffff`, filet `#e8eaef` |
| Encre | `#0b0b0b` | `#08090d` |
| Texte courant | `#52514e` / `#6f6d67` | `#2b2f3a` / `#687080` |
| Accent | `#1c5cab` | `#0b6cf9` (survol et petit texte : `#0059e0`) |
| Polices | Inter | **Plus Jakarta Sans** (titres, chiffres, boutons) + Inter (texte) |
| Rayons | 4 → 14 px | 8 → 28 px, boutons et badges en pilule |
| Boutons | rectangles | pilules qui s'allongent au survol |
| Marque | éclair, « SEO Engine · AI Content Platform » | symbole CNX, « CNX SEO Engine » |

## 3. Couleurs — les nouvelles valeurs des jetons existants

On garde **les noms** de `components/tokens.css` et leurs alias de compatibilité : les composants n'ont rien à
changer au L0, seules les valeurs bougent. Contrastes : ceux mesurés par le thème CNX.

| Jeton | Valeur | Origine CNX | Note |
|---|---|---|---|
| `--surface-page` | `#f4f5f7` | `--cnx-surface-2` | |
| `--surface-rail` | `#ffffff` | `--cnx-surface` | séparé par `--line` |
| `--surface-card` · `--surface-raised` | `#ffffff` | `--cnx-surface` | |
| `--surface-inset` | `#f4f5f7` | `--cnx-surface-2` | champ, zone en retrait dans une carte |
| `--surface-hover` | `#fafafb` | `--cnx-surface-3` | |
| `--ink-primary` | `#08090d` | `--cnx-ink` | |
| `--ink-secondary` | `#2b2f3a` | `--cnx-ink-soft` | |
| `--ink-muted` | `#687080` | `--cnx-body` | 4,98:1 sur blanc, 4,56:1 sur `#f4f5f7` |
| `--ink-faint` | `#98a0b0` | `--cnx-muted` | **décor seulement** (2,6:1) : filets, pictos, jamais du texte |
| `--line` · `--line-strong` | `#e8eaef` · `#d9dce4` | `--cnx-line` · `--cnx-line-strong` | |
| `--accent` | `#0b6cf9` | `--cnx-accent` | blanc dessus : 4,64:1 |
| `--accent-hover` · `--accent-text` | `#0059e0` | `--cnx-accent-hover` | petit texte d'accent sur fond pâle (5,3:1) |
| `--accent-wash` · `--accent-wash-strong` | `rgba(11,108,249,.09)` · `.16` | `--cnx-accent-soft(-2)` | |
| `--accent-ring` | `rgba(11,108,249,.32)` | — | anneau de focus, à mesurer au L0 |
| **nouveau** `--brand-grad` | `linear-gradient(135deg,#0b6cf9 0%,#5b3df5 100%)` | `--cnx-accent-grad` | le fil, l'action principale |
| **nouveau** `--hero-1…4` | `#0d1440` · `#16266f` · `#0b4da2` · `#2f7ef0` | `--cnx-hero-*` | registre HÉROS |

Le fond HÉROS se compose comme sur le site et dans les films :
`radial-gradient(120% 90% at 20% 20%, #16266f 0%, #0d1440 60%), linear-gradient(140deg, #0d1440 0%, #0b4da2 100%)`,
avec une tache `#2f7ef0` diffuse. Sur ce fond : texte blanc, badges « verre » du site (`rgba(255,255,255,.14)`,
filet `.2`).

**Statuts** (bon, attention, sérieux, critique) : on garde les quatre teintes validées, toujours accompagnées
d'une icône ou d'un libellé ; le vert passe à `#12a150` (celui des films) si le validateur le confirme contre les
nouvelles surfaces. **Séries de graphiques** : la série 1 est `#0b6cf9`, la série 7 `#6d4aff` (le violet SAP
de la marque), depuis le L6g (UX-11). La palette entière a repassé le validateur dataviz sur la surface des cartes
(`#ffffff`) : bande de luminosité et chroma conformes pour les huit, pire paire voisine ΔE 9,1 sous daltonisme
(cible 8), 19,6 en vision normale (plancher 15). L'aqua, le jaune et le magenta restent sous 3:1 contre le blanc :
chaque graphique garde donc son tableau jumeau (« Voir le tableau »), qui est la condition de leur emploi. La rampe
séquentielle (`--ramp-1…5`) passe ses propres contrôles et ne change pas. Une couleur de série n'est jamais une
couleur de statut, et inversement.

## 4. Typographie

Deux familles, comme le site : **Plus Jakarta Sans** pour tout ce qui se lit d'un coup d'œil (titres, chiffres,
boutons, onglets), **Inter** pour tout ce qui se lit ligne à ligne. Les deux par `next/font/google`
(auto-hébergées, pas de saut de mise en page), publiées en `--font-display` et `--font-sans`.

Un outil est plus dense qu'un site : on garde l'échelle de l'outil, pas les tailles d'affiche du site.

| Rôle | Famille | Graisse | Taille | Interlettrage |
|---|---|---|---|---|
| Titre de page | Jakarta | 700 | 28 px (client mobile : 26) | −0,03 em |
| Titre de section | Jakarta | 700 | 20 px | −0,02 em |
| Titre de carte | Jakarta | 600 | 16 px | −0,01 em |
| Chiffre de tuile | Jakarta | 700 | 32 px, chiffres tabulaires | −0,02 em |
| Chiffre héros (un par vue) | Jakarta | 800 | 48 px | −0,035 em |
| Surtitre | Inter | 700 | 11 px, capitales | +0,14 em, couleur `--accent-text` |
| Texte opérateur | Inter | 400 | 14 px | −0,011 em |
| Texte client | Inter | 400 | **16 px** | — |
| Champs de saisie | Inter | 400 | **16 px partout** | — (en dessous, iOS zoome sur le champ) |
| Méta, légende | Inter | 500 | 12-13 px | — |

## 5. Formes

| Jeton | Valeur | Usage |
|---|---|---|
| `--radius-xs` | 6 px | case à cocher, pastille de couleur |
| `--radius-sm` | 8 px | puce, élément de liste compact |
| `--radius-md` | 12 px | champ, menu déroulant |
| `--radius-lg` | 16 px | carte dense (tableau, tuile) |
| `--radius-xl` | 20 px | carte standard (`.cnx-card`) |
| **nouveau** `--radius-2xl` | 28 px | panneau, modale, bandeau HÉROS |
| `--radius-pill` | 999 px | bouton, badge, onglet segmenté |

Ombres : celles du thème (`--cnx-shadow-xs` à `-lg`), teintées `rgba(9,13,24,…)`. Une carte au repos n'a qu'un
filet ; l'ombre signale ce qui flotte (menu, modale, carte survolée cliquable).

## 6. Le fil — la signature

Dans les films, un trait au dégradé de marque, extrémités rondes, précédé d'un point blanc cerclé, relie les
étapes. Dans l'outil, il devient **la barre d'avancement** — un seul usage par écran :

- la progression de la période en cours (accueil client, en-tête de site) : trait de 6 px, point blanc cerclé à
  la date du jour ;
- la chronologie d'une demande (reçue → analysée → prévue → en ligne) : trait vertical, étapes franchies au
  dégradé, étapes à venir en `--line-strong`.

Il se trace à vitesse régulière (`ease-in-out`), une fois, à l'arrivée ; il ne boucle jamais.

## 7. Composants — du thème CNX à l'outil

| Thème CNX | Composant de l'outil | Ce qui change |
|---|---|---|
| `.cnx-btn` (pilule, `gap` 10 → 17 px au survol, flèche qui part en diagonale) | `Button` (`components/ui.tsx`) | variantes `primary` (encre), `accent` (dégradé, une par écran), `soft`, `ghost`, `danger` ; taille compacte pour la console |
| `.cnx-badge`, `.cnx-badge-accent`, `.cnx-badge-glass` | `StatusBadge`, `RiskBadge`, **nouveau** `VerdictBadge` | pilule, icône 14 px, libellé toujours présent |
| `.cnx-tagline` / surtitre des sections | `PageHeader` (prop `eyebrow`) | surtitre Inter 700 capitales + titre Jakarta |
| `.cnx-card`, `.cnx-card-bordered`, `.cnx-card-accent-hover` | `.card` de `globals.css` | rayon 20, filet ; survol accentué **seulement** si la carte entière est un lien |
| héros du site | **nouveaux** `HeroBand` (bandeau compact) et `AuthShell` (connexion) | registre HÉROS ; aucun nuanceur WebGL |
| `.cx-chip` des films | **nouveau** `Chip` | mot-clé, ville, filtre actif ; retirable au clavier |
| accordéon / FAQ | `Disclosure` | motifs d'un verdict, détail d'un brief |
| formulaires (§ 22 du thème) | `FormField`, `FieldError` | champ 16 px, rayon 12, erreur sous le champ, `aria-describedby` |
| — | **nouveaux** `ConfirmDialog`, `Skeleton`, `Toast`, `Timeline` | remplacent `confirm()`, les « Chargement… » textuels, les alertes muettes |
| icônes du thème (trait 1,7) | `lucide-react` (déjà installé) au trait 1,75 | une seule famille d'icônes |

Composants propres aux demandes (L3) : `KeywordRequestForm`, `RequestCard` (mot-clé, badge de verdict, date,
une phrase de motif), `RequestTimeline` (le fil), `RequestQueueTable` (console, L5).

## 8. Mouvement

Repris du thème et des films, réduit à ce qu'un outil supporte :

| Jeton | Valeur | Usage |
|---|---|---|
| `--ease` | `cubic-bezier(.165,.84,.44,1)` | toutes les transitions |
| `--dur-fast` | 150 ms | couleur, fond, bordure |
| `--dur` | 250 ms | apparition d'un menu, d'un toast |
| `--dur-slow` | 500 ms | l'allongement du bouton au survol (« le survol doit glisser et non claquer ») |

- Listes : entrée échelonnée de 60 ms, opacité et 8 px de translation, au premier rendu seulement. Une liste
  s'y abonne par la classe `.stagger` (`components/ui.css`) : cartes de `/sites`, sélecteurs de site, listes de
  l'espace client. Jamais les tableaux ni les tuiles de chiffres. À partir du neuvième élément, tous arrivent
  ensemble.
- Arrivée d'une modale : 250 ms, échelle 0,98 → 1, le fond en 150 ms. Elle part sans animation, donc plus vite
  qu'elle n'arrive.
- La courbe ne s'écrit que dans `components/tokens.css` : `components/ui-rules.test.ts` refuse toute transition ou
  animation hors `var(--ease)` (hors boucles `linear` : toupie, chatoiement).
- **Aucun rebond, aucun ressort** sur l'interface ; un titre posé ne bouge plus.
- `prefers-reduced-motion: reduce` : plus aucune translation ni échelle, les fondus restent sous 150 ms.

**Interdits** (repris des films, adaptés à l'outil) : halo, néon, particules ; cartes en verre sur fond clair ;
tout centré ; tout en fondu-montée ; grille de dix tuiles de chiffres (quatre au plus par vue) ; chiffre sans
source ; dégradé sur du texte courant.

## 9. Les coquilles

### 9.1 Espace client — mobile d'abord (375 px)

```
┌───────────────────────────────┐
│ [✕] CNX SEO Engine        ☰  │  barre haute blanche, symbole CNX 28 px
│ Plomberie Martin ▾            │  sélecteur de site (si plusieurs)
├───────────────────────────────┤
│░░ HÉROS (compact, rayon 28) ░░│
│ PÉRIODE EN COURS              │  surtitre
│ 20 nov. → 4 déc.              │
│ ━━━━━━━○──────────────        │  le fil, point à aujourd'hui
│ 7 pages prévues · 3 en ligne  │
│ [ + Proposer un mot-clé  → ]  │  bouton accent (dégradé)
├───────────────────────────────┤
│ Vos demandes            Tout →│
│ ┌───────────────────────────┐ │
│ │ plombier urgence troyes   │ │
│ │ ● Prévue le 28 nov.       │ │
│ └───────────────────────────┘ │
│ ┌───────────────────────────┐ │
│ │ adoucisseur d'eau         │ │
│ │ ◐ Gardée pour la période  │ │
│ │   suivante                │ │
│ └───────────────────────────┘ │
│ Dernières pages en ligne      │
│ …                             │
├───────────────────────────────┤
│ Accueil Demandes Pages Résultats│  navigation basse, 4 entrées, cibles ≥ 44 px
└───────────────────────────────┘
```

À partir de 1 024 px : navigation basse → barre latérale fine, contenu sur deux colonnes (demandes à gauche,
période et pages à droite).

### 9.2 Proposer un mot-clé

Feuille montante sur mobile, modale sur ordinateur.

```
Proposer un mot-clé
───────────────────────────────────────────
Mot-clé *
[ plombier urgence troyes            ]
  Ce que vos clients tapent dans Google.

Ville (facultatif)        [ Troyes        ▾ ]
Pourquoi ce mot-clé ? (facultatif)
[ Nouveau service, saison, question         ]
[ fréquente de vos clients…                 ]
Pour quand ?   (•) Dès que possible  ( ) Avant le [__/__]

        [ Envoyer la demande  → ]

Le moteur vérifie en moins d'une minute si ce mot-clé peut entrer
dans la période en cours. Sinon, il le garde pour la suivante :
aucune demande n'est perdue.
```

### 9.3 Le détail d'une demande

```
plombier urgence troyes                       [● Prévue le 28 nov.]
━ Reçue                     25 nov., 14:02
━ Analysée                  25 nov., 14:03
│   Intégrée à la période en cours.
│   Pourquoi : aucune page de votre site ne vise encore cette recherche,
│   et Google la propose quand on tape « plombier troyes ».
━ Prévue                    28 nov.
○ En ligne                  —
                                        [ Retirer la demande ]
```

### 9.4 Résultats Google (client, ESP-5)

```
RÉSULTATS GOOGLE
Vos 28 derniers jours                      [ 28 j ▾ ]
┌─────────────────┐ ┌─────────────────┐
│ Visites depuis  │ │ Apparitions     │   deux tuiles, pas plus
│ Google          │ │ dans Google     │
│ 214   ▲ +18 %   │ │ 9 870  ▲ +6 %   │   variation contre les 28 jours d'avant
└─────────────────┘ └─────────────────┘
┌───────────────────────────────────┐
│  ╱╲    ╱╲╱╲      ╱‾‾╲             │   courbe des visites par jour, série 1
│ ╱  ╲__╱    ╲____╱    ╲__          │
└───────────────────────────────────┘
Les pages qui amènent le plus de visites (5)
Les recherches qui vous trouvent (5)
Source : Google Search Console · du 28 oct. au 24 nov. · mise à jour chaque nuit
```

Sans Search Console reliée : état vide (registre HÉROS) « Vos résultats apparaîtront ici dès que CNX aura relié
votre site à Google », jamais un zéro qui ferait croire à une absence de visites.

### 9.5 Console opérateur — la file des demandes (L5)

```
DEMANDES CLIENTS
Demandes                           [ À examiner 3 ] [ Toutes ] [ Site ▾ ]
┌──────────────┬───────────────────────────┬───────────────────┬─────────┬───────────────────────────┐
│ Site         │ Mot-clé                    │ Verdict du moteur │ Reçue   │                           │
├──────────────┼───────────────────────────┼───────────────────┼─────────┼───────────────────────────┤
│ Martin       │ adoucisseur eau reims      │ ◆ Hors zone       │ il y a 2 h │ [Intégrer] [Reporter] [Refuser…] │
│              │ « nouveau secteur depuis   │   (Reims)         │         │                           │
│              │   octobre »                │                   │         │                           │
└──────────────┴───────────────────────────┴───────────────────┴─────────┴───────────────────────────┘
```

« Refuser… » ouvre une `ConfirmDialog` avec un motif obligatoire, montré tel quel au client.

### 9.6 Console opérateur — la coquille (L5)

Rail blanc de 248 px : symbole CNX + « SEO Engine » en tête ; « Tableau de bord », « Demandes » (avec compteur),
« Sites » ; puis la liste des sites et leurs onglets (`components/site-tabs.ts` reste la seule liste). En dessous
de 1 024 px : barre haute + tiroir. L'en-tête d'un site devient un bandeau HÉROS compact : nom, adresse, période
en cours tracée par le fil.

## 10. Voix et vocabulaire

Le ton du site : simple, sans superlatif, un chiffre vérifiable plutôt qu'un adjectif. L'outil ne montre jamais
un nom de table, de tâche ou de colonne.

| Terme interne | Console opérateur | Espace client |
|---|---|---|
| cycle | Cycle n (du … au …) | Période en cours |
| slot / créneau | Créneau | Page prévue |
| brief | Brief | — (jamais montré) |
| gate / refus de contrôle | Bloquée au contrôle qualité | — |
| `pillar` / `child` / `local_pack` | Page pilier / page détaillée / page locale | — |
| generation | Rédaction | Page |
| `published` | Publiée | En ligne |
| keyword request | Demande client | Votre demande |
| `covered` | Couverte | Déjà couverte |
| `deferred` | Reportée au cycle suivant | Gardée pour la période suivante |
| `review` | À examiner | À l'étude chez CNX |

Chaque terme vit **une** fois dans `lib/glossary.ts` (L5b), avec sa lecture opérateur et sa lecture client ; les
modules de libellés en dérivent (`lib/client-space/labels.ts`, `lib/keyword-requests/operator-labels.ts`), et un
test vérifie qu'aucun libellé client ne contient un mot du moteur. Les libellés client vivent dans **un** module
(`lib/client-space/labels.ts`, à côté de `lib/publishing/refusal-labels.ts`), jamais en dur dans un écran.

## 11. Accessibilité

- Contraste AA partout : les valeurs ci-dessus sont celles que le thème CNX a mesurées ; tout nouveau couple
  texte/fond se mesure avant d'entrer dans `tokens.css`.
- Focus visible : anneau `--accent-ring` de 3 px, jamais retiré.
- Tout statut a un libellé ou une icône, jamais la couleur seule.
- Cibles tactiles ≥ 44 px dans l'espace client ; champs à 16 px.
- La modale piège le focus et se ferme à Échap ; le toast est annoncé (`role="status"`).
- Le lien d'évitement « Aller au contenu » de la console est conservé.

## 12. Ce qu'on ne reprend pas du site CNX

- Le fond WebGL du héros (`hero-shader.js`) : un dégradé CSS suffit, et un outil ne charge pas de nuanceur.
- Les bandeaux défilants, les titres révélés au défilement, les comparateurs d'images.
- Le rythme vertical de 120 px et les tailles d'affiche (`.cnx-display`) : un outil est dense.
- Le monde SAP violet comme habillage de page : le violet ne sert qu'au dégradé de marque et à une série de
  graphique.
- Les photos et les mises en situation dessinées : l'outil montre des données, pas une vitrine.
