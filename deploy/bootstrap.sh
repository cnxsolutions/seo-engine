#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# SEO Engine — installation sur un VPS qui HEBERGE DEJA quelque chose
#
#   bash bootstrap.sh seo.mondomaine.fr
#
# Ce script est ecrit pour cohabiter, pas pour s'installer chez lui. La cible
# reelle est un serveur qui sert deja d'autres sites derriere nginx : il ne doit
# donc jamais reconfigurer ce qui existe, ni couper quoi que ce soit.
#
# CE QU'IL NE FAIT PAS, ET POURQUOI
#
#   - Il ne touche PAS au pare-feu. Activer ufw sur un serveur en production
#     n'ouvrirait que 22/80/443 et couperait tout le reste — base distante,
#     monitoring, mail, sauvegardes. Il se contente d'afficher l'etat constate.
#   - Il n'installe PAS Caddy. nginx tient deja les ports 80 et 443 ; deux
#     serveurs web sur les memes ports, c'est au mieux un service mort, au pire
#     l'ancien site qui disparait apres un reboot.
#   - Il n'ECRASE aucun vhost existant. Si le fichier du domaine demande est
#     deja la, il s'arrete et te laisse decider.
#   - Il ne recharge nginx qu'apres un `nginx -t` reussi. Une conf invalide
#     rechargee, ce sont TOUS les sites du serveur qui tombent, pas seulement
#     celui-ci.
#
# CE QU'IL FAIT
#
#   - verifie que le domaine pointe bien sur cette machine (sans quoi aucun
#     certificat ne peut etre emis) ;
#   - installe Docker et nginx s'ils manquent, jamais sinon ;
#   - cree l'utilisateur non-root `deploy`, sa cle SSH et /opt/seo-engine ;
#   - ajoute un vhost qui renvoie vers 127.0.0.1:3000 ;
#   - obtient le certificat avec certbot ;
#   - affiche les quatre valeurs a coller dans les secrets GitHub.
#
# Il est REJOUABLE : chaque etape verifie avant d'agir.
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

DOMAIN="${1:-}"
APP_DIR=/opt/seo-engine
DEPLOY_USER=deploy
APP_PORT=3000

if [[ -z "$DOMAIN" ]]; then
  echo "Usage : bash bootstrap.sh <domaine>"
  echo "Exemple : bash bootstrap.sh seo.cnx-solutions.fr"
  exit 1
fi

if [[ "$(id -u)" -ne 0 ]]; then
  echo "ERREUR — lancer ce script en root."
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

echo "═══ 1/7 — verifications prealables ═══"

# ─── Le domaine doit resoudre, et resoudre VERS CETTE MACHINE ────────────────
# certbot valide en HTTP-01 : Let's Encrypt appelle http://$DOMAIN/.well-known/
# depuis l'exterieur. Si le domaine ne resout pas, ou resout ailleurs, la
# demande echoue — et Let's Encrypt plafonne severement les reessais (5 echecs
# par heure et par compte/domaine). Mieux vaut s'arreter ici.
apt-get update -qq
apt-get install -y -qq dnsutils curl ca-certificates >/dev/null

PUBLIC_IP="$(curl -fsS4 --max-time 10 https://ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')"
RESOLVED="$(dig +short A "$DOMAIN" @1.1.1.1 | tail -1)"

echo "  IP publique de ce serveur : $PUBLIC_IP"
echo "  $DOMAIN resout vers       : ${RESOLVED:-<rien>}"

if [[ -z "$RESOLVED" ]]; then
  cat <<EOF

ERREUR — $DOMAIN ne resout pas.

  Verifie d'abord que le domaine est bien publie au registre :
      dig NS $(echo "$DOMAIN" | rev | cut -d. -f1-2 | rev)

  Un « NXDOMAIN » sur le domaine racine signifie que la delegation n'est pas
  faite chez le registrar, ou que l'enregistrement est trop recent. Les
  enregistrements A du panneau DNS ne servent a rien tant que la zone elle-meme
  n'est pas visible.

  Rien n'a ete modifie sur ce serveur. Relance quand le DNS repond.
EOF
  exit 1
fi

if [[ "$RESOLVED" != "$PUBLIC_IP" ]]; then
  cat <<EOF

ERREUR — $DOMAIN pointe vers $RESOLVED, pas vers ce serveur ($PUBLIC_IP).

  Corrige l'enregistrement A, attends la propagation, puis relance.
  Rien n'a ete modifie.
EOF
  exit 1
