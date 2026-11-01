#!/usr/bin/env bash
# Runs as gordo on app-vm. Credentials stay in the existing private deploy env.
set -euo pipefail
export PATH="/home/gordo/.bun/bin:$PATH"
root=/home/gordo/splitter-trigger-release
exec 9>/home/gordo/.config/splitter/deploy.lock
flock -n 9 || exit 0
if [ ! -d "$root/.git" ]; then
  git clone --branch main --single-branch https://github.com/gordo-v1su4/splitter-pro2.git "$root"
fi
cd "$root"
git fetch --quiet origin main
git merge --ff-only origin/main
tree=$(git rev-parse HEAD:orchestration)
stamp=/home/gordo/.config/splitter/deployed-tree
if [ -f "$stamp" ] && [ "$(cat "$stamp")" = "$tree" ]; then exit 0; fi
set -a
. /home/gordo/.config/splitter/trigger-deploy.env
set +a
printf '%s' "$DOCKER_REGISTRY_PASSWORD" | docker login localhost:5000 --username "$DOCKER_REGISTRY_USERNAME" --password-stdin
cd orchestration
bun install --frozen-lockfile
build_log=$(mktemp)
trap 'rm -f "$build_log"' EXIT
# The self-hosted registry uses existing operator credentials, not cloud-issued
# registry credentials. Build/load locally, then push the exact version's image.
CI=1 bun node_modules/trigger.dev/dist/esm/index.js deploy --api-url https://trigger.v1su4.dev --local-build --no-push --skip-update-check | tee "$build_log"
version=$(grep -oE 'Successfully deployed version [0-9.]+' "$build_log" | awk '{print $4}' | tail -1)
test -n "$version"
mapfile -t images < <(docker image ls localhost:5000/trigger/proj_slopwoltlvvujwgohfta --format '{{.Repository}}:{{.Tag}}' | grep -F ":$version.production.")
test "${#images[@]}" -eq 1
docker push "${images[0]}"
printf '%s\n' "$tree" > "$stamp.tmp"
mv "$stamp.tmp" "$stamp"
echo "Splitter Trigger tasks deployed from tree $tree"
