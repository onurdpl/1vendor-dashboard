#!/usr/bin/env bash
set -euo pipefail

negative_proof="${P5_06P_NEGATIVE_PROOF-}"
if [[ "${P5_06P_NEGATIVE_PROOF+x}" == x ]]; then
  [[ "$negative_proof" == 1 && "${GITHUB_ACTIONS:-}" == true &&
     "${GITHUB_REF:-}" == refs/heads/codex/p5-06p-failure-artifact-proof ]] || {
    echo 'Invalid P5-06P shell context.'; exit 1;
  }
fi

if [[ "${1:-}" == --inside ]]; then
  major="${2:?PostgreSQL major required}"
  service="${PG_SERVICE:?PostgreSQL service required}"
  [[ "$major" == 16 || "$major" == 18 ]] || exit 1
  [[ -z "$negative_proof" || ( "$major" == 16 && "${RUNNER_TEMP:-}" == /proof-temp ) ]] || exit 1
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
  export PATH="/usr/lib/postgresql/${major}/bin:$PATH"

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
    if [[ "$negative_proof" == 1 && -s "$RUNNER_TEMP/p5-06p-browser.json" && "$result" == 1 ]]; then
      printf '%s\n' "$result" > "$RUNNER_TEMP/p5-06p-runner-exit"
      echo 'Negative proof smoke runner exited 1 after verified database cleanup.'
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
    if [[ "$negative_proof" == 1 ]]; then
      BROWSER_SMOKE_IPV4_LOOPBACK=1 \
        BROWSER_SMOKE_ALLOW_LOCAL_DB=1 \
        BROWSER_SMOKE_ADMIN_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres \
        node scripts/run-financial-correction-browser-smoke.mjs --scenario=review-credit
      echo 'Negative proof unexpectedly returned success.'
      exit 1
    fi
    # Keep the machine-readable report inside the container. Only the
    # standalone Chromium artifacts and sanitized diagnostics are uploaded.
    mock_report="$(mktemp /tmp/p5-06n-mock.XXXXXX)"
    BROWSER_SMOKE_DOCKER_MOCK=1 PLAYWRIGHT_JSON_OUTPUT_NAME="$mock_report" \
      npm run smoke:browser -- --reporter=list,json,html
    node - "$mock_report" <<'NODE'
const { readFileSync } = require('node:fs');
const { stats } = JSON.parse(readFileSync(process.argv[2], 'utf8'));
if (stats?.expected !== 15 || stats.unexpected !== 0 || stats.flaky !== 0 || stats.skipped !== 0) {
  throw new Error('Docker mock suite must report exactly 15 passes with no failures, retries needed, or skips.');
}
console.log('Docker mock inventory verified: 15 passed, 0 failed, 0 flaky, 0 skipped.');
NODE
    BROWSER_SMOKE_IPV4_LOOPBACK=1 \
      BROWSER_SMOKE_LOGIN_DIAGNOSTICS=1 \
      BROWSER_SMOKE_ALLOW_LOCAL_DB=1 \
      BROWSER_SMOKE_ADMIN_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres \
      npm run smoke:browser:real
    remaining_smoke_databases="$(psql -XAt -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d postgres \
      -c "SELECT count(*) FROM pg_database WHERE datname ~ '^vendor_dashboard_browser_smoke_[0-9]+_[0-9]+$'")"
    [[ "$remaining_smoke_databases" == 0 ]] || { echo 'Real smoke database cleanup not verified.'; exit 1; }
    echo 'All real smoke databases removed.'
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
image="sporgym-p5-06n-shadow:${GITHUB_SHA}"
proof_run_id="${GITHUB_RUN_ID}_${GITHUB_RUN_ATTEMPT:-1}"
network="p506f-${proof_run_id}"
network_id=''
pg16_id=''
pg18_id=''
docker_status=0
browser_name="p506p-browser-${proof_run_id}"
browser_options=()
majors=(16 18)
if [[ "$negative_proof" == 1 ]]; then
  browser_options=(--name "$browser_name" --label "sporgym.p5-06f=${proof_run_id}"
    -e P5_06P_NEGATIVE_PROOF=1 -e "GITHUB_REF=${GITHUB_REF}")
  majors=(16)