fi

echo "  ✓ le DNS pointe bien ici"

# ─── Etat des lieux, purement informatif ─────────────────────────────────────
echo ""
echo "  Ce qui ecoute deja sur 80 et 443 :"
ss -lntp 2>/dev/null | awk 'NR==1 || $4 ~ /:(80|443)$/' | sed 's/^/    /' || true

if command -v ufw >/dev/null 2>&1; then
  echo "  Pare-feu ufw : $(ufw status 2>/dev/null | head -1 | sed 's/^Status: //')"
  echo "    (ce script n'y touche pas — a toi de voir si 80/443 sont bien ouverts)"
fi

echo ""
echo "═══ 2/7 — Docker ═══"
if command -v docker >/dev/null 2>&1; then
  echo "  Deja installe : $(docker --version)"
  docker compose version >/dev/null 2>&1 || {
    echo "  ATTENTION — le plugin 'docker compose' (v2) est absent."
    echo "  Installe-le : apt-get install -y docker-compose-plugin"
    exit 1
  }
else
  echo "  Installation depuis le depot officiel Docker..."
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
  echo "  ✓ $(docker --version)"
fi

echo ""
echo "═══ 3/7 — utilisateur de deploiement ═══"
if id "$DEPLOY_USER" >/dev/null 2>&1; then
  echo "  L'utilisateur $DEPLOY_USER existe deja."
else
  # Sans mot de passe : ce compte n'existe que pour recevoir une session SSH
  # par cle, depuis GitHub Actions.
  adduser --disabled-password --gecos "" "$DEPLOY_USER" >/dev/null
  echo "  ✓ utilisateur $DEPLOY_USER cree"
fi
usermod -aG docker "$DEPLOY_USER"

install -d -m 0700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh"
KEY_PATH="/home/$DEPLOY_USER/.ssh/id_ed25519"
if [[ -f "$KEY_PATH" ]]; then
  echo "  Cle SSH deja presente, conservee."
else
  sudo -u "$DEPLOY_USER" ssh-keygen -t ed25519 -N "" -C "github-actions@seo-engine" -f "$KEY_PATH" >/dev/null
  cat "$KEY_PATH.pub" >> "/home/$DEPLOY_USER/.ssh/authorized_keys"
  chown "$DEPLOY_USER:$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh/authorized_keys"
  chmod 600 "/home/$DEPLOY_USER/.ssh/authorized_keys"
  echo "  ✓ paire de cles generee"
fi

install -d -m 0755 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$APP_DIR"

echo ""
echo "═══ 4/7 — nginx ═══"
if command -v nginx >/dev/null 2>&1; then
  echo "  Deja installe : $(nginx -v 2>&1)"
else
  apt-get install -y -qq nginx
  systemctl enable --now nginx
  echo "  ✓ nginx installe"
fi

VHOST="/etc/nginx/sites-available/$DOMAIN"
if [[ -e "$VHOST" ]]; then
  cat <<EOF

ERREUR — $VHOST existe deja.

  Ce script n'ecrase jamais une configuration en place : sur un serveur qui
  heberge d'autres sites, c'est la seule regle qui protege vraiment.

  Relis-le, supprime-le si tu es sur, puis relance.
  Rien d'autre n'a ete modifie.
EOF
  exit 1
fi

# Vhost en HTTP seul : c'est certbot qui ajoutera le bloc TLS et la redirection
# juste apres. Ecrire soi-meme du 443 avant d'avoir le certificat empeche nginx
# de redemarrer (il refuse de charger un ssl_certificate absent) — et sur ce
# serveur, un nginx qui ne redemarre pas, c'est madrasapp qui tombe avec.
cat > "$VHOST" <<NGINX
# SEO Engine — $DOMAIN
#
# Le conteneur ecoute sur 127.0.0.1:$APP_PORT uniquement. L'application est
# fermee par un secret partage (APP_ACCESS_SECRET, verifie par proxy.ts) envoye
# en HTTP Basic : il circule en base64, reversible. Le TLS ci-dessous n'est donc
# pas un confort, c'est ce qui empeche de lire le secret en clair.
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;

    # Une generation d'article enchaine plusieurs appels LLM et depasse
    # regulierement la minute. Les valeurs par defaut de nginx (60 s) coupent
    # la requete en plein milieu et renvoient un 504 sans raison lisible.
    proxy_read_timeout    300s;
    proxy_send_timeout    300s;
    proxy_connect_timeout 30s;

    # Les reponses en flux de Next.js doivent arriver au fur et a mesure.
    proxy_buffering off;

    client_max_body_size 25m;

    location / {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_http_version 1.1;

        proxy_set_header Host              \$host;
        proxy_set_header X-Real-IP         \$remote_addr;
        proxy_set_header X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade           \$http_upgrade;
        proxy_set_header Connection        "upgrade";
    }
}
NGINX

