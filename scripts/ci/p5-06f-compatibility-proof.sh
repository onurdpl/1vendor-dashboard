#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == --inside ]]; then
  major="${2:?PostgreSQL major required}"
  service="${PG_SERVICE:?PostgreSQL service required}"
  [[ "$major" == 16 || "$major" == 18 ]] || exit 1
  [[ "$service" == "p506f-pg${major}" ]] || exit 1
  [[ "$(id -u)" != 0 ]] || { echo 'Proof refuses root execution.'; exit 1; }
  [[ "$(node -p 'process.versions.node.split(".")[0]')" == 20 ]] || {
    echo 'Node 20 contract failed.'; exit 1;
  }
  node --version
  npm --version
  uname -m
  dpkg --print-architecture
  /usr/lib/postgresql/16/bin/psql --version
  /usr/lib/postgresql/16/bin/pg_dump --version
  /usr/lib/postgresql/18/bin/psql --version
  /usr/lib/postgresql/18/bin/pg_dump --version

  mkdir -p "$HOME" "$RUNNER_TEMP/p5-06f"
  artifact_directory="$RUNNER_TEMP/p5-06f"
  database="p5_06f_${major}_${PROOF_RUN_ID:?Proof run ID required}"
  proof="$(openssl rand -hex 16)"
  created=0
  cluster=''
  cleanup_inside() {
    local result=$?
    trap - EXIT
    if [[ "$created" == 1 ]]; then
      local identity remaining
      identity="$(psql -XAt -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d postgres \
        -c "SELECT pg_get_userbyid(datdba) || '|' || (pg_control_system()).system_identifier::text || '|' || shobj_description(oid, 'pg_database') FROM pg_database WHERE datname='${database}'")" || exit 1
      if [[ "$identity" != "postgres|${cluster}|p5-06f:${proof}" ]]; then
        echo 'Disposable database identity mismatch; refusing DROP.'
        exit 1
      fi
      dropdb -h 127.0.0.1 -U postgres "$database" || exit 1
      remaining="$(psql -XAt -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d postgres \
        -c "SELECT count(*) FROM pg_database WHERE datname='${database}'")" || exit 1
      [[ "$remaining" == 0 ]] || exit 1
      echo "PostgreSQL ${major} disposable database cleanup verified."
    fi
    return "$result"
  }
  trap cleanup_inside EXIT

  ready=0
  for _ in {1..30}; do
    if pg_isready -h 127.0.0.1 -p 5432 -U postgres -d postgres >/dev/null 2>&1; then
      ready=1
      break
    fi
    sleep 2
  done
  [[ "$ready" == 1 ]] || { echo 'Disposable PostgreSQL loopback listener did not become ready.'; exit 1; }
  server_address="$(psql -XAt -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d postgres \
    -c 'SELECT host(inet_server_addr())')"
  [[ "$server_address" == '127.0.0.1' ]] || {
    echo "Non-loopback server address ${server_address}; refusing bootstrap proof."; exit 1;
  }
  echo "PostgreSQL ${major} server address from direct loopback connection: ${server_address}."
  localhost_address="$(psql -XAt -v ON_ERROR_STOP=1 -h localhost -U postgres -d postgres \
    -c 'SELECT host(inet_server_addr())')"
  [[ "$localhost_address" == '127.0.0.1' || "$localhost_address" == '::1' ]] || {
    echo "localhost resolved to an unverified server address: ${localhost_address}."; exit 1;
  }
  echo "PostgreSQL ${major} server address from localhost: ${localhost_address}."
  server_major="$(psql -XAt -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d postgres \
    -c 'SELECT current_setting('\''server_version_num'\'')::int / 10000')"
  [[ "$server_major" == "$major" ]] || { echo 'Wrong disposable PostgreSQL server major.'; exit 1; }
  cluster="$(psql -XAt -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d postgres \
    -c 'SELECT system_identifier FROM pg_control_system()')"
  [[ "$cluster" =~ ^[0-9]{15,25}$ ]] || exit 1
  createdb -h 127.0.0.1 -U postgres "$database"
  psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d postgres \
    -c "COMMENT ON DATABASE \"${database}\" IS 'p5-06f:${proof}'" >/dev/null
  created=1
  identity="$(psql -XAt -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d "$database" \
    -c "SELECT current_database() || '|' || current_user || '|' || pg_get_userbyid(datdba) || '|' || (pg_control_system()).system_identifier::text || '|' || current_setting('server_version_num')::int / 10000 || '|' || host(inet_server_addr()) || '|' || inet_server_port() FROM pg_database WHERE datname=current_database()")"
  [[ "$identity" == "${database}|postgres|postgres|${cluster}|${major}|127.0.0.1|5432" ]] || {
    echo 'Disposable database identity check failed.'; exit 1;
  }
  echo "PostgreSQL ${major} exact client and server identity verified through 127.0.0.1:5432."

  if [[ "$major" == 16 ]]; then
    npm ci
    npm --prefix backend ci
    npm run backend:db:generate
    [[ "$(node -p 'require("playwright/package.json").version')" == 1.60.0 ]] || exit 1
    PROOF_ARTIFACT_DIRECTORY="$artifact_directory" node --input-type=module <<'NODE'
