#!/bin/bash
# Rehearses deploy/builder/petal-builder-deploy against a fake Docker, a fake
# builder (answered by a fake curl) and a real local git repo. Touches nothing
# outside a temp directory; never talks to the VPS, Docker or GitHub.
#
#   bash deploy/builder/test/rehearse.sh
#
# Scenarios: normal deploy, a job slipping in at the drain (short / medium /
# long), wrong core hash, crashing container, unreachable public URL, a builder
# without drain mode (first upgrade), always busy, interrupted mid-drain,
# concurrent deploy, and the rollback command.
set -uo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
SCRIPT="$HERE/../petal-builder-deploy"
ROOT=$(mktemp -d)
trap 'rm -rf "$ROOT"' EXIT
PASS=0
FAIL=0

ok()   { PASS=$((PASS + 1)); printf '  ok   %s\n' "$1"; }
bad()  { FAIL=$((FAIL + 1)); printf '  FAIL %s\n' "$1"; }
check() { if eval "$2"; then ok "$1"; else bad "$1"; fi; }

# ---- Source tree with a matching agent-core bundle (served by a fake git) ----
setup_git() {
  local g=$ROOT/git
  mkdir -p "$g/builder/src" "$g/builder/vendor"
  echo 'const AGENT_CORE_VERSION = "rehearsal-new";' >"$g/builder/src/server.ts"
  echo 'export const core = 1;' >"$g/builder/vendor/agent-core.mjs"
  GOOD_HASH=$(sha256sum "$g/builder/vendor/agent-core.mjs" | cut -d' ' -f1)
  printf '{"hash":"%s"}\n' "$GOOD_HASH" >"$g/builder/vendor/agent-core.version.json"
  SHA=$(printf 'rehearsal' | sha1sum | cut -d' ' -f1)
  export GOOD_HASH SHA FAKE_GIT_TREE=$g
}

