#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# SEO Engine — script de deploiement, execute SUR LE VPS
#
# Televerse dans /opt/seo-engine/ a chaque passage de la CI puis lance par
# .github/workflows/deploy.yml. Il peut aussi se lancer a la main :
#
#   cd /opt/seo-engine
#   IMAGE=ghcr.io/cnxsolutions/seo-engine IMAGE_TAG=sha-a1b2c3d bash deploy.sh
#
# Ce qu'il garantit :
#   - le conteneur ne redemarre PAS tant que la nouvelle image n'est pas
#     integralement telechargee (le `pull` precede l'arret) ;
#   - un deploiement qui ne devient jamais « healthy » est automatiquement
#     annule et la version precedente remise en service ;
#   - il n'existe jamais deux conteneurs a la fois (cf. le cron en memoire).
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

APP_DIR=/opt/seo-engine
COMPOSE_FILE=docker-compose.prod.yml
CONTAINER=seo-engine

# Combien de temps on laisse au conteneur pour devenir « healthy ».
# `start_period` du healthcheck vaut 40 s ; 120 s laisse de la marge a un
# demarrage lent sans faire trainer un deploiement casse.
HEALTH_TIMEOUT=120

: "${IMAGE:?IMAGE manquant (ex: ghcr.io/cnxsolutions/seo-engine)}"
: "${IMAGE_TAG:?IMAGE_TAG manquant (ex: sha-a1b2c3d)}"

# Exportees une fois pour toutes : docker compose interpole la ligne `image:`
# a CHAQUE sous-commande, `logs` compris. Les passer en prefixe de commande
# ferait echouer le `logs` du chemin d erreur — precisement quand on en a besoin.
export IMAGE IMAGE_TAG

cd "$APP_DIR"

# Le .env est cree une fois a la main et n'est JAMAIS touche par un
# deploiement. S'il manque, le conteneur demarrerait sans APP_ACCESS_SECRET et
# repondrait 503 sur toutes les routes : autant echouer ici, avec le motif.
if [[ ! -f .env ]]; then
  echo "ERREUR — $APP_DIR/.env est absent."
  echo "Le creer a partir de .env.example (voir docs/deploiement.md), puis relancer."
  exit 1
fi

# Version actuellement en service, pour pouvoir y revenir. Absente au tout
# premier deploiement : le retour arriere sera alors impossible, et c'est dit.
PREVIOUS_TAG="$(docker inspect --format '{{.Config.Image}}' "$CONTAINER" 2>/dev/null | sed 's/.*://' || true)"
if [[ -n "$PREVIOUS_TAG" ]]; then
  echo "[deploy] version en service : $PREVIOUS_TAG"
else
  echo "[deploy] aucun conteneur en service (premier deploiement)"
fi

echo "[deploy] telechargement de $IMAGE:$IMAGE_TAG"
docker compose -f "$COMPOSE_FILE" pull

# `up -d` recree le conteneur : il l'arrete puis le redemarre, il ne le double
# jamais. C'est exactement ce qu'il faut ici — voir l'avertissement « instance
# unique » en tete du compose. La coupure dure le temps du redemarrage.
echo "[deploy] bascule sur $IMAGE_TAG"
docker compose -f "$COMPOSE_FILE" up -d --remove-orphans

# ─── Attente de l'etat « healthy » ───────────────────────────────────────────
# Un `up -d` qui rend la main ne prouve rien : le process Node peut planter
# trois secondes plus tard sur une variable d'environnement manquante. On
# attend le healthcheck du compose, qui interroge reellement le serveur HTTP.
echo "[deploy] attente du healthcheck (max ${HEALTH_TIMEOUT}s)"
healthy=0
for _ in $(seq 1 $((HEALTH_TIMEOUT / 2))); do
  status="$(docker inspect --format '{{.State.Health.Status}}' "$CONTAINER" 2>/dev/null || echo absent)"
  case "$status" in
    healthy) healthy=1; break ;;
    unhealthy) echo "[deploy] healthcheck en echec"; break ;;
    *) sleep 2 ;;
  esac
done

if [[ "$healthy" -ne 1 ]]; then
  echo ""
  echo "ERREUR — $IMAGE_TAG n'est jamais devenu healthy. Dernieres lignes :"
  docker compose -f "$COMPOSE_FILE" logs --tail 60 "$CONTAINER" || true
  echo ""

  if [[ -n "$PREVIOUS_TAG" ]]; then
    echo "[deploy] retour arriere vers $PREVIOUS_TAG"
    IMAGE="$IMAGE" IMAGE_TAG="$PREVIOUS_TAG" docker compose -f "$COMPOSE_FILE" up -d
    echo "[deploy] $PREVIOUS_TAG remis en service. Le deploiement est ANNULE."
  else
    echo "[deploy] aucune version precedente : le service reste indisponible."
  fi
  exit 1
fi

echo "[deploy] $IMAGE_TAG est healthy"

# ─── Menage ──────────────────────────────────────────────────────────────────
# On garde une semaine d'images : c'est ce qui rend un retour arriere instantane
# (l'image cible est deja sur le disque). Au-dela, elles ne servent plus qu'a
# remplir le disque du VPS.
docker image prune -f --filter "until=168h" >/dev/null 2>&1 || true

# Le healthcheck valide le serveur HTTP, PAS le planificateur. Ces lignes sont
# le seul endroit ou l'on voit que le cron s'est bien arme au demarrage
# (section 8 du README).
echo ""
echo "[deploy] demarrage du planificateur :"
docker compose -f "$COMPOSE_FILE" logs --tail 40 "$CONTAINER" 2>&1 | grep -iE 'schedul|cron' || \
  echo "  (aucune ligne de planificateur dans les 40 dernieres — a verifier : docker compose -f $COMPOSE_FILE logs | grep -i schedul)"
