# Accès en écriture à la fiche Google Business Profile

Ce document existe parce que le chantier B — la génération de posts sur la fiche
établissement — est **totalement inerte tant que Google n'a pas accordé l'accès**,
et qu'aucune lecture du code ne peut dire où en est ce dossier. Le connecteur
peut être écrit, testé et déployé : sans cet accès, chaque `POST localPosts`
échouera.

## Le piège à éviter avant tout

> Si votre quota affiche **0**, l'accès ne vous a **pas** été accordé.
> Ne demandez **pas** une augmentation de quota. Soumettez le formulaire
> **« Application For Basic API Access »**.

C'est la formulation de Google elle-même. Les deux demandes passent par le même
formulaire de contact mais suivent des files différentes : une demande
d'augmentation déposée alors que l'accès de base n'existe pas est rejetée sans
que le motif soit toujours explicite. C'est plusieurs semaines perdues pour une
case mal cochée.

| Situation | Ce qu'il faut demander |
|---|---|
| Quota affiché à 0 | **Application For Basic API Access** |
| Accès accordé, 300 QPM atteints régulièrement | **Quota Increase Request** |

## Conditions d'éligibilité

Elles sont vérifiées par un humain chez Google, pas par un automate.

1. Gérer une fiche établissement **vérifiée et active depuis plus de 60 jours**.
2. Disposer d'un **site web représentant l'entreprise**, et ce site doit être
   celui déclaré sur la fiche.
3. Le compte connecté doit être **OWNER ou MANAGER** de la fiche — un accès en
   lecture ne suffira jamais à publier.

## Le point qui fera rejeter le dossier

Google demande que **le domaine de l'adresse e-mail corresponde au domaine du
site web** déclaré.

Une demande déposée depuis une adresse `@gmail.com` pour une entreprise dont le
site est `exemple.fr` part avec un handicap sérieux. Si une adresse
`@exemple.fr` existe, déposez la demande depuis celle-ci. Si elle n'existe pas,
en créer une avant de déposer coûte moins cher qu'un rejet et un second cycle
d'instruction.

## Étapes, dans l'ordre

1. **Créer ou choisir un projet** dans la Google API Console, et noter son
   **numéro de projet** (pas son identifiant : son numéro) — il est demandé
   dans le formulaire.
2. **Activer les API** nécessaires depuis la bibliothèque d'API du projet. Pour
   ce qu'utilise le moteur :
   - *My Business Account Management API* — lister comptes et établissements
   - *My Business Business Information API* — profil, horaires, catégories
   - l'API historique `mybusiness.googleapis.com` v4, qui porte **localPosts**,
     les avis, les photos et les questions/réponses
3. **Déposer** l'« Application For Basic API Access » via le formulaire de
   contact GBP, avec : nom de l'entreprise, e-mail de contact (voir ci-dessus),
   numéro de projet.
4. **Attendre.** Le délai est variable et sans engagement de Google. Les fils de
   la communauté font état de dossiers restés sans réponse ; en cas de silence
   prolongé, relancer via le même formulaire.
5. À l'octroi, le quota par défaut passe à **300 requêtes par minute** sur la
   plupart des API. Une limite distincte et **non négociable** s'applique aux
   modifications : *10 éditions par minute et par fiche*.

## Ce que le moteur fait en attendant

Rien de ce qui précède ne bloque le chantier A. Le connecteur GBP est écrit pour
échouer proprement :

- il vérifie la présence du scope `business.manage` dans `google_connections.scopes`
  **avant tout appel réseau**, et refuse explicitement plutôt que de partir en
  erreur distante ;
- une écriture dont l'issue est douteuse (timeout, 5xx) est enregistrée comme
  **incertaine** — ni succès ni échec — et n'est jamais retentée à l'aveugle,
  parce qu'un `POST localPosts` n'est pas idempotent ;
- la cadence est plafonnée à une écriture par tick et deux par semaine ISO,
  faute de connaître le quota réellement accordé. Ce plafond est un garde-fou
  assumé, pas une optimisation : le coder plus agressivement reviendrait à
  déguiser une supposition en règle.

## Ce que le dépôt ne peut pas prouver

Les contraintes de format des posts (longueur utile du résumé, comportement réel
des `topicType`, tolérance sur les URL de CTA) sont documentées de façon
incomplète par Google. Les constantes de `lib/publishing/gbp/format.ts` portent
chacune la mention *« à confirmer contre l'API réelle »*. Le premier post publié
sur une fiche de test est ce qui les transformera en faits.

## Sources

- [Usage limits — Google Business Profile APIs](https://developers.google.com/my-business/content/limits)
- [Prerequisites — Google Business Profile APIs](https://developers.google.com/my-business/content/prereqs)
- [Basic setup — Google Business Profile APIs](https://developers.google.com/my-business/content/basic-setup)
- [REST Resource: accounts.locations.localPosts](https://developers.google.com/my-business/reference/rest/v4/accounts.locations.localPosts)
- [Deprecation schedule](https://developers.google.com/my-business/content/sunset-dates)
