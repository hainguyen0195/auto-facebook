#!/usr/bin/env sh
set -eu
umask 077
backup_root="${1:-.data/backups}"
backup_stamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_path="$backup_root/$backup_stamp"
mkdir -p "$backup_path"
# Pause writers so the database and media belong to the same restore point.
docker compose stop web worker
trap 'docker compose up -d web worker' EXIT INT TERM
docker compose exec -T db pg_dump -U nhipdang -d nhipdang -Fc > "$backup_path/database.dump.partial"
docker compose run --rm --no-deps -T --entrypoint tar web -C /app/.data/media -czf - . > "$backup_path/media.tar.gz.partial"
mv "$backup_path/database.dump.partial" "$backup_path/database.dump"
mv "$backup_path/media.tar.gz.partial" "$backup_path/media.tar.gz"
printf 'nhipdang-backup-v1\n%s\n' "$backup_stamp" > "$backup_path/manifest.txt"
printf 'Backup complete: %s\n' "$backup_path"