ln -sfn "$VHOST" "/etc/nginx/sites-enabled/$DOMAIN"

# `nginx -t` AVANT tout rechargement : une conf invalide rechargee ferait
# tomber tous les sites du serveur, pas seulement celui-ci.
if ! nginx -t 2>&1 | sed 's/^/    /'; then
  echo ""
  echo "ERREUR — la configuration nginx est invalide. Le vhost est retire."
  rm -f "/etc/nginx/sites-enabled/$DOMAIN" "$VHOST"
  exit 1
fi
systemctl reload nginx
echo "  ✓ vhost ajoute et nginx recharge (les autres sites n'ont pas bouge)"

echo ""
echo "═══ 5/7 — certificat TLS ═══"
if ! command -v certbot >/dev/null 2>&1; then
  apt-get install -y -qq certbot python3-certbot-nginx
fi

# --nginx : certbot edite le vhost qu'on vient d'ecrire pour y ajouter le bloc
# TLS et la redirection HTTP -> HTTPS. Il ne touche pas aux autres vhosts.
# --redirect rend la redirection explicite plutot que de la laisser au dialogue.
if certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos \
     --register-unsafely-without-email --redirect 2>&1 | sed 's/^/    /'; then
  echo "  ✓ certificat obtenu et vhost bascule en HTTPS"
else
  echo ""
  echo "  ATTENTION — certbot a echoue. Le site reste accessible en HTTP."
  echo "  Causes habituelles : le port 80 n'est pas joignable depuis Internet,"
  echo "  ou la propagation DNS n'est pas terminee."
  echo "  Relancer ensuite :  certbot --nginx -d $DOMAIN --redirect"
fi

echo ""
echo "═══ 6/7 — fichier de configuration ═══"
if [[ -f "$APP_DIR/.env" ]]; then
  echo "  $APP_DIR/.env existe deja, conserve tel quel."
else
  curl -fsSL https://raw.githubusercontent.com/cnxsolutions/seo-engine/main/.env.example \
    -o "$APP_DIR/.env" 2>/dev/null || echo "  (recuperation de .env.example impossible — a creer a la main)"
  chown "$DEPLOY_USER:$DEPLOY_USER" "$APP_DIR/.env" 2>/dev/null || true
  chmod 600 "$APP_DIR/.env" 2>/dev/null || true
  echo "  ✓ modele copie dans $APP_DIR/.env — A REMPLIR"
fi

echo ""
echo "═══ 7/7 — termine ═══"
echo ""
echo "╔════════════════════════════════════════════════════════════════════════╗"
echo "║ A FAIRE MAINTENANT, DANS CET ORDRE                                     ║"
echo "╚════════════════════════════════════════════════════════════════════════╝"
echo ""
echo "1. Remplir la configuration :"
echo ""
echo "     nano $APP_DIR/.env"
echo ""
echo "   Deux valeurs sont bloquantes — sans elles tout repond 503 :"
echo "     APP_ACCESS_SECRET        openssl rand -base64 32"
echo "     WORDPRESS_WEBHOOK_SECRET openssl rand -base64 32"
echo ""
echo "   Et si tu branches Google :"
echo "     GOOGLE_REDIRECT_URI=https://$DOMAIN/api/google/callback"
echo ""
echo "2. Coller ces secrets dans GitHub"
echo "   (Settings > Secrets and variables > Actions > New repository secret) :"
echo ""
echo "   ┌─ VPS_HOST"
echo "   $PUBLIC_IP"
echo ""
echo "   ┌─ VPS_USER"
echo "   $DEPLOY_USER"
echo ""
echo "   ┌─ VPS_KNOWN_HOSTS"
ssh-keyscan -t ed25519 127.0.0.1 2>/dev/null | sed "s|^127.0.0.1|$PUBLIC_IP|"
echo ""
echo "   ┌─ VPS_SSH_KEY  (cle PRIVEE, tout le bloc, lignes BEGIN/END comprises)"
echo ""
cat "$KEY_PATH"
echo ""
echo "3. Merger la pull request. Le premier deploiement part tout seul."
echo ""
