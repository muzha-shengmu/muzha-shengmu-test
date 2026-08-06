# Running DeepSeek-V4-Flash at 3-bit on a DGX Spark

Companion to [`MiaAI-Lab/DeepSeek-v4-Flash-One-DGX-Spark`](https://github.com/MiaAI-Lab/DeepSeek-v4-Flash-One-DGX-Spark).
Its `start.sh` always boots the 2-bit ship recipe; `start-3bit.sh` here boots a
3-bit one instead.

## Why the stock script can't do this

antirez's quantizer (`gguf-tools`) emits exactly five formats —
`q8_0`, `q8_K`, `q4_K`, `q2_K`, `iq2_xxs`. Nothing 3-bit. The installer
hardcodes the 2-bit ship recipe:

```bash
GGUF_FILE="${GGUF_FILE:-DeepSeek-V4-Flash-IQ2XXS-w2Q2K-AProjQ8-SExpQ8-OutQ8-chat-v2-imatrix-0731.gguf}"
```

But **what the quantizer writes and what the engine reads are different sets.**
The ds4 engine reads 3-bit fine:

- `ds4.c` `gguf_types[]` — `[11] q3_k`, `[18] iq3_xxs`, `[21] iq3_s`
- `cuda/mmq/ds4_mmq.cu` — MMQ kernels for `GGML_TYPE_Q3_K`,
  `GGML_TYPE_IQ3_XXS`, `GGML_TYPE_IQ3_S`
- `cuda/mmq/common.cuh` — matching `ggml_cuda_type_traits` for all three

So a third-party 3-bit GGUF (Unsloth's `UD-IQ3_*`) loads and serves. This
script pulls one and points the stock `ds4-serve` at it through the env vars
it already honours — no fork, no patch.

## Usage

```bash
./start-3bit.sh                     # UD-IQ3_S, ctx 16384, :8888
QUANT=UD-IQ3_XXS ./start-3bit.sh    # smaller 3-bit if IQ3_S won't fit
CTX=8192 NO_SPEC=1 ./start-3bit.sh  # tightest memory configuration
SKIP_INSTALL=1 ./start-3bit.sh      # engine already built, just serve
```

| Env | Default | Meaning |
|---|---|---|
| `QUANT` | `UD-IQ3_S` | Unsloth quant folder to pull |
| `CTX` | `16384` | context budget (KV ≈ 9.5 KiB/token) |
| `PORT` | `8888` | server port |
| `HOST` | `127.0.0.1` | bind address |
| `NO_SPEC` | `0` | `1` = plain decode, no speculation models loaded |
| `NO_DSPARK` | `0` | `1` = skip the DSpark drafter only |
| `HF_MODEL` | `unsloth/DeepSeek-V4-Flash-0731-GGUF` | source repo |
| `DS4_SRC_DIR` | `~/code/ds4` | where `ds4-server` is built |
| `DS4_GGUF_DIR` | `~/gguf` | weights directory |
| `SKIP_INSTALL` | `0` | `1` = skip the ds4-on-spark installer |

## The two things that will bite you

**1. Memory.** This is the whole difficulty. A 128 GB Spark has ~119 GiB
usable, and the 3-bit weights are far heavier than the 2-bit recipe:

| Quant | Size |
|---|---|
| UD-IQ2_M | ~90.9 GB |
| UD-Q2_K_XL | ~96.8 GB |
| UD-IQ3_XXS | ~104.2 GB |
| UD-IQ3_S | larger still |

That is why `CTX` defaults to `16384` here instead of the stock `1000000` —
at ~9.5 KiB/token the KV cache is what you trade away to fit the weights.
If the server OOMs at boot, in order: lower `CTX`, then `NO_SPEC=1` (the
DSpark drafter is ~7 GiB), then drop to `QUANT=UD-IQ3_XXS`.

**2. Split GGUFs.** `ds4-server` takes a single `-m <path>` and has no
split-GGUF reader — there is no `*-of-*` handling anywhere in `ds4.c` or
`ds4_server.c`. Unsloth ships the large quants split across shards, so they
must be merged first:

```bash
llama-gguf-split --merge \
    ~/gguf/DeepSeek-V4-Flash-0731-UD-IQ3_S-00001-of-00003.gguf \
    ~/gguf/DeepSeek-V4-Flash-0731-UD-IQ3_S.gguf
```

The script does this automatically when `llama-gguf-split` is on `PATH`, and
otherwise stops and prints the exact command. Note you need free disk for the
shards *and* the merged copy at the same time.

## What to expect

3-bit is slower to decode than 2-bit, not faster — you are trading tok/s and
context for weight precision. Reported figures on a single Spark:

| | UD-Q2_K_XL | UD-IQ3_S |
|---|---|---|
| Prefill | 398 tok/s | 408 tok/s |
| Decode | 20.7 tok/s | 18.6 tok/s |

Worth knowing before you spend the download: DeepSeek-V4-Flash is
quantization-aware trained with routed experts already stored in MXFP4
(~4.25 bits), and those experts are ~96% of the model. The headroom between
2-bit and 3-bit is smaller than it would be on a normally-trained model.

## Verify it's up

```bash
curl http://127.0.0.1:8888/v1/models
tail -f ~/ds4-server.log
```

Stop with `pkill -x ds4-server` (the repo's `stop.sh` also works).
