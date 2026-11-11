#!/usr/bin/env sh
set -eu
if [ "$#" -ne 2 ] || [ "$2" != "--confirm-replace" ]; then
  printf 'Usage: sh scripts/restore.sh BACKUP_DIRECTORY --confirm-replace\n' >&2
  exit 1
fi
restore_path="$1"
test -f "$restore_path/database.dump"
test -f "$restore_path/media.tar.gz"
test -f "$restore_path/manifest.txt"
test "$(head -n 1 "$restore_path/manifest.txt")" = "nhipdang-backup-v1"
docker compose stop web worker
# Keep writers stopped if restore fails; inspect the error before restarting.
docker compose exec -T db pg_restore -U nhipdang -d nhipdang --clean --if-exists --exit-on-error < "$restore_path/database.dump"
docker compose run --rm --no-deps -T --entrypoint tar web -C /app/.data/media -xzf - < "$restore_path/media.tar.gz"
docker compose up -d web worker
printf 'Restore complete. Verify login, a saved image, and pending reminders.\n'
