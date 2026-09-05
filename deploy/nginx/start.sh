#!/bin/sh
set -eu

# Only a DNS name may be interpolated into nginx configuration or certificate paths.
if ! printf '%s' "${DOMAIN:-}" | grep -Eq '^([a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$' || [ "${#DOMAIN}" -gt 253 ]; then
    echo 'DOMAIN must be a public DNS name without scheme, port or path.' >&2
    exit 1
fi

fingerprint() {
    chain="/etc/letsencrypt/live/$DOMAIN/fullchain.pem"
    key="/etc/letsencrypt/live/$DOMAIN/privkey.pem"
    if [ -s "$chain" ] && [ -s "$key" ]; then
        sha256sum "$chain" "$key" | sha256sum | cut -d ' ' -f 1
    else
        printf 'missing'
    fi
}

render() {
    template=http
    [ "$1" = missing ] || template=https
    envsubst '${DOMAIN}' < "/opt/agenda/$template.template" > /etc/nginx/conf.d/default.conf
}

previous=$(fingerprint)
render "$previous"
nginx -t
nginx -g 'daemon off;' &
master=$!

# Watch certificate contents, including symlink targets changed by Certbot.
# No Docker socket, shared PID namespace or host cron is required.
(
    while sleep 30; do
        next=$(fingerprint)
        if [ "$next" != "$previous" ] && [ "$next" != missing ]; then
            cp /etc/nginx/conf.d/default.conf /tmp/agenda-nginx.previous
            render "$next"
            if nginx -t && nginx -s reload; then
                previous=$next
                echo 'Certificate changed; nginx reloaded successfully.'
            else
                cp /tmp/agenda-nginx.previous /etc/nginx/conf.d/default.conf
                echo 'Certificate reload failed; retaining the running configuration and retrying.' >&2
            fi
        fi
    done
) &
watcher=$!
trap 'kill "$watcher" 2>/dev/null || true; nginx -s quit 2>/dev/null || true' TERM INT QUIT
status=0
wait "$master" || status=$?
kill "$watcher" 2>/dev/null || true
wait "$master" 2>/dev/null || true
exit "$status"