import { chromium } from 'playwright';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

if (!existsSync(chromium.executablePath())) throw new Error('Pinned Chromium binary missing');
console.log(`Pinned Chromium binary: ${chromium.executablePath()}`);
const artifactDir = process.env.PROOF_ARTIFACT_DIRECTORY;
if (!artifactDir) throw new Error('Proof artifact directory missing');
const browser = await chromium.launch({ headless: true, chromiumSandbox: true });
try {
  const context = await browser.newContext();
  await context.tracing.start({ screenshots: true, snapshots: true });
  const page = await context.newPage();
  await page.goto('data:text/html,<title>P5-06F proof</title><h1>Chromium ready</h1>');
  if (await page.title() !== 'P5-06F proof') throw new Error('Chromium page assertion failed');
  await page.screenshot({ path: join(artifactDir, 'chromium.png') });
  await context.tracing.stop({ path: join(artifactDir, 'chromium-trace.zip') });
  await context.close();
  for (const file of [join(artifactDir, 'chromium.png'), join(artifactDir, 'chromium-trace.zip')]) {
    if (statSync(file).size <= 0) throw new Error(`Empty proof artifact: ${file}`);
    console.log(`Writable artifact: ${file}`);
  }
  console.log('Nonroot Chromium launch with chromiumSandbox=true verified.');
} finally {
  await browser.close();
}
NODE
    npm run smoke:browser -- tests/e2e/browser-egress-guard.spec.ts
    BROWSER_SMOKE_ALLOW_LOCAL_DB=1 \
      BROWSER_SMOKE_ADMIN_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres \
      npm run smoke:browser:real -- --scenario=review-credit
    for file in "$artifact_directory/chromium.png" "$artifact_directory/chromium-trace.zip"; do
      [[ -s "$file" ]] || { echo "Proof artifact missing after browser smokes: $file"; exit 1; }
    done
    echo 'Proof screenshot and trace preserved outside Playwright output directory.'
  fi
  exit 0
fi