# ---- Fake docker + curl -----------------------------------------------------
write_fakes() {
  local bin=$ROOT/bin
  mkdir -p "$bin"
  cat >"$bin/docker" <<'EOF'
#!/bin/bash
S=$FAKE_STATE
key() { printf '%s' "$1" | tr ':/' '__'; }
ev() { echo "$*" >>"$S/events"; }
img_get() { cat "$S/images/$(key "$1")/$2" 2>/dev/null; }
c_dir() { echo "$S/containers/$1"; }
cmd=$1; shift
case "$cmd" in
  container) [[ $1 == inspect ]] && [[ -d $(c_dir "$2") ]]; exit ;;
  inspect)
    [[ $1 == -f ]] || exit 1
    t=$2 c=$(c_dir "$3"); [[ -d $c ]] || exit 1
    case "$t" in
      *State.Running*) cat "$c/running" ;;
      *State.Restarting*) echo false ;;
      *'{{.Image}}'*|*Config.Image*) cat "$c/image" ;;
      *petal.deploy.sha*) cat "$c/label" ;;
      *) echo "" ;;
    esac ;;
  image)
    sub=$1; shift
    case "$sub" in
      inspect)
        if [[ $1 == -f ]]; then [[ -d $S/images/$(key "$3") ]] || exit 1; img_get "$3" sha; exit 0; fi
        [[ -d $S/images/$(key "$1") ]] ;;
      ls) for d in "$S"/images/*; do [[ -d $d ]] && echo "2026-01-01|$(cat "$d/tag" | cut -d: -f2)"; done ;;
      rm) rm -rf "$S/images/$(key "$1")"; ev "image-rm $1" ;;
    esac ;;
  tag) src=$S/images/$(key "$1") dst=$S/images/$(key "$2"); rm -rf "$dst"; cp -r "$src" "$dst"; echo "$2" >"$dst/tag" ;;
  build)
    tag="" sha="" ver=""
    while [[ $# -gt 0 ]]; do
      case "$1" in
        -t) tag=$2; shift ;;
        --label) case "$2" in petal.deploy.sha=*) sha=${2#*=} ;; petal.agent-core.version=*) ver=${2#*=} ;; esac; shift ;;
      esac; shift
    done
    d=$S/images/$(key "$tag"); mkdir -p "$d"
    echo "$tag" >"$d/tag"; echo "$sha" >"$d/sha"; echo "$ver" >"$d/version"
    echo "${NEW_HASH:-$GOOD_HASH}" >"$d/hash"; echo 1 >"$d/drain"; echo "${NEW_BEHAVIOR:-ok}" >"$d/behavior"
    ev "build $tag" ;;
  rename) mv "$(c_dir "$1")" "$(c_dir "$2")"; ev "rename $1 $2" ;;
  stop)
    name=${@: -1}; c=$(c_dir "$name")
    ev "stop $name busy=$(cat "$S/busy") drained=$([[ -f $c/drain ]] && echo 1 || echo 0)"
    echo false >"$c/running" ;;
  run)
    name="" label="" image=${@: -1}
    while [[ $# -gt 0 ]]; do
      case "$1" in --name) name=$2; shift ;; --label) label=${2#*=}; shift ;; esac; shift
    done
    c=$(c_dir "$name"); mkdir -p "$c"
    echo "$image" >"$c/image"; echo "$label" >"$c/label"
    if [[ $(img_get "$image" behavior) == crash ]]; then echo false >"$c/running"; else echo true >"$c/running"; fi
    ev "run $name $image" ;;
  rm) [[ $1 == -f ]] && shift; rm -rf "$(c_dir "$1")"; ev "rm $1" ;;
  start)
    c=$(c_dir "$1"); echo true >"$c/running"
    # A drain-capable builder deletes the drain file when it starts.
    [[ $(img_get "$(cat "$c/image")" drain) == 1 ]] && rm -f "$c/drain"
    ev "start $1" ;;
  logs) : ;;
  exec)
    c=$(c_dir "$1"); [[ $(cat "$c/running" 2>/dev/null) == true ]] || exit 1
    case "$2" in
      touch)
        touch "$c/drain"; ev "drain-on $1 busy=$(cat "$S/busy")"
        if [[ -n ${SLIP_SECONDS:-} && ! -f $S/slipped ]]; then
          touch "$S/slipped"; echo 1 >"$S/busy"
          ( sleep "$SLIP_SECONDS"; echo 0 >"$S/busy" ) >/dev/null 2>&1 &
        fi ;;
      rm) rm -f "$c/drain"; ev "drain-off $1" ;;
    esac ;;
  *) echo "fake docker: unsupported $cmd" >&2; exit 1 ;;
esac
EOF
  cat >"$bin/curl" <<'EOF'
#!/bin/bash
S=$FAKE_STATE
url=${@: -1}
key() { printf '%s' "$1" | tr ':/' '__'; }
c=$S/containers/petal-builder
[[ $(cat "$c/running" 2>/dev/null) == true ]] || exit 7
[[ $url == https://* && -f $S/public_down ]] && exit 22
img=$S/images/$(key "$(cat "$c/image")")
case "$url" in
  */agent/healthz)
    printf '{"ok":true,"version":"%s","coreHash":"%s","inProcess":true,"inFlight":0,"queued":0}\n' \
      "$(cat "$img/version")" "$(cat "$img/hash")" ;;
  */healthz)
    busy=$(cat "$S/busy")
    if [[ $(cat "$img/drain") == 1 ]]; then
      dr=false; [[ -f $c/drain ]] && dr=true
      printf '{"ok":true,"drain":true,"draining":%s,"inFlight":%s,"queued":0,"execInFlight":0,"execQueued":0,"active":[]}\n' "$dr" "$busy"
    else
      printf '{"ok":true,"inFlight":%s,"queued":0,"execInFlight":0,"execQueued":0,"active":[]}\n' "$busy"
    fi ;;
  *) exit 22 ;;
esac
EOF
  cat >"$bin/git" <<'EOF'
#!/bin/bash
# Only the subcommands petal-builder-deploy uses, over a plain directory.
while [[ $1 == -c || $1 == -C ]]; do shift 2; done
sub=$1; shift
case "$sub" in
  fetch) exit 0 ;;
  cat-file)
    if [[ $1 == -e ]]; then [[ ${2%%^*} == "$SHA" ]]; exit; fi
    [[ $1 == blob ]] || exit 1
    [[ ${2%%:*} == "$SHA" ]] || exit 1
    cat "$FAKE_GIT_TREE/${2#*:}" ;;
  merge-base) [[ $2 == "$SHA" && -z ${NOT_ON_MAIN:-} ]] ;;
  archive) [[ $1 == "$SHA" ]] && tar -C "$FAKE_GIT_TREE" -c "$2" ;;
  *) exit 1 ;;
esac
EOF
  chmod +x "$bin/docker" "$bin/curl" "$bin/git"
}

