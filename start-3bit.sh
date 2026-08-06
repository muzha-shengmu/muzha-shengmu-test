#!/usr/bin/env bash
#
# start-3bit.sh — serve DeepSeek-V4-Flash on ds4 using a 3-bit GGUF.
#
# The stock MiaAI-Lab/DeepSeek-v4-Flash-One-DGX-Spark start.sh always boots
# antirez's own 2-bit ship recipe (IQ2XXS-w2Q2K-AProjQ8-SExpQ8-OutQ8). That is
# the only quant antirez's quantizer emits — gguf-tools outputs q8_0, q8_K,
# q4_K, q2_K and iq2_xxs, and nothing 3-bit.
#
# The ds4 *engine*, however, reads far more than its quantizer writes: the
# CUDA MMQ path carries kernels for GGML_TYPE_Q3_K, GGML_TYPE_IQ3_XXS and
# GGML_TYPE_IQ3_S, and ds4.c's gguf_types[] table knows q3_k (11), iq3_xxs
# (18) and iq3_s (21). So a third-party 3-bit GGUF — Unsloth's UD-IQ3_* —
# loads and serves fine. That is what this script sets up.
#
# It does not fork or patch ds4-on-spark. It runs the normal installer to get
# the engine built, then points the normal ds4-serve launcher at a different
# GGUF via the env vars it already honours (DS4_GGUF_DIR / GGUF_FILE).
#
# Usage:
#   ./start-3bit.sh                     # UD-IQ3_S, ctx 16384, :8888
#   QUANT=UD-IQ3_XXS ./start-3bit.sh    # smaller 3-bit if IQ3_S won't fit
#   CTX=8192 ./start-3bit.sh            # tighter context budget
#   NO_SPEC=1 ./start-3bit.sh           # drop the drafter, reclaim its VRAM
#   SKIP_INSTALL=1 ./start-3bit.sh      # engine already built, just serve
#
# Env:
#   QUANT         UD-IQ3_S     Unsloth quant folder to pull
#   CTX           16384        context budget (KV ~= 9.5 KiB/token)
#   PORT          8888         server port
#   HOST          127.0.0.1    bind address
#   NO_SPEC       0            1 = plain decode, no speculation models loaded
#   NO_DSPARK     0            1 = skip the DSpark drafter only
#   HF_MODEL      unsloth/DeepSeek-V4-Flash-0731-GGUF
#   DS4_SRC_DIR   ~/code/ds4   where ds4-server gets built
#   DS4_GGUF_DIR  ~/gguf       weights directory
#   SKIP_INSTALL  0            1 = don't run the ds4-on-spark installer
#
# Requires: a DGX Spark (GB10/SM121) or other sm_120/sm_121 Blackwell box,
# CUDA 13, bash, curl, python3.

set -euo pipefail

QUANT="${QUANT:-UD-IQ3_S}"
CTX="${CTX:-16384}"
PORT="${PORT:-8888}"
HOST="${HOST:-127.0.0.1}"
NO_SPEC="${NO_SPEC:-0}"
NO_DSPARK="${NO_DSPARK:-0}"
HF_MODEL="${HF_MODEL:-unsloth/DeepSeek-V4-Flash-0731-GGUF}"
DS4_SRC_DIR="${DS4_SRC_DIR:-$HOME/code/ds4}"
DS4_GGUF_DIR="${DS4_GGUF_DIR:-$HOME/gguf}"
SKIP_INSTALL="${SKIP_INSTALL:-0}"

INSTALLER=https://raw.githubusercontent.com/Entrpi/ds4-on-spark/main/install.sh
HF_ENDPOINT="${HF_ENDPOINT:-https://huggingface.co}"