[[ -n "${GITHUB_ACTIONS:-}" && -n "${GITHUB_RUN_ID:-}" && -n "${GITHUB_SHA:-}" ]] || {
  echo 'This proof runs only in GitHub Actions.'; exit 1;
}
image="sporgym-p5-06f-proof:${GITHUB_SHA}"
proof_run_id="${GITHUB_RUN_ID}_${GITHUB_RUN_ATTEMPT:-1}"
network="p506f-${proof_run_id}"
network_id=''
pg16_id=''
pg18_id=''
cleanup_host() {
  local result=$?
  trap - EXIT
  for id in "$pg16_id" "$pg18_id"; do
    [[ -n "$id" ]] || continue
    owner="$(docker inspect --format '{{index .Config.Labels "sporgym.p5-06f"}}' "$id")" || exit 1
    [[ "$owner" == "$proof_run_id" ]] || { echo 'Container provenance mismatch; refusing removal.'; exit 1; }
    docker rm -f "$id" >/dev/null || exit 1
    if docker inspect "$id" >/dev/null 2>&1; then exit 1; fi
  done
  if [[ -n "$network_id" ]]; then
    owner="$(docker network inspect --format '{{index .Labels "sporgym.p5-06f"}}' "$network_id")" || exit 1
    [[ "$owner" == "$proof_run_id" ]] || { echo 'Network provenance mismatch; refusing removal.'; exit 1; }
    docker network rm "$network_id" >/dev/null || exit 1
    if docker network inspect "$network_id" >/dev/null 2>&1; then exit 1; fi
  fi
  echo 'Experimental containers and network cleanup verified.'
  return "$result"
}
trap cleanup_host EXIT

network_id="$(docker network create --label "sporgym.p5-06f=${proof_run_id}" "$network")"
pg16_id="$(docker run -d --network "$network" --name p506f-pg16 \
  --label "sporgym.p5-06f=${proof_run_id}" \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=postgres postgres:16-alpine)"
pg18_id="$(docker run -d --network "$network" --name p506f-pg18 \
  --label "sporgym.p5-06f=${proof_run_id}" \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=postgres postgres:18-alpine)"
for id in "$pg16_id" "$pg18_id"; do
  ready=0
  for _ in {1..30}; do
    if docker exec "$id" pg_isready -U postgres -d postgres >/dev/null 2>&1; then ready=1; break; fi
    sleep 2
  done
  [[ "$ready" == 1 ]] || { echo 'Disposable PostgreSQL container not ready.'; exit 1; }
done

# Read-only diagnostic of the former bridge route. The bootstrap guard sees
# this server-side address, which is distinct from the client URL's localhost.
bridge_address="$(docker run --rm --network "$network" --user "$(id -u):$(id -g)" \
  -e PGPASSWORD=postgres "$image" /usr/lib/postgresql/16/bin/psql \
  -XAt -v ON_ERROR_STOP=1 -h p506f-pg16 -U postgres -d postgres \
  -c 'SELECT host(inet_server_addr())')"
[[ "$bridge_address" != '127.0.0.1' && "$bridge_address" != '::1' ]] || {
  echo 'Bridge-route diagnosis contradicted the expected guard failure; stopping.'; exit 1;
}
[[ -z "$(docker port "$pg16_id" 5432/tcp 2>/dev/null || true)" ]] || {
  echo 'Disposable PostgreSQL unexpectedly published a host port; stopping.'; exit 1;
}
echo "Previous bridge route server address: ${bridge_address}."
echo 'PostgreSQL service has no published host port; the bootstrap Docker fallback cannot authorize that bridge address.'

for major in 16 18; do
  if [[ "$major" == 16 ]]; then postgres_id="$pg16_id"; else postgres_id="$pg18_id"; fi
  docker run --rm --init --shm-size=1g \
    --network "container:${postgres_id}" \
    --security-opt "seccomp=$PWD/.github/ci/p5-06f-seccomp.json" \
    --user "$(id -u):$(id -g)" \
    -e HOME=/tmp/p5-06f-home -e CI=true -e GITHUB_ACTIONS=true \
    -e "PG_SERVICE=p506f-pg${major}" -e "PROOF_RUN_ID=${GITHUB_RUN_ID}" \
    -e PGPASSWORD=postgres -e RUNNER_TEMP=/proof-temp \
    -v "$PWD:/work" -v "$RUNNER_TEMP:/proof-temp" -w /work \
    "$image" bash scripts/ci/p5-06f-compatibility-proof.sh --inside "$major"
done