# ---- Fresh world per scenario -----------------------------------------------
# $1 = old image supports drain (1/0)
reset_world() {
  W=$ROOT/w-$RANDOM$RANDOM
  export FAKE_STATE=$W/state
  mkdir -p "$FAKE_STATE/images" "$FAKE_STATE/containers/petal-builder" "$W/opt/petal-builder" "$W/log" "$W/lock"
  echo 0 >"$FAKE_STATE/busy"; : >"$FAKE_STATE/events"
  local d=$FAKE_STATE/images/petal-builder_live
  mkdir -p "$d"; echo petal-builder:live >"$d/tag"; echo old >"$d/sha"; echo rehearsal-old >"$d/version"
  echo oldhash >"$d/hash"; echo "${1:-1}" >"$d/drain"; echo ok >"$d/behavior"
  local c=$FAKE_STATE/containers/petal-builder
  echo true >"$c/running"; echo petal-builder:live >"$c/image"; echo old >"$c/label"
  echo 'BUILDER_SHARED_SECRET=x' >"$W/opt/petal-builder/.env"
  mkdir -p "$W/src"

  # Script copy pointed at the temp world, with short timings and the config
  # drift check stubbed (it inspects real Docker JSON; unchanged by drain).
  sed -e "s#/opt/petal-source#$W/src#; s#/opt/petal-builder#$W/opt/petal-builder#g" \
      -e "s#/var/log/petal-builder-deploy#$W/log#; s#/run/lock/#$W/lock/#" \
      -e "s#^export PATH=.*#export PATH=$ROOT/bin:/usr/local/bin:/usr/bin:/bin#" \
      -e 's#^readonly IDLE_TIMEOUT_S=.*#readonly IDLE_TIMEOUT_S=${T_IDLE_TIMEOUT:-20}#' \
      -e 's#^readonly IDLE_POLL_S=.*#readonly IDLE_POLL_S=1#' \
      -e 's#^readonly DRAIN_SETTLE_S=.*#readonly DRAIN_SETTLE_S=5#' \
      -e 's#^readonly DRAIN_POLL_S=.*#readonly DRAIN_POLL_S=1#' \
      -e 's#^readonly HEALTH_TIMEOUT_S=.*#readonly HEALTH_TIMEOUT_S=8#' \
      "$SCRIPT" >"$W/deploy.sh"
  python3 - "$W/deploy.sh" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
a = s.index("check_config_drift() {"); b = s.index("\nrun_args() {")
s = s[:a] + '''check_config_drift() {
  [[ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER")" == "true" ]] || die "container $CONTAINER is not running; refusing to deploy"
  CARRY_SHM=0; CARRY_INIT=false; CARRY_MEMSWAP=0; CARRY_LOG_DRIVER=""; CARRY_LOG_OPTS=()
  log "live config matches expected (rehearsal stub)"
}
''' + s[b:]
open(p, "w").write(s)
PY
}

run_deploy() { bash "$W/deploy.sh" deploy "$SHA" >"$W/out" 2>&1; echo $?; }
events() { cat "$FAKE_STATE/events"; }
live_image() { cat "$FAKE_STATE/containers/petal-builder/image"; }
live_running() { cat "$FAKE_STATE/containers/petal-builder/running"; }
drain_left() { [[ -f $FAKE_STATE/containers/petal-builder/drain ]]; }
stops_while_busy() { grep -E '^stop petal-builder-prev busy=[1-9]' "$FAKE_STATE/events" | wc -l; }

setup_git
write_fakes
SHORT=${SHA:0:12}

echo "1) normal deploy"
reset_world 1; rc=$(run_deploy)
check "exit 0" '[[ $rc == 0 ]]'
check "drain switched on before the stop" 'events | grep -n -E "^(drain-on|stop)" | head -1 | grep -q drain-on'
check "stopped only while idle and drained" 'events | grep -q "^stop petal-builder-prev busy=0 drained=1"'
check "new image live" '[[ $(live_image) == petal-builder:$SHORT && $(live_running) == true ]]'
check "new builder not drained" '! drain_left'
check "old container removed" '[[ ! -d $FAKE_STATE/containers/petal-builder-prev ]]'
echo "   rollback command:"
rc=$(bash "$W/deploy.sh" rollback >"$W/out2" 2>&1; echo $?)
check "rollback exit 0" '[[ $rc == 0 ]]'
check "rollback restored previous image" '[[ $(live_image) == petal-builder:previous ]]'
check "rolled-back image kept" '[[ -d $FAKE_STATE/images/petal-builder_rolled-back ]]'
check "rollback left no drain" '! drain_left'

