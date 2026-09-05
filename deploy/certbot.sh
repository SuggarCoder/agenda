#!/bin/sh
set -eu
: "${DOMAIN:?Set DOMAIN}"
: "${LETSENCRYPT_EMAIL:?Set LETSENCRYPT_EMAIL}"
child=
trap '[ -z "$child" ] || kill "$child" 2>/dev/null || true; exit 0' TERM INT

pause() {
    sleep "$1" &
    child=$!
    wait "$child"
    child=
}

while :; do
    # The initial HTTP server serves the webroot before any certificate exists.
    if [ ! -s "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
        if certbot certonly --non-interactive --agree-tos \
            --email "$LETSENCRYPT_EMAIL" --webroot --webroot-path /var/www/certbot \
            --cert-name "$DOMAIN" -d "$DOMAIN"; then
            echo 'Certificate issued. Nginx will enable HTTPS within 30 seconds.'
        else
            echo 'Certificate issuance failed; check DNS and public port 80. Retrying in 5 minutes.' >&2
            pause 300
            continue
        fi
    fi

    # Certbot decides when renewal is due; do not hardcode certificate lifetimes.
    if certbot renew --non-interactive --cert-name "$DOMAIN"; then
        pause 43200
    else
        echo 'Certificate renewal failed; retrying in 1 hour.' >&2
        pause 3600
    fi
done