fi
cleanup_host() {
  local result=$?
  local browser_remaining owner
  trap - EXIT
  if [[ "$negative_proof" == 1 ]]; then
    browser_remaining="$(docker ps -aq --filter "name=^/${browser_name}$")" || exit 1
    if [[ -n "$browser_remaining" ]]; then
      owner="$(docker inspect --format '{{index .Config.Labels "sporgym.p5-06f"}}' "$browser_remaining")" || exit 1
      [[ "$owner" == "$proof_run_id" ]] || { echo 'Browser container provenance mismatch.'; exit 1; }
      docker rm -f "$browser_remaining" >/dev/null || exit 1
    fi
  fi
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
  if [[ "$negative_proof" == 1 ]]; then
    local remaining_containers remaining_networks
    remaining_containers="$(docker ps -aq --filter "label=sporgym.p5-06f=${proof_run_id}")" || exit 1
    remaining_networks="$(docker network ls -q --filter "label=sporgym.p5-06f=${proof_run_id}")" || exit 1
    [[ -z "$remaining_containers" && -z "$remaining_networks" ]] || {
      echo 'Proof-owned Docker resources remain after cleanup.'; exit 1;
    }
    if [[ "$docker_status" == 1 && "$result" == 1 && -s "$RUNNER_TEMP/p5-06p-browser.json" &&
          -s "$RUNNER_TEMP/p5-06p-runner-exit" ]]; then
      local smoke_runner_exit
      read -r smoke_runner_exit < "$RUNNER_TEMP/p5-06p-runner-exit"
      [[ "$smoke_runner_exit" == 1 ]] || exit 1
      mkdir -p "$RUNNER_TEMP/p5-06p"
      jq -e --argjson dockerExit "$docker_status" --argjson smokeRunnerExit "$smoke_runner_exit" '
        select(.proof == "P5-06P" and .scenario == "review-credit"
          and .stage == "authenticated-admin-before-financial-mutation"
          and .marker == "P5_06P_EXPECTED_BROWSER_FAILURE" and .testOutcome == "failed"
          and .browserExit == 1 and .databaseCleanup == "verified-absent")
        | {proof, scenario, stage, marker, testOutcome, browserExit, databaseCleanup}
          + {dockerExit: $dockerExit, smokeRunnerExit: $smokeRunnerExit, dockerCleanup: "verified-absent"}
      ' "$RUNNER_TEMP/p5-06p-browser.json" > "$RUNNER_TEMP/p5-06p-proof.tmp" || exit 1
      mv "$RUNNER_TEMP/p5-06p-proof.tmp" "$RUNNER_TEMP/p5-06p/failure-proof.json"
    fi
  fi
  echo 'Experimental containers and network cleanup verified.'
  return "$result"
}
trap cleanup_host EXIT

network_id="$(docker network create --label "sporgym.p5-06f=${proof_run_id}" "$network")"
pg16_id="$(docker run -d --network "$network" --name p506f-pg16 \
  --label "sporgym.p5-06f=${proof_run_id}" \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=postgres postgres:16-alpine)"
if [[ "$negative_proof" != 1 ]]; then
  pg18_id="$(docker run -d --network "$network" --name p506f-pg18 \
  --label "sporgym.p5-06f=${proof_run_id}" \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=postgres postgres:18-alpine)"
fi
for id in "$pg16_id" "$pg18_id"; do
  [[ -n "$id" ]] || continue
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

for major in "${majors[@]}"; do
  if [[ "$major" == 16 ]]; then postgres_id="$pg16_id"; else postgres_id="$pg18_id"; fi
  docker run --rm --init --shm-size=1g "${browser_options[@]}" \
    --network "container:${postgres_id}" \
    --security-opt "seccomp=$PWD/.github/ci/p5-06f-seccomp.json" \
    --user "$(id -u):$(id -g)" \
    -e HOME=/tmp/p5-06f-home -e CI=true -e GITHUB_ACTIONS=true \
    -e "PG_SERVICE=p506f-pg${major}" -e "PROOF_RUN_ID=${GITHUB_RUN_ID}" \
    -e PGPASSWORD=postgres -e RUNNER_TEMP=/proof-temp \
    -v "$PWD:/work" -v "$RUNNER_TEMP:/proof-temp" -w /work \
    "$image" bash scripts/ci/p5-06n-browser-shadow.sh --inside "$major" || {
    docker_status=$?
    if [[ "$negative_proof" == 1 ]]; then printf 'Negative proof Docker exit: %s.\n' "$docker_status"; fi
    exit "$docker_status"
  }
done
