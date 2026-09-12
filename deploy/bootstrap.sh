#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# SEO Engine — provisionnement d'un VPS nu (teste sur Contabo / Ubuntu 22.04 et
# 24.04, valable sur toute Debian/Ubuntu recente)
#
# A lancer UNE SEULE FOIS, en root, sur le serveur neuf :
#
#   curl -fsSL https://raw.githubusercontent.com/cnxsolutions/seo-engine/main/deploy/bootstrap.sh -o bootstrap.sh
#   bash bootstrap.sh seo.mondomaine.fr
#
# Ce qu'il installe :
#   - Docker CE + compose plugin (depot officiel, pas la version d'Ubuntu qui
#     est trop ancienne pour `docker compose` v2) ;
#   - Caddy, qui termine le TLS et obtient seul un certificat Let's Encrypt ;
#   - un utilisateur `deploy` non-root, membre du groupe docker, et sa paire de
#     cles SSH — c'est elle que la CI utilisera ;
#   - un pare-feu qui ne laisse passer que 22, 80 et 443 ;
#   - les mises a jour de securite automatiques.
#
# Ce qu'il NE fait pas, volontairement : remplir le .env. Les cles sont saisies
# a la main, une fois, et ne sortent jamais du serveur.
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

DOMAIN="${1:-}"
APP_DIR=/opt/seo-engine
DEPLOY_USER=deploy

if [[ -z "$DOMAIN" ]]; then
  echo "Usage : bash bootstrap.sh <domaine>"
  echo "Exemple : bash bootstrap.sh seo.mondomaine.fr"
  echo ""
  echo "Le domaine doit DEJA pointer sur l'IP de ce serveur (enregistrement A)."
  echo "Caddy demande un certificat des son demarrage : si le DNS n'est pas"
  echo "propage, la demande echoue et Let's Encrypt limite les reessais."
  exit 1
fi

if [[ "$(id -u)" -ne 0 ]]; then
  echo "ERREUR — lancer ce script en root."
  exit 1
fi

echo "═══ 1/6 — paquets de base ═══"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl gnupg ufw unattended-upgrades

# Mises a jour de securite sans intervention. Un VPS qui tourne seul pendant des
# mois et ne recoit aucun correctif est le vrai risque ici, pas le deploiement.
dpkg-reconfigure -f noninteractive unattended-upgrades

echo "═══ 2/6 — Docker ═══"
if ! command -v docker >/dev/null 2>&1; then
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
else
  echo "  Docker deja installe, on passe."
fi

echo "═══ 3/6 — utilisateur de deploiement ═══"
if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
  # Sans mot de passe et sans shell de connexion interactive par mot de passe :
  # ce compte n'existe que pour recevoir une session SSH par cle.
  adduser --disabled-password --gecos "" "$DEPLOY_USER"
fi
usermod -aG docker "$DEPLOY_USER"

install -d -m 0700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh"

KEY_PATH="/home/$DEPLOY_USER/.ssh/id_ed25519"
if [[ ! -f "$KEY_PATH" ]]; then
  sudo -u "$DEPLOY_USER" ssh-keygen -t ed25519 -N "" -C "github-actions@seo-engine" -f "$KEY_PATH" >/dev/null
  cat "$KEY_PATH.pub" >> "/home/$DEPLOY_USER/.ssh/authorized_keys"
  chown "$DEPLOY_USER:$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh/authorized_keys"
  chmod 600 "/home/$DEPLOY_USER/.ssh/authorized_keys"
fi

install -d -m 0755 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$APP_DIR"

echo "═══ 4/6 — Caddy (TLS automatique) ═══"
if ! command -v caddy >/dev/null 2>&1; then
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq
  apt-get install -y -qq caddy
fi

cat > /etc/caddy/Caddyfile <<CADDY
# SEO Engine — terminaison TLS.
#
# Caddy obtient et renouvelle seul le certificat Let's Encrypt : rien a
# programmer, rien a surveiller.
#
# Le HTTPS n'est pas optionnel ici. L'application s'authentifie en HTTP Basic
# (APP_ACCESS_SECRET, verifie par proxy.ts) : le secret circule en base64,
# c'est-a-dire en clair pour qui ecoute. En HTTP simple, il serait lisible a
# chaque requete.
$DOMAIN {
	reverse_proxy 127.0.0.1:3000 {
		# Une generation d'article peut depasser la minute (appels LLM en
		# chaine). Le defaut de Caddy suffit, mais on l'ecrit pour que
		# personne ne cherche ailleurs le jour d'un 504.
		transport http {
			read_timeout 300s
		}
	}

	encode gzip

	log {
		output file /var/log/caddy/seo-engine.log {
			roll_size 10mb
			roll_keep 5
		}
	}
}
CADDY

mkdir -p /var/log/caddy && chown caddy:caddy /var/log/caddy
systemctl enable caddy
systemctl reload caddy 2>/dev/null || systemctl restart caddy

echo "═══ 5/6 — pare-feu ═══"
ufw allow 22/tcp    >/dev/null
ufw allow 80/tcp    >/dev/null
ufw allow 443/tcp   >/dev/null
ufw --force enable  >/dev/null
# Le port 3000 n'est volontairement PAS ouvert : le conteneur est lie a
# 127.0.0.1 et n'est joignable que par Caddy.

echo "═══ 6/6 — termine ═══"
echo ""
echo "╔════════════════════════════════════════════════════════════════════════╗"
echo "║ A FAIRE MAINTENANT, DANS CET ORDRE                                     ║"
echo "╚════════════════════════════════════════════════════════════════════════╝"
echo ""
echo "1. Creer le fichier de configuration (il n'est jamais televerse par la CI) :"
echo ""
echo "     curl -fsSL https://raw.githubusercontent.com/cnxsolutions/seo-engine/main/.env.example \\"
echo "       -o $APP_DIR/.env"
echo "     nano $APP_DIR/.env        # remplir les vraies valeurs"
echo "     chown $DEPLOY_USER:$DEPLOY_USER $APP_DIR/.env && chmod 600 $APP_DIR/.env"
echo ""
echo "   Generer les deux secrets obligatoires :"
echo "     openssl rand -base64 32"
echo ""
echo "2. Renseigner ces secrets de depot sur GitHub"
echo "   (Settings > Secrets and variables > Actions > New repository secret) :"
echo ""
echo "   ┌─ VPS_HOST"
echo "   $(curl -fsS4 https://ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')"
echo ""
echo "   ┌─ VPS_USER"
echo "   $DEPLOY_USER"
echo ""
echo "   ┌─ VPS_KNOWN_HOSTS"
ssh-keyscan -t ed25519 127.0.0.1 2>/dev/null | sed "s|^127.0.0.1|$(curl -fsS4 https://ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')|"
echo ""
echo "   ┌─ VPS_SSH_KEY  (cle PRIVEE, tout le bloc, lignes BEGIN/END comprises)"
echo ""
cat "$KEY_PATH"
echo ""
echo "3. Verifier que $DOMAIN pointe bien sur ce serveur, puis pousser sur main."
echo "   Le premier deploiement partira tout seul."
echo ""
