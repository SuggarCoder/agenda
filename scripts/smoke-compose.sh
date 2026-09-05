#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"
mkdir -p .runtime
temp=$(mktemp -d "$root/.runtime/compose-smoke.XXXXXX")
project="agenda-smoke-$(date +%s)-$$"

dc() {
    docker compose -p "$project" --env-file "$temp/.env" -f "$root/compose.yaml" "$@"
}
cleanup() {
    status=$?
    trap - EXIT
    if [ "$status" -ne 0 ]; then dc logs --tail=50 || true; fi
    dc down -v --remove-orphans || true
    case "$temp" in "$root"/.runtime/compose-smoke.*) rm -rf -- "$temp" ;; esac
    exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

# The punctuation exercises connection URL encoding and Compose dotenv quoting.
password="$(openssl rand -hex 24)@:%/#"
printf "DOMAIN=test.example.com\nLETSENCRYPT_EMAIL=test@example.com\nPOSTGRES_PASSWORD='%s'\nHTTP_PORT=18080\nHTTPS_PORT=18443\n" "$password" > "$temp/.env"
unset password
dc config --quiet
dc build
dc pull certbot
dc run --rm --no-deps --entrypoint /bin/sh certbot -n /opt/agenda/certbot.sh
dc up -d --wait --wait-timeout 120 nginx

code=$(curl --noproxy '*' -s -o /dev/null -w '%{http_code}' http://127.0.0.1:18080/)
[ "$code" = 503 ]
docker run --rm --network none -v "${project}_acme_webroot:/webroot" nginx:1.28-alpine \
    sh -c 'mkdir -p /webroot/.well-known/acme-challenge; printf challenge-ok > /webroot/.well-known/acme-challenge/test'
[ "$(curl --noproxy '*' -fsS http://127.0.0.1:18080/.well-known/acme-challenge/test)" = challenge-ok ]

install_certificate() {
    openssl req -x509 -newkey rsa:2048 -nodes -days 2 -set_serial "$1" \
        -subj /CN=test.example.com -addext subjectAltName=DNS:test.example.com \
        -keyout "$temp/privkey.pem" -out "$temp/fullchain.pem" 2>/dev/null
    docker run --rm --network none -v "$temp:/input:ro" -v "${project}_letsencrypt:/certs" \
        nginx:1.28-alpine sh -c 'mkdir -p /certs/live/test.example.com /certs/archive/test.example.com; cp /input/privkey.pem "/certs/archive/test.example.com/privkey$1.pem"; cp /input/fullchain.pem "/certs/archive/test.example.com/fullchain$1.pem"; ln -sf "../../archive/test.example.com/privkey$1.pem" /certs/live/test.example.com/privkey.pem; ln -sf "../../archive/test.example.com/fullchain$1.pem" /certs/live/test.example.com/fullchain.pem' sh "$1"
}
tls() {
    curl --noproxy '*' --resolve test.example.com:18443:127.0.0.1 -k -fsS "$@"
}
serial() {
    openssl s_client -connect 127.0.0.1:18443 -servername test.example.com </dev/null 2>/dev/null | openssl x509 -noout -serial 2>/dev/null || true
}
await_serial() {
    attempts=0
    until [ "$(serial)" = "serial=$1" ]; do
        attempts=$((attempts + 1))
        [ "$attempts" -lt 30 ] || { echo 'Timed out waiting for nginx certificate reload.' >&2; return 1; }
        sleep 2
    done
}

install_certificate 1
await_serial 01
tls https://test.example.com:18443/api/health | grep -q '"ok":true'
tls https://test.example.com:18443/students | grep -q '<div id="root">'
tls -D "$temp/headers" -o "$temp/login" \
    -H 'Origin: https://test.example.com' -H 'Content-Type: application/json' \
    -d '{"username":"mkmAdmin","password":"mkmAdmin"}' \
    https://test.example.com:18443/api/auth/login
grep -qi 'set-cookie: agenda_session=.*HttpOnly.*Secure' "$temp/headers"
grep -q 'mkmAdmin' "$temp/login"
code=$(curl --noproxy '*' -s -o /dev/null -w '%{http_code}' http://127.0.0.1:18080/students)
[ "$code" = 308 ]
[ "$(curl --noproxy '*' -fsS http://127.0.0.1:18080/.well-known/acme-challenge/test)" = challenge-ok ]

# A second certificate must become active without restarting nginx.
container_before=$(dc ps -q nginx)
install_certificate 2
await_serial 02
[ "$(dc ps -q nginx)" = "$container_before" ]
tls https://test.example.com:18443/api/health | grep -q '"ok":true'
dc exec -T nginx nginx -t
dc run --rm migrate
echo 'Compose smoke passed: isolated PostgreSQL, migrations, HTTP bootstrap, ACME, HTTPS, SPA, login and automatic certificate reload.'
