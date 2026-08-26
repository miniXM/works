#!/usr/bin/env bash
set -euo pipefail

container="${ONLYOFFICE_CONTAINER:-onlyoffice}"
cache_tag="${ONLYOFFICE_CACHE_TAG:-mfggo20260822fix001a}"

for _ in $(seq 1 60); do
  if docker exec "$container" true >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

docker exec -e MFGGO_CACHE_TAG="$cache_tag" "$container" sh -lc '
  set -eu
  root=/var/www/onlyoffice/documentserver/web-apps
  api="$root/apps/api/documents/api.js"
  socket_dir="$root/vendor/socketio"

  if [ ! -f "$socket_dir/socket.io.js" ]; then
    cp "$socket_dir/socket.io.min.js" "$socket_dir/socket.io.js"
  fi

  # Spreadsheet and presentation bundles in different 9.4 builds reference
  # both vendor/socketio and vendor/socket.io. Keep both paths available.
  compat_socket_dir="$root/vendor/socket.io"
  mkdir -p "$compat_socket_dir"
  if [ ! -f "$compat_socket_dir/socket.io.js" ]; then
    cp "$socket_dir/socket.io.js" "$compat_socket_dir/socket.io.js"
  fi

  current=$(grep -o "9\.4\.0-[[:alnum:]_]\{12,\}" "$api" | head -n 1 | cut -d- -f2-)
  if [ -n "$current" ] && [ "$current" != "$MFGGO_CACHE_TAG" ]; then
    sed -i "s/$current/$MFGGO_CACHE_TAG/g" "$api"
  fi

  rm -f "$api.gz"
  printf "set \$cache_tag \"%s\";\n" "$MFGGO_CACHE_TAG" > /etc/nginx/includes/ds-cache.conf
  nginx -t
  nginx -s reload
'