log()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m  ok\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mwarn\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31merror\033[0m %s\n' "$*" >&2; exit 1; }

for c in curl python3; do
    command -v "$c" >/dev/null 2>&1 || die "$c is required"
done

# ---------------------------------------------------------------------------
# 0. already serving?
# ---------------------------------------------------------------------------
if curl -sf "http://$HOST:$PORT/v1/models" >/dev/null 2>&1; then
    log "Already serving on :$PORT — nothing to do."
    curl -s "http://$HOST:$PORT/v1/models" | python3 -m json.tool 2>/dev/null || true
    echo
    echo "Restart with:  pkill -x ds4-server; $0"
    exit 0
fi

# ---------------------------------------------------------------------------
# 1. build the engine (normal ds4-on-spark installer, no --start)
# ---------------------------------------------------------------------------
# The installer's own weight step downloads the 2-bit ship recipe. We let it
# do that only if the user hasn't already got an engine, because it is also
# what builds ds4-server and installs ds4-serve. If you already ran start.sh
# once, set SKIP_INSTALL=1 and this whole step is skipped.
if [ "$SKIP_INSTALL" = 1 ] || [ -x "$DS4_SRC_DIR/ds4-server" ]; then
    if [ -x "$DS4_SRC_DIR/ds4-server" ]; then
        ok "engine present: $DS4_SRC_DIR/ds4-server"
    else
        die "SKIP_INSTALL=1 but $DS4_SRC_DIR/ds4-server is missing"
    fi
else
    log "Building the ds4 engine via the ds4-on-spark installer ..."
    warn "the installer also fetches the 2-bit ship GGUF (~87 GiB); that is its"
    warn "normal behaviour and it is what smoke-tests the build. Keep it or"
    warn "delete it afterwards to make room for the 3-bit set."
    tmp="$(mktemp)"; trap 'rm -f "$tmp"' EXIT
    curl -fsSL "$INSTALLER" -o "$tmp"
    # no --start: we boot it ourselves against the 3-bit weights
    DS4_SRC_DIR="$DS4_SRC_DIR" DS4_GGUF_DIR="$DS4_GGUF_DIR" bash "$tmp"
    [ -x "$DS4_SRC_DIR/ds4-server" ] || die "installer finished but ds4-server is missing"
fi

# ---------------------------------------------------------------------------
# 2. resolve the 3-bit shards on the Hub
# ---------------------------------------------------------------------------
mkdir -p "$DS4_GGUF_DIR"

log "Resolving $QUANT files in $HF_MODEL ..."
files_json="$(curl -fsSL "$HF_ENDPOINT/api/models/$HF_MODEL" \
    || die "could not reach $HF_ENDPOINT — check network/proxy")"

mapfile -t SHARDS < <(printf '%s' "$files_json" | python3 -c '
import json, sys, re
quant = sys.argv[1]
d = json.load(sys.stdin)
names = [s["rfilename"] for s in d.get("siblings", [])]
# Unsloth lays quants out as "<QUANT>/<file>.gguf"; tolerate a flat layout too.
hits = [n for n in names
        if n.lower().endswith(".gguf")
        and quant.lower() in n.lower()
        and "mmproj" not in n.lower()]
if not hits:
    avail = sorted({n.split("/")[0] for n in names if n.lower().endswith(".gguf") and "/" in n})
    sys.stderr.write("no files matching %s. available: %s\n" % (quant, ", ".join(avail) or "(flat layout)"))
    sys.exit(3)
def key(n):
    m = re.search(r"-(\d{5})-of-(\d{5})\.gguf$", n)
    return (int(m.group(1)) if m else 0, n)
for n in sorted(hits, key=key):
    print(n)
' "$QUANT") || die "quant '$QUANT' not found in $HF_MODEL (see list above)"

[ "${#SHARDS[@]}" -gt 0 ] || die "no GGUF shards resolved for $QUANT"
ok "found ${#SHARDS[@]} shard(s) for $QUANT"

# ---------------------------------------------------------------------------
# 3. download
# ---------------------------------------------------------------------------
# Free-space guard. 3-bit sits well above the 2-bit recipe: UD-IQ3_XXS is
# ~104 GiB, UD-IQ3_S larger still. A split set also needs room for the merged
# copy, so we ask for 2x when there is more than one shard.
avail_gib="$(df -PBG "$DS4_GGUF_DIR" | awk 'NR==2 {gsub(/G/,"",$4); print $4}')"
log "Free space in $DS4_GGUF_DIR: ${avail_gib} GiB"
if [ "${#SHARDS[@]}" -gt 1 ]; then
    warn "split set: you need room for the shards AND the merged file."
    warn "delete the shards after the merge if space is tight."
fi

for f in "${SHARDS[@]}"; do
    dest="$DS4_GGUF_DIR/$(basename "$f")"
    if [ -s "$dest" ]; then
        ok "have $(basename "$f")"
        continue
    fi
    log "Downloading $(basename "$f") ..."
    curl -fL --progress-bar -C - \
        "$HF_ENDPOINT/$HF_MODEL/resolve/main/$f" -o "$dest.part" \
        || die "download failed for $f"
    mv "$dest.part" "$dest"
    ok "$(basename "$f")"
done

# ---------------------------------------------------------------------------
# 4. merge shards — ds4 loads ONE file
# ---------------------------------------------------------------------------
# ds4-server takes a single -m <path>; there is no split-GGUF reader in the
# engine (no *-of-* handling anywhere in ds4.c / ds4_server.c). Unsloth ships
# the big quants split, so a multi-shard set has to be merged first with
# llama.cpp's llama-gguf-split.
if [ "${#SHARDS[@]}" -eq 1 ]; then
    GGUF_FILE="$(basename "${SHARDS[0]}")"
else
    first="$DS4_GGUF_DIR/$(basename "${SHARDS[0]}")"
    merged="$DS4_GGUF_DIR/$(basename "${SHARDS[0]}" | sed -E 's/-[0-9]{5}-of-[0-9]{5}\.gguf$/.gguf/')"
    if [ -s "$merged" ]; then
        ok "merged file already present: $(basename "$merged")"
    else
        splitter="$(command -v llama-gguf-split || true)"
        [ -n "$splitter" ] || die "$(cat <<EOF
$QUANT is split into ${#SHARDS[@]} shards and ds4 cannot read split GGUFs.
Merge them with llama.cpp's llama-gguf-split, then re-run with SKIP_INSTALL=1:

  llama-gguf-split --merge \\
      $first \\
      $merged

(build it from ggml-org/llama.cpp, or pick a single-file quant instead —
 try QUANT=UD-IQ3_XXS.)
EOF
)"
        log "Merging ${#SHARDS[@]} shards with llama-gguf-split ..."
        "$splitter" --merge "$first" "$merged" || die "merge failed"
        ok "merged -> $(basename "$merged")"
    fi
    GGUF_FILE="$(basename "$merged")"
fi

BASE="$DS4_GGUF_DIR/$GGUF_FILE"
[ -s "$BASE" ] || die "base model missing after download/merge: $BASE"
log "Base model: $GGUF_FILE ($(du -h "$BASE" | cut -f1))"

# ---------------------------------------------------------------------------
# 5. serve
# ---------------------------------------------------------------------------
# ds4-serve honours DS4_GGUF_DIR / GGUF_FILE, so no patching is needed. Its
# MTP downgrade ladder keys on "*-0731*" in the filename; the Unsloth 0731
# names carry that, so the legacy MTP module is correctly never paired.
SERVE="$HOME/.local/bin/ds4-serve"
[ -x "$SERVE" ] || die "ds4-serve not found at $SERVE (re-run the installer)"

flags=()
[ "$NO_SPEC" = 1 ]   && flags+=(--no-spec)
[ "$NO_DSPARK" = 1 ] && flags+=(--no-dspark)

# The drafter costs memory the 3-bit base may not leave. At this size that is
# the usual reason a boot dies, so say it before it happens rather than after.
if [ "$NO_SPEC" != 1 ] && [ "$NO_DSPARK" != 1 ]; then
    warn "speculation is ON. A 3-bit base leaves much less headroom than 2-bit —"
    warn "if the server OOMs at boot, retry with NO_SPEC=1 (or a smaller CTX)."
fi

log "Starting ds4-server: quant=$QUANT ctx=$CTX port=$PORT ${flags[*]:-full-stack}"
DS4_SRC_DIR="$DS4_SRC_DIR" \
DS4_GGUF_DIR="$DS4_GGUF_DIR" \
GGUF_FILE="$GGUF_FILE" \
nohup "$SERVE" ${flags[@]+"${flags[@]}"} \
    --host "$HOST" --port "$PORT" -c "$CTX" \
    > "$HOME/ds4-server.log" 2>&1 < /dev/null & disown
pid=$!
log "ds4-server pid=$pid, log=$HOME/ds4-server.log"

# A 3-bit base is bigger than the 2-bit recipe the installer waits on, so give
# the load longer than the installer's 120 s before calling it dead.
log "Waiting for the server to come up (up to 300 s) ..."
for i in $(seq 1 300); do
    if curl -sf "http://$HOST:$PORT/v1/models" >/dev/null 2>&1; then
        echo
        ok "ds4-server is up on http://$HOST:$PORT"
        curl -s "http://$HOST:$PORT/v1/models" | python3 -m json.tool 2>/dev/null || true
        echo
        echo "Point a client at it:"
        echo "  --base-url http://$HOST:$PORT/v1 --model deepseek-v4-flash"
        exit 0
    fi
    kill -0 "$pid" 2>/dev/null || {
        echo >&2
        die "ds4-server exited during load. Last lines of $HOME/ds4-server.log:
$(tail -n 25 "$HOME/ds4-server.log" 2>/dev/null)"
    }
    printf '.'
    sleep 1
done

echo >&2
die "not reachable after 300 s — check $HOME/ds4-server.log"