echo "2) job slips in right at the drain and finishes within the drain window"
reset_world 1; rc=$(SLIP_SECONDS=3 run_deploy)
check "exit 0" '[[ $rc == 0 ]]'
check "waited for the slipped job while drained" 'grep -q "accepted just before the drain" "$W/out"'
check "never stopped while a job ran" '[[ $(stops_while_busy) == 0 ]]'

echo "3) slipped job outlasts the drain window, then finishes"
reset_world 1; rc=$(SLIP_SECONDS=8 run_deploy)
check "exit 0" '[[ $rc == 0 ]]'
check "drain lifted while the job ran" 'events | grep -q "^drain-off"'
check "drained again before the stop" '[[ $(events | grep -c "^drain-on") -ge 2 ]]'
check "never stopped while a job ran" '[[ $(stops_while_busy) == 0 ]]'

echo "4) slipped job outlasts the whole deploy window"
reset_world 1; rc=$(T_IDLE_TIMEOUT=10 SLIP_SECONDS=40 run_deploy)
check "deferred (exit 75)" '[[ $rc == 75 ]]'
check "nothing swapped" '! events | grep -q "^stop" && [[ $(live_image) == petal-builder:live ]]'
check "drain lifted" '! drain_left'

echo "5) new version reports the wrong core hash"
reset_world 1; start=$(date +%s); rc=$(NEW_HASH=0000 run_deploy); took=$(( $(date +%s) - start ))
check "exit 1" '[[ $rc == 1 ]]'
check "previous builder restored and running" '[[ $(live_image) == petal-builder:live && $(live_running) == true ]]'
check "restored builder accepts jobs (drain cleared)" '! drain_left'
check "failed fast (${took}s, health timeout is 8s)" '(( took < 8 ))'

echo "6) new container crashes on start"
reset_world 1; rc=$(NEW_BEHAVIOR=crash run_deploy)
check "exit 1" '[[ $rc == 1 ]]'
check "previous builder restored" '[[ $(live_image) == petal-builder:live && $(live_running) == true ]] && ! drain_left'
check "crash detected" 'grep -q "container exited" "$W/out"'

echo "7) public URL never comes back"
reset_world 1; touch "$FAKE_STATE/public_down"; rc=$(run_deploy)
check "exit 1" '[[ $rc == 1 ]]'
# The fake proxy is down for both versions; restore only checks localhost.
check "previous builder restored" '[[ $(live_image) == petal-builder:live && $(live_running) == true ]] && ! drain_left'

echo "8) running builder predates drain mode (first upgrade)"
reset_world 0; rc=$(run_deploy)
check "exit 0" '[[ $rc == 0 ]]'
check "fell back to the idle gate" 'grep -q "has no drain mode" "$W/out"'
check "no drain attempted" '! events | grep -q "^drain-on"'
check "new image live" '[[ $(live_image) == petal-builder:$SHORT ]]'

echo "9) builder always busy"
reset_world 1; echo 2 >"$FAKE_STATE/busy"; rc=$(T_IDLE_TIMEOUT=4 run_deploy)
check "deferred (exit 75)" '[[ $rc == 75 ]]'
check "never drained or stopped" '! events | grep -q -E "^(drain-on|stop)"'

echo "10) deploy interrupted while draining"
reset_world 1
SLIP_SECONDS=40 bash "$W/deploy.sh" deploy "$SHA" >"$W/out" 2>&1 &
pid=$!
for _ in $(seq 1 40); do events | grep -q "^drain-on" && break; sleep 0.5; done
sleep 1; kill -TERM "$pid"; wait "$pid"; rc=$?
check "exited on the signal (rc=$rc)" '[[ $rc == 130 ]]'
check "drain lifted on the way out" '! drain_left'
check "nothing swapped" '[[ $(live_image) == petal-builder:live ]]'

echo "11) commit not on main"
reset_world 1; rc=$(NOT_ON_MAIN=1 run_deploy)
check "refused (exit 3)" '[[ $rc == 3 ]]'
check "nothing touched" '[[ ! -s $FAKE_STATE/events ]]'

echo "12) second deploy while one is running"
reset_world 1
( flock 9; sleep 3 ) 9>"$W/lock/petal-builder-deploy.lock" &
sleep 0.5; rc=$(run_deploy); wait
check "refused (exit 73)" '[[ $rc == 73 ]]'

echo
echo "passed: $PASS  failed: $FAIL"
[[ $FAIL == 0 ]]
