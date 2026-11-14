#!/usr/bin/env bash
# Deploys the reviewed Holdback settlement contracts to Ethereum Sepolia, one `forge create --broadcast` per contract
# (no `forge script`, no `cast send`), checks the deployment, and writes contracts/deployments/sepolia.json.
# With --check it deploys nothing: it re-derives the record from the chain and this checkout's build, read-only, and
# fails unless the result equals contracts/deployments/sepolia.json.
#
# Refuses any chain but Sepolia (11155111): no real money, and no mainnet at any point (hard rule; D4). The deployer
# is a throwaway key with no authority on chain (the contracts have no admin keys); it pays gas and nothing else.
#
# Usage: DEPLOY_CROSSCHECK_RPC=<second-rpc-url> contracts/script/deploy-sepolia.sh <rpc-url> <keystore-file> <password-file>
#        contracts/script/deploy-sepolia.sh --check <rpc-url>
#        contracts/script/deploy-sepolia.sh --verify <rpc-url>
#
# --verify runs --check first, then verifies the five contracts' source on Sourcify through its API v2
# (scripts/sourcify-verify.mjs, T-410): it compiles the five alone with the project's settings, checks each against its
# code on the chain, sends nothing unless all five are exact, then sends them one at a time and prints, per contract,
# whether Sourcify holds an exact match. No key and no account. Sending publishes the source, so it is part of the
# run's go-ahead. VERIFY_DRY_RUN=1 runs the check and sends nothing. forge's own `verify-contract` is not used: forge
# 1.0.0 calls Sourcify's API v1, which Sourcify removed.
#
# The deploy (T-410) sends each creation at an explicit nonce: it waits until the deployer's mined and pending nonces
# agree, sends with `--nonce`, and the contract's address follows from the deployer and that nonce. When a send fails
# ("replacement transaction underpriced" on 2026-11-13), it reads the chain before anything else: a transaction mined
# at that nonce is the creation when it created the expected address; a pending one is waited for; only a nonce still
# unused is sent again, at the same nonce. One nonce can be mined once, so a retry never creates a second copy of a
# contract, and a creation is taken only when its input is this build's code and arguments. Each is signed for the
# checked chain (`--chain`). Another transaction from the deployer during the run stops it. The record is written only
# once the last creation's block is finalized (about 13 minutes on Sepolia) on the deploy RPC and on a second RPC
# (DEPLOY_CROSSCHECK_RPC, required on Sepolia), which must hold every creation in the same block; then to a temporary
# file moved into place. Neither RPC URL is printed. A run that stops
# before that writes no record and prints the contracts it created, as orphans; a rerun deploys all five anew.
#
# A rehearsal (T-383): the same routine on a local anvil (chain 31337, an RPC on 127.0.0.1 or localhost only), with
# DEPLOY_RECORD naming the record to write or check, so a rehearsal never writes over contracts/deployments/sepolia.json.
# It deploys Sepolia's values, the beacon margin included, and Multicall3's canonical code must be at its address. A
# development node (anvil, Hardhat, Ganache) forking Sepolia answers chain 11155111 but is a rehearsal too (T-410):
# it follows the local chain's record rules. A rehearsal alone may name DEPLOY_FINALITY (finalized, safe or latest; a
# local node mines no block between transactions), DEPLOY_POLL_SEC, and a stand-in for forge in DEPLOY_FORGE (a test's).
# scripts/deploy-rehearsal.mjs runs the whole redeploy this way and prints each step's Sepolia command.
#
# Every check fails closed. Bash ignores a failure inside `$(...)` used as an argument or inside `[ ]`, and inside a
# function running in `$(...)` (bash 3.2 has no inherit_errexit), so each substitution is a plain assignment or ends
# in `|| fail`.
set -euo pipefail

SEPOLIA=11155111
LOCAL=31337

# Phase one funds by ERC-3009 only (ADR-0031 §3): no Permit2 and no Permit2 collector. Multicall3 stays: the ERC-3009
# collector is built with it, for its ERC-6492 path.
MULTICALL3=0xcA11bde05977b3631167028862bE2a173976CA11
MULTICALL3_CODEHASH=0xd5c15df687b16f2ff992fc8d767b4216323184a2bbc6ee2f9c398c318e770891
EXPIRY_MARGIN=86400 # T-206 review §7: one day, the value the local EVM world and the tests use
# ADR-0032: the fallback's and the escalation's panel rounds are taken this many seconds after the last moment a
# choice can still be made, two block slots on Sepolia. The constructor refuses 0 on any chain but the local one. This
# is the one place the script names it: the create line, the creation-code check, the wiring check and the record.
BEACON_MARGIN=29

# drand quicknet round 1000, and the same signature plus an order-3 curve point outside G1 (T-206 audit cross-check).
SIG_1000=0xb44679b9a59af2ec876b1a6b1ad52ea9b1615fc3982b19576350f93447cb1125e342b73a8dd2bacbe47e4b6b63ed5e39
SIG_1000_PLUS_TORSION=0xabbaa2cd356c8b543308abe2c07d92facb092294f841b0c295786b635167aba148d4e2e86fedf3cf2c04c43b68a5aaee
INVALID_SIGNATURE=0x8baa579f # DrandQuicknetBeacon's InvalidSignature()

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SEPOLIA_RECORD="$ROOT/deployments/sepolia.json"
OUT="${DEPLOY_RECORD:-$SEPOLIA_RECORD}"
# The one token Crow's operators accept on each chain (T-383). A rehearsal may name another table; Sepolia may not.
REPO_TABLE="$ROOT/../packages/settlement/evm/accepted-tokens.json"
TABLE="${ACCEPTED_TOKENS:-$REPO_TABLE}"
BUILD_INPUTS=(src lib foundry.toml remappings.txt script/TestUSDC.sol)

fail() {
  echo "deploy-sepolia: $1" >&2
  exit 1
}

VERIFY=no
if [ "${1:-}" = --check ] || [ "${1:-}" = --verify ]; then
  [ "$#" -eq 2 ] || fail "usage: deploy-sepolia.sh $1 <rpc-url>"
  MODE=check
  [ "$1" = --check ] || VERIFY=yes
  RPC="$2"
else
  [ "$#" -eq 3 ] || fail "usage: deploy-sepolia.sh <rpc-url> <keystore-file> <password-file>"
  MODE=deploy
  RPC="$1"
  KEYSTORE="$2"
  PASSWORD_FILE="$3"
fi
CROSSCHECK="${DEPLOY_CROSSCHECK_RPC:-}"

# The RPC URLs stay out of everything this script prints (red team of T-410, L1): a hosted URL can carry its key, and
# cast and forge name the URL a failed request went to. Both streams pass through a filter that replaces them.
redact() {
  awk -v a="$RPC" -v b="$CROSSCHECK" '{
    if (length(a) > 0) while ((i = index($0, a)) > 0) $0 = substr($0, 1, i - 1) "<rpc-url>" substr($0, i + length(a));
    if (length(b) > 0) while ((i = index($0, b)) > 0) $0 = substr($0, 1, i - 1) "<crosscheck-rpc-url>" substr($0, i + length(b));
    print; fflush()
  }'
}
exec > >(redact) 2> >(redact >&2)

# Sending publishes the source, so only an exact 1 holds it back, and any other value is refused (red team, L3).
case "${VERIFY_DRY_RUN:-}" in "" | 1) ;; *) fail "VERIFY_DRY_RUN is 1 or unset, not ${VERIFY_DRY_RUN}" ;; esac

# read_retry <command...>: a read that may fail once on a lagging or dropped connection, tried five times, 2 s apart.
read_retry() {
  local i out
  for i in 1 2 3 4; do
    if out="$("$@" 2>/dev/null)"; then
      printf '%s\n' "$out"
      return 0
    fi
    sleep 2
  done
  "$@"
}

# call <address> <signature(returns)> [args...]: the first return value, decoded, without annotations or quotes.
call() {
  local out
  out="$(cast call "$@" --rpc-url "$RPC" --json)" || fail "call $2 on $1 failed"
  out="$(jq -er '.[0]' <<<"$out")" || fail "call $2 on $1 returned nothing"
  printf '%s\n' "$out"
}

# expect <what> <want> <command...>: the command succeeds and prints exactly <want>.
expect() {
  local what="$1" want="$2" got
  shift 2
  got="$("$@")" || fail "$what: the check could not run"
  [ "$got" = "$want" ] || fail "$what is $got, expected $want"
}

# codehash <address>: keccak256 of eth_getCode, the same value as EXTCODEHASH (`cast codehash` needs eth_getProof,
# which not every RPC serves).
codehash() {
  local code
  code="$(cast code "$1" --rpc-url "$RPC")" || fail "reading the code at $1 failed"
  cast keccak "$code" || fail "hashing the code at $1 failed"
}

# refuses <what> <address> <signature> [args...]: the call reverts with InvalidSignature(), not with anything else.
refuses() {
  local what="$1" out
  shift
  if out="$(cast call "$@" --rpc-url "$RPC" 2>&1)"; then fail "the beacon accepted $what"; fi
  case "$out" in
  *"$INVALID_SIGNATURE"*) ;;
  *) fail "the beacon call with $what failed without InvalidSignature: $out" ;;
  esac
}

# mined <tx> <address>: the transaction succeeded, the deployer sent it, and it created <address>; prints its block.
mined() {
  local receipt status from created want block
  receipt="$(cast receipt "$1" --async --json --rpc-url "$RPC")" || fail "no receipt for $1"
  status="$(jq -er .status <<<"$receipt")" || fail "no status for $1"
  [ "$status" = 0x1 ] || fail "transaction $1 failed"
  from="$(jq -er .from <<<"$receipt" | tr '[:upper:]' '[:lower:]')" || fail "no sender for $1"
  [ "$from" = "$DEPLOYER_LOWER" ] || fail "transaction $1 was sent by $from, not the deployer"
  created="$(jq -er .contractAddress <<<"$receipt" | tr '[:upper:]' '[:lower:]')" || fail "transaction $1 created no contract"
  want="$(tr '[:upper:]' '[:lower:]' <<<"$2")" || fail "bad address $2"
  [ "$created" = "$want" ] || fail "transaction $1 created $created, not $2"
  block="$(jq -er .blockNumber <<<"$receipt")" || fail "no block for $1"
  cast to-dec "$block" || fail "bad block number for $1"
}

# creation_matches <path:Contract> <tx> [constructor-signature args...]: the transaction's input is this checkout's
# compiled creation code followed by the ABI-encoded constructor arguments, so the deployed code is this commit's build.
creation_matches() {
  local id="$1" tx="$2" input code args=""
  shift 2
  input="$(cast tx "$tx" input --rpc-url "$RPC")" || fail "transaction $tx not found"
  code="$(forge inspect --root "$ROOT" "$id" bytecode)" || fail "forge inspect $id failed"
  if [ "$#" -gt 0 ]; then
    args="$(cast abi-encode "$@")" || fail "encoding the constructor arguments of $id failed"
    args="${args#0x}"
  fi
  [ "$input" = "$code$args" ] || fail "$id: the creation input differs from this build"
}

# field <jq path>: a value from the recorded deployment; missing or null fails.
field() {
  jq -er "$1" "$OUT" || fail "the record $OUT has no $1"
}

# rehearsal_record: a rehearsal names its record in DEPLOY_RECORD, anywhere but contracts/deployments/.
rehearsal_record() {
  local out_dir deployments_dir
  [ -n "${DEPLOY_RECORD:-}" ] || fail "a rehearsal on $1 needs DEPLOY_RECORD, the record to write or check"
  # Compared as folders, resolved, not as strings: a relative or dotted spelling of sepolia.json names the same file.
  # A rehearsal's record lives anywhere but contracts/deployments/, so it can never write over a kept record.
  out_dir="$(cd "$(dirname "$OUT")" 2>/dev/null && pwd -P)" || fail "the folder of DEPLOY_RECORD ($OUT) does not exist"
  deployments_dir="$(cd "$ROOT/deployments" && pwd -P)" || fail "contracts/deployments is missing"
  [ "$out_dir" != "$deployments_dir" ] || fail "a rehearsal must not write or check a record in $deployments_dir; name a scratch file in DEPLOY_RECORD"
  [ ! "$OUT" -ef "$SEPOLIA_RECORD" ] || fail "a rehearsal must not write or check $SEPOLIA_RECORD"
}

CHAIN="$(cast chain-id --rpc-url "$RPC")" || fail "reading the chain id failed"
# The node's own name: on chain 11155111 a development node is a fork of Sepolia, not Sepolia.
CLIENT="$(cast client --rpc-url "$RPC" 2>/dev/null)" || CLIENT=""
REHEARSAL=no
case "$CHAIN" in
"$SEPOLIA")
  if [[ "$CLIENT" =~ ^([Aa]nvil|[Hh]ardhat|[Gg]anache) ]]; then
    REHEARSAL=yes
    rehearsal_record "a fork of Sepolia ($CLIENT)"
  else
    # A Sepolia run writes and checks the one Sepolia record.
    [ "$OUT" = "$SEPOLIA_RECORD" ] || fail "on Sepolia the record is $SEPOLIA_RECORD; unset DEPLOY_RECORD"
    [ "$TABLE" = "$REPO_TABLE" ] || fail "on Sepolia the accepted-token table is $REPO_TABLE; unset ACCEPTED_TOKENS"
  fi
  ;;
"$LOCAL")
  LOCAL_RPC='^http://(127\.0\.0\.1|localhost)(:[0-9]+)?/?$'
  # The URL stays out of the message: a hosted RPC's URL may carry its key.
  [[ "$RPC" =~ $LOCAL_RPC ]] || fail "chain id $LOCAL is a rehearsal on this machine only; the RPC URL is not a local RPC (http://127.0.0.1 or http://localhost)"
  REHEARSAL=yes
  rehearsal_record "the local chain"
  ;;
*) fail "chain id $CHAIN is not Sepolia ($SEPOLIA), nor the local chain ($LOCAL) for a rehearsal" ;;
esac
# The stand-ins and the knobs a rehearsal may set; Sepolia takes none of them.
if [ "$REHEARSAL" = no ]; then
  for knob in DEPLOY_FORGE DEPLOY_FINALITY DEPLOY_POLL_SEC DEPLOY_FINALITY_WAIT_SEC SOURCIFY_URL; do
    [ -z "${!knob:-}" ] || fail "on Sepolia $knob is not taken; unset it"
  done
fi
FORGE="${DEPLOY_FORGE:-forge}"
FINALITY="${DEPLOY_FINALITY:-finalized}"
case "$FINALITY" in finalized | safe | latest) ;; *) fail "DEPLOY_FINALITY is finalized, safe or latest, not $FINALITY" ;; esac
POLL_SEC="${DEPLOY_POLL_SEC:-3}"
[[ "$POLL_SEC" =~ ^[0-9]+$ ]] || fail "DEPLOY_POLL_SEC is a whole number of seconds"
FINALITY_WAIT_SEC="${DEPLOY_FINALITY_WAIT_SEC:-3600}"
[[ "$FINALITY_WAIT_SEC" =~ ^[0-9]+$ ]] || fail "DEPLOY_FINALITY_WAIT_SEC is a whole number of seconds"
# A second, independent RPC on Sepolia (red team of T-410, M2 and M3): one node's chain id, client name and finalized
# block are its own word. Before the record is written, the second node must hold every creation in the same block and
# call it finalized too. A deploy on Sepolia needs it; a rehearsal may name one.
if [ -n "$CROSSCHECK" ]; then
  [ "$CROSSCHECK" != "$RPC" ] || fail "DEPLOY_CROSSCHECK_RPC must be another RPC than the one the deploy goes through"
  CROSS_CHAIN="$(cast chain-id --rpc-url "$CROSSCHECK")" || fail "reading the chain id on DEPLOY_CROSSCHECK_RPC failed"
  [ "$CROSS_CHAIN" = "$CHAIN" ] || fail "DEPLOY_CROSSCHECK_RPC answers chain $CROSS_CHAIN, not $CHAIN"
  CROSS_CLIENT="$(cast client --rpc-url "$CROSSCHECK" 2>/dev/null)" || CROSS_CLIENT=""
  if [ "$REHEARSAL" = no ] && [[ "$CROSS_CLIENT" =~ ^([Aa]nvil|[Hh]ardhat|[Gg]anache) ]]; then
    fail "DEPLOY_CROSSCHECK_RPC is a development node ($CROSS_CLIENT), not Sepolia"
  fi
elif [ "$REHEARSAL" = no ] && [ "$MODE" = deploy ]; then
  fail "a deploy on Sepolia needs DEPLOY_CROSSCHECK_RPC, a second RPC from another provider, to confirm each creation is final before the record is written"
fi
# forge and cast read FOUNDRY_* and DAPP_* settings from the environment, which would build another bytecode than the
# checkout's foundry.toml gives (red team of T-410, L5); on Sepolia none may be set but the chain id the script sets.
if [ "$REHEARSAL" = no ]; then
  for v in $(compgen -e); do
    case "$v" in FOUNDRY_CHAIN_ID) ;; FOUNDRY_* | DAPP_*) fail "on Sepolia $v is not taken: the build follows contracts/foundry.toml; unset it" ;; esac
  done
fi
# On Sepolia the checkout holds every submodule, recursively: forge's remappings come from the folders under lib, and
# a checkout of fewer gives another metadata hash, so Sourcify could give only a partial match (T-383, measured).
if [ "$REHEARSAL" = no ]; then
  SUBMODULES="$(git -C "$ROOT" submodule status --recursive 2>/dev/null)" ||
    fail "not every submodule is checked out, recursively (git submodule status --recursive failed); run git submodule update --init --recursive"
  if grep -qE '^[-+U]' <<<"$SUBMODULES"; then
    fail "not every submodule is checked out at its commit, recursively; run git submodule update --init --recursive"
  fi
fi
# foundry.toml pins chain_id 31337 for the local chain. forge 1.0.0 signs a creation for the chain id the RPC answers,
# whatever FOUNDRY_CHAIN_ID says (red team of T-410, H1, measured), so `forge create` also gets `--chain`, which pins it.
export FOUNDRY_CHAIN_ID=$CHAIN

# The build must be the recorded commit's: HEAD for a deployment, the record's commit for a check.
if [ "$MODE" = deploy ]; then
  COMMIT="$(git -C "$ROOT" rev-parse HEAD)"
  DEPLOYER="$(cast wallet address --keystore "$KEYSTORE" --password-file "$PASSWORD_FILE")"
else
  COMMIT="$(field .commit)"
  DEPLOYER="$(field .deployer)"
fi
DEPLOYER_LOWER="$(tr '[:upper:]' '[:lower:]' <<<"$DEPLOYER")"
git -C "$ROOT" diff --quiet "$COMMIT" -- "${BUILD_INPUTS[@]}" || fail "contracts/src, lib, the build config or TestUSDC differ from $COMMIT"
DIRTY="$(git -C "$ROOT" status --porcelain --untracked-files=all -- "${BUILD_INPUTS[@]}")"
[ -z "$DIRTY" ] || fail "contracts/src, lib, the build config or TestUSDC have uncommitted changes"

MULTICALL3_GOT="$(codehash "$MULTICALL3")"
[ "$MULTICALL3_GOT" = "$MULTICALL3_CODEHASH" ] || fail "unexpected code at Multicall3"

# nonce_at <latest|pending>: the deployer's nonce at that block tag, in decimal.
nonce_at() {
  local n
  n="$(cast nonce "$DEPLOYER" --block "$1" --rpc-url "$RPC")" || fail "reading the deployer's $1 nonce failed"
  [[ "$n" =~ ^[0-9]+$ ]] || fail "the deployer's $1 nonce reads $n"
  printf '%s\n' "$n"
}

# settle_nonce <want>: waits until the deployer's mined and pending nonces both equal <want>: the run's earlier
# creations are mined on this RPC, and nothing else from the deployer is in flight. A lagging backend reads lower and
# is waited out; a higher nonce is another transaction from the deployer, which stops the run.
settle_nonce() {
  local want="$1" latest pending chain i
  for ((i = 0; i < 100; i++)); do
    chain="$(cast chain-id --rpc-url "$RPC")" || fail "reading the chain id failed"
    [ "$chain" = "$CHAIN" ] || fail "the RPC now answers chain $chain, not $CHAIN"
    latest="$(nonce_at latest)" || fail "reading the deployer's mined nonce failed"
    pending="$(nonce_at pending)" || fail "reading the deployer's pending nonce failed"
    if [ "$latest" -gt "$want" ] || [ "$pending" -gt "$want" ]; then
      fail "the deployer's nonce is $latest mined and $pending pending, past the $want this run expects: another transaction from the deployer is in flight; a deployer key serves one run at a time"
    fi
    if [ "$latest" = "$want" ] && [ "$pending" = "$want" ]; then return 0; fi
    sleep "$POLL_SEC"
  done
  fail "the deployer's nonce did not settle at $want (it reads $latest mined, $pending pending)"
}

# settle_send <name> <nonce> <from-block> <address>: after a failed send, what the chain says about <nonce>. Sets
# SETTLED=mined and CREATED_TX when a transaction at that nonce is mined and created <address>; SETTLED=unused when the
# nonce is still unused and nothing is pending, so the same creation may go again at the same nonce; fails on anything
# else. It always returns 0 and is called as a plain command: called as an `if` condition, bash would switch `set -e`
# off inside it (review of T-410), so each substitution also ends in `|| fail`.
settle_send() {
  local name="$1" nonce="$2" from="$3" want="$4" latest pending head b tx receipt i status_hex created nonce_hex
  SETTLED=""
  nonce_hex="$(printf '0x%x' "$nonce")" || fail "bad nonce $nonce"
  for ((i = 0; i < 100; i++)); do
    latest="$(nonce_at latest)" || fail "reading the deployer's mined nonce failed"
    if [ "$latest" -gt "$nonce" ]; then
      # The nonce is used: find its transaction in the blocks since the first send of this creation.
      head="$(cast block-number --rpc-url "$RPC")" || fail "reading the block number failed"
      tx=""
      for ((b = from; b <= head; b++)); do
        tx="$(cast block "$b" --full --json --rpc-url "$RPC" | jq -r --arg from "$DEPLOYER_LOWER" --arg n "$nonce_hex" \
          '[.transactions[] | select((.from | ascii_downcase) == $from and .nonce == $n) | .hash] | first // ""')" || fail "reading block $b failed"
        [ -z "$tx" ] || break
      done
      [ -n "$tx" ] || fail "the deployer's nonce $nonce is used, but no transaction from the deployer at that nonce is in blocks $from to $head"
      receipt="$(cast receipt "$tx" --async --json --rpc-url "$RPC")" || fail "no receipt for $tx"
      status_hex="$(jq -r .status <<<"$receipt")" || fail "no status for $tx"
      [ "$status_hex" = 0x1 ] || fail "the creation of $name at nonce $nonce, transaction $tx, failed on chain"
      created="$(jq -r '.contractAddress // "" | ascii_downcase' <<<"$receipt")" || fail "no created address for $tx"
      [ "$created" = "$(tr '[:upper:]' '[:lower:]' <<<"$want")" ] ||
        fail "the deployer's transaction at nonce $nonce, $tx, did not create $want: it is not this run's creation of $name"
      CREATED_TX="$tx"
      SETTLED=mined
      return 0
    fi
    pending="$(nonce_at pending)" || fail "reading the deployer's pending nonce failed"
    # Unused and nothing pending, from the third read on: the send did not reach the chain.
    if [ "$pending" -le "$nonce" ] && [ "$i" -ge 2 ]; then
      SETTLED=unused
      return 0
    fi
    if [ "$pending" -gt "$nonce" ] && [ "$i" = 0 ]; then echo "deploy-sepolia: a transaction at nonce $nonce is pending; waiting until it is mined" >&2; fi
    sleep "$POLL_SEC"
  done
  fail "the deployer's transaction at nonce $nonce is still pending; nothing was sent again. Wait until it is mined, then rerun"
}

# create <name> <path:Contract> [constructor-signature args...]: creates one contract at the deployer's next nonce and
# sets CREATED_ADDRESS, CREATED_TX and CREATED_BLOCK. Before it takes a creation, the transaction's input must be this
# build's creation code and these arguments: an address follows from the deployer and the nonce alone, so the address
# says nothing about which contract it holds (red team of T-410, M1). It runs in this shell, not in `$(...)`, so
# `set -e` holds in it.
CREATED_LIST=""
IN_FLIGHT=""
ERRFILE=""
create() {
  local name="$1" id="$2" nonce want from attempt json status receipt adopted=no
  shift 2
  local ctor=("$@")
  local args=(--root "$ROOT" --rpc-url "$RPC" --chain "$CHAIN" --keystore "$KEYSTORE" --password-file "$PASSWORD_FILE" --broadcast --json)
  if [ "$#" -gt 1 ]; then
    shift
    args+=(--constructor-args "$@")
  fi
  nonce="$NEXT_NONCE"
  want="$(cast compute-address "$DEPLOYER" --nonce "$nonce")" || fail "computing the address at nonce $nonce failed"
  want="$(grep -oE '0x[0-9a-fA-F]{40}' <<<"$want")" || fail "cast compute-address printed no address"
  settle_nonce "$nonce"
  from="$(cast block-number --rpc-url "$RPC")" || fail "reading the block number failed"
  ERRFILE="$(mktemp)" || fail "making a temporary file failed"
  CREATED_TX=""
  # Until the send settles, a stopped run names this creation as possibly on chain.
  IN_FLIGHT="$name $want (nonce $nonce)"
  for attempt in 1 2 3; do
    status=0
    json="$("$FORGE" create "$id" --nonce "$nonce" "${args[@]}" 2>"$ERRFILE")" || status=$?
    if [ "$status" -eq 0 ]; then
      CREATED_ADDRESS="$(jq -er '.deployedTo' <<<"$json")" || fail "forge create $name reported no address"
      CREATED_TX="$(jq -er '.transactionHash' <<<"$json")" || fail "forge create $name reported no transaction"
      [ "$(tr '[:upper:]' '[:lower:]' <<<"$CREATED_ADDRESS")" = "$(tr '[:upper:]' '[:lower:]' <<<"$want")" ] ||
        fail "forge create $name deployed to $CREATED_ADDRESS, not $want, the address of nonce $nonce"
      break
    fi
    echo "deploy-sepolia: forge create $name at nonce $nonce failed (exit $status): $(tail -n 3 "$ERRFILE" | tr '\n' ' ')" >&2
    settle_send "$name" "$nonce" "$from" "$want"
    if [ "$SETTLED" = mined ]; then
      CREATED_ADDRESS="$want"
      adopted=yes
      break
    fi
    [ "$SETTLED" = unused ] || fail "settling the send of $name at nonce $nonce gave no answer"
    [ "$attempt" -lt 3 ] || fail "forge create $name failed 3 times, and nonce $nonce reads unused on this RPC; a send may still be mined: look at $want before a rerun"
    echo "deploy-sepolia: nonce $nonce is unused and nothing is pending; sending $name again at the same nonce (attempt $((attempt + 1)) of 3)" >&2
  done
  rm -f "$ERRFILE"
  ERRFILE=""
  if [ "${#ctor[@]}" -gt 0 ]; then creation_matches "$id" "$CREATED_TX" "${ctor[@]}"; else creation_matches "$id" "$CREATED_TX"; fi
  if [ "$adopted" = yes ]; then echo "deploy-sepolia: the chain holds $name at $want from nonce $nonce ($CREATED_TX), this build's code; nothing is sent again" >&2; fi
  receipt="$(cast receipt "$CREATED_TX" --async --json --rpc-url "$RPC")" || fail "no receipt for $CREATED_TX"
  CREATED_BLOCK="$(jq -er .blockNumber <<<"$receipt")" || fail "no block for $CREATED_TX"
  CREATED_BLOCK="$(cast to-dec "$CREATED_BLOCK")" || fail "bad block number for $CREATED_TX"
  CREATED_LIST="$CREATED_LIST $name=$CREATED_ADDRESS@$CREATED_TX"
  IN_FLIGHT=""
  echo "deploy-sepolia: created $name at $CREATED_ADDRESS (nonce $nonce, transaction $CREATED_TX, block $CREATED_BLOCK)"
  NEXT_NONCE=$((nonce + 1))
  if [ "$CREATED_BLOCK" -gt "$LAST_BLOCK" ]; then LAST_BLOCK="$CREATED_BLOCK"; fi
}

# A run that stops after a creation and before the record names what it left on chain.
RECORD_WRITTEN=no
orphans() {
  local status=$? item
  # forge's error text can name the RPC URL, so its file does not stay behind.
  if [ -n "$ERRFILE" ]; then rm -f "$ERRFILE"; fi
  if [ -n "${TMP_RECORD:-}" ] && [ "$RECORD_WRITTEN" = no ]; then rm -f "$TMP_RECORD"; fi
  if [ "$MODE" = deploy ] && [ "$RECORD_WRITTEN" = no ] && { [ -n "$CREATED_LIST" ] || [ -n "$IN_FLIGHT" ]; }; then
    echo "deploy-sepolia: the run stopped before the record was written; nothing was written to $OUT. These contracts are on chain $CHAIN and unused (orphans); a rerun deploys all five anew:" >&2
    for item in $CREATED_LIST; do echo "deploy-sepolia:   ${item%%=*} ${item#*=}" | sed 's/@/ in /' >&2; done
    # A send that had not settled may still be mined: its address follows from the deployer and the nonce.
    if [ -n "$IN_FLIGHT" ]; then echo "deploy-sepolia:   possibly, once mined: $IN_FLIGHT; its send had not settled" >&2; fi
  fi
  exit "$status"
}

ESCROW_ID=lib/commerce-payments/src/AuthCaptureEscrow.sol:AuthCaptureEscrow
C3009_ID=lib/commerce-payments/src/collectors/ERC3009PaymentCollector.sol:ERC3009PaymentCollector
BEACON_ID=src/DrandQuicknetBeacon.sol:DrandQuicknetBeacon
RULES_ID=src/HoldbackRules.sol:HoldbackRules
TOKEN_ID=script/TestUSDC.sol:TestUSDC

if [ "$MODE" = deploy ]; then
  # The script's own TestUSDC goes first in the checks; it must be there before anything is sent.
  [ -f "$ROOT/script/TestUSDC.sol" ] || fail "script/TestUSDC.sol is missing: the rules contract needs its token at deploy"
  trap orphans EXIT
  # The run's first nonce: the deployer's, once its mined and pending nonces agree.
  START_NONCE="$(nonce_at latest)"
  settle_nonce "$START_NONCE"
  NEXT_NONCE="$START_NONCE"
  LAST_BLOCK=0
  create AuthCaptureEscrow "$ESCROW_ID"
  ESCROW="$CREATED_ADDRESS" ESCROW_TX="$CREATED_TX"
  create ERC3009PaymentCollector "$C3009_ID" 'constructor(address,address)' "$ESCROW" "$MULTICALL3"
  C3009="$CREATED_ADDRESS" C3009_TX="$CREATED_TX"
  create DrandQuicknetBeacon "$BEACON_ID"
  BEACON="$CREATED_ADDRESS" BEACON_TX="$CREATED_TX"
  # The demo's open-mint test token. A deployment serves one token, fixed in the rules contract's constructor
  # (ADR-0031 §2, SC-1), so the token comes first.
  create TestUSDC "$TOKEN_ID"
  TOKEN="$CREATED_ADDRESS" TOKEN_TX="$CREATED_TX"
  create HoldbackRules "$RULES_ID" 'constructor(address,address,uint64,address,address,uint64)' "$ESCROW" "$C3009" "$EXPIRY_MARGIN" "$BEACON" "$TOKEN" "$BEACON_MARGIN"
  RULES="$CREATED_ADDRESS" RULES_TX="$CREATED_TX"
  # The record pins these five, so it waits until the chain cannot drop them: the last creation's block finalized.
  echo "deploy-sepolia: waiting until block $LAST_BLOCK is $FINALITY before the checks and the record (about 13 minutes on Sepolia)"
  WAIT_UNTIL=$((SECONDS + FINALITY_WAIT_SEC))
  NEXT_NOTE=$((SECONDS + 60))
  while :; do
    FINAL_BLOCK="$(read_retry cast block "$FINALITY" --field number --rpc-url "$RPC")" || fail "reading the $FINALITY block failed"
    FINAL_BLOCK="$(cast to-dec "$FINAL_BLOCK")" || fail "bad $FINALITY block number"
    CROSS_FINAL="$FINAL_BLOCK"
    if [ -n "$CROSSCHECK" ]; then
      CROSS_FINAL="$(read_retry cast block "$FINALITY" --field number --rpc-url "$CROSSCHECK")" || fail "reading the $FINALITY block on DEPLOY_CROSSCHECK_RPC failed"
      CROSS_FINAL="$(cast to-dec "$CROSS_FINAL")" || fail "bad $FINALITY block number on DEPLOY_CROSSCHECK_RPC"
    fi
    if [ "$FINAL_BLOCK" -ge "$LAST_BLOCK" ] && [ "$CROSS_FINAL" -ge "$LAST_BLOCK" ]; then break; fi
    [ "$SECONDS" -lt "$WAIT_UNTIL" ] || fail "block $LAST_BLOCK is not $FINALITY after $FINALITY_WAIT_SEC s (the $FINALITY block is $FINAL_BLOCK, and $CROSS_FINAL on the second RPC)"
    if [ "$SECONDS" -ge "$NEXT_NOTE" ]; then
      echo "deploy-sepolia: the $FINALITY block is $FINAL_BLOCK ($CROSS_FINAL on the second RPC); waiting for $LAST_BLOCK"
      NEXT_NOTE=$((SECONDS + 60))
    fi
    sleep "$POLL_SEC"
  done
  # The lower of the two is what both call final; the checks below hold each creation at or below it.
  if [ "$CROSS_FINAL" -lt "$FINAL_BLOCK" ]; then FINAL_BLOCK="$CROSS_FINAL"; fi
  # Each creation, read on both nodes after the wait: the same transaction, mined in the same block, creating the
  # same address. A node posing as Sepolia, or one whose finalized block lies, has no second node to agree with it.
  for item in $CREATED_LIST; do
    c_name="${item%%=*}" c_rest="${item#*=}"
    c_address="${c_rest%@*}" c_tx="${c_rest#*@}"
    p_receipt="$(read_retry cast receipt "$c_tx" --async --json --rpc-url "$RPC")" || fail "no receipt for $c_name's $c_tx after the wait"
    p_hash="$(jq -er .blockHash <<<"$p_receipt")" || fail "no block hash for $c_tx"
    if [ -n "$CROSSCHECK" ]; then
      x_receipt="$(read_retry cast receipt "$c_tx" --async --json --rpc-url "$CROSSCHECK")" ||
        fail "the second RPC has no receipt for $c_name's creation $c_tx: the deploy RPC's chain is not the one the second RPC serves; nothing was written"
      x_hash="$(jq -er .blockHash <<<"$x_receipt")" || fail "no block hash for $c_tx on the second RPC"
      x_status="$(jq -er .status <<<"$x_receipt")" || fail "no status for $c_tx on the second RPC"
      x_created="$(jq -r '.contractAddress // "" | ascii_downcase' <<<"$x_receipt")" || fail "no created address for $c_tx on the second RPC"
      [ "$x_hash" = "$p_hash" ] || fail "$c_name's creation $c_tx is in block $p_hash on the deploy RPC but $x_hash on the second RPC; nothing was written"
      [ "$x_status" = 0x1 ] && [ "$x_created" = "$(tr '[:upper:]' '[:lower:]' <<<"$c_address")" ] ||
        fail "the second RPC does not show $c_tx creating $c_address; nothing was written"
    fi
  done
  if [ -n "$CROSSCHECK" ]; then echo "deploy-sepolia: the second RPC holds all five creations in the same blocks, at or below its $FINALITY block"; fi
else
  ESCROW="$(field .contracts.AuthCaptureEscrow.address)"
  ESCROW_TX="$(field .contracts.AuthCaptureEscrow.tx)"
  C3009="$(field .contracts.ERC3009PaymentCollector.address)"
  C3009_TX="$(field .contracts.ERC3009PaymentCollector.tx)"
  BEACON="$(field .contracts.DrandQuicknetBeacon.address)"
  BEACON_TX="$(field .contracts.DrandQuicknetBeacon.tx)"
  RULES="$(field .contracts.HoldbackRules.address)"
  RULES_TX="$(field .contracts.HoldbackRules.tx)"
  TOKEN="$(field .token.address)"
  TOKEN_TX="$(field .token.tx)"
  RECORDED_MARGIN="$(field .beaconMarginSec)"
  [ "$RECORDED_MARGIN" = "$BEACON_MARGIN" ] || fail "the record's beaconMarginSec is $RECORDED_MARGIN; this script deploys $BEACON_MARGIN (ADR-0032)"
fi

# Each transaction succeeded, came from the deployer, and carried this build's creation code and arguments.
ESCROW_BLOCK="$(mined "$ESCROW_TX" "$ESCROW")"
C3009_BLOCK="$(mined "$C3009_TX" "$C3009")"
BEACON_BLOCK="$(mined "$BEACON_TX" "$BEACON")"
RULES_BLOCK="$(mined "$RULES_TX" "$RULES")"
if [ "$MODE" = deploy ]; then
  # Read again after the wait: each creation sits at or below the finalized block, where the record will pin it.
  for b in "$ESCROW_BLOCK" "$C3009_BLOCK" "$BEACON_BLOCK" "$RULES_BLOCK"; do
    [ "$b" -le "$FINAL_BLOCK" ] || fail "a creation now sits in block $b, past the $FINALITY block $FINAL_BLOCK: the chain moved under the run; nothing was written"
  done
fi
creation_matches "$ESCROW_ID" "$ESCROW_TX"
creation_matches "$C3009_ID" "$C3009_TX" 'constructor(address,address)' "$ESCROW" "$MULTICALL3"
creation_matches "$BEACON_ID" "$BEACON_TX"
creation_matches "$RULES_ID" "$RULES_TX" 'constructor(address,address,uint64,address,address,uint64)' \
  "$ESCROW" "$C3009" "$EXPIRY_MARGIN" "$BEACON" "$TOKEN" "$BEACON_MARGIN"

# The deployment is wired as the review assumed. Phase one has no bond vault (ADR-0031 §8).
TOKEN_STORE_IMPL="$(call "$ESCROW" 'tokenStoreImplementation()(address)')"
expect "rules ESCROW" "$ESCROW" call "$RULES" 'ESCROW()(address)'
expect "rules ERC3009_COLLECTOR" "$C3009" call "$RULES" 'ERC3009_COLLECTOR()(address)'
expect "rules BEACON" "$BEACON" call "$RULES" 'BEACON()(address)'
expect "rules EXPIRY_MARGIN" "$EXPIRY_MARGIN" call "$RULES" 'EXPIRY_MARGIN()(uint64)'
expect "rules TOKEN" "$TOKEN" call "$RULES" 'TOKEN()(address)'
expect "rules BEACON_MARGIN" "$BEACON_MARGIN" call "$RULES" 'BEACON_MARGIN()(uint64)'

# T-383: one token, three ways. TOKEN() equals the record's token (above); the token holds code; and the table's entry
# for this chain, when it has one, names the same token. The contract's constructor checks neither on purpose: a token
# with no code could take no funding, so the check after the deploy is the place for it (refinement plan, item 53).
TOKEN_CODE="$(cast code "$TOKEN" --rpc-url "$RPC")" || fail "reading the code at the token $TOKEN failed"
[ "$TOKEN_CODE" != 0x ] || fail "no contract at the token address $TOKEN: no deal could fund"
TABLE_TOKEN="$(jq -r --arg chain "$CHAIN" 'if has($chain) then (.[$chain].address // "none") else "" end' "$TABLE")" || fail "reading the accepted-token table $TABLE failed"
# Only a chain with no entry skips the table, and Sepolia must have one (review of PR 423, M4).
ADDRESS_FORM='^0x[0-9a-fA-F]{40}$'
if [ "$CHAIN" = "$SEPOLIA" ] && [ -z "$TABLE_TOKEN" ]; then fail "the accepted-token table $TABLE has no entry for Sepolia"; fi
if [ -n "$TABLE_TOKEN" ] && ! [[ "$TABLE_TOKEN" =~ $ADDRESS_FORM ]]; then fail "the accepted-token table's entry for chain $CHAIN names no address"; fi
TOKEN_LOWER="$(tr '[:upper:]' '[:lower:]' <<<"$TOKEN")"
TABLE_LOWER="$(tr '[:upper:]' '[:lower:]' <<<"$TABLE_TOKEN")"
if [ -z "$TABLE_TOKEN" ] || [ "$TABLE_LOWER" = "$TOKEN_LOWER" ]; then
  :
elif [ "$MODE" = deploy ]; then
  # Each Sepolia deployment creates its own test token, so the table names the last one until the record's copies
  # are written (cutover step 3). --check compares all three after that.
  echo "deploy-sepolia: this deployment created the token $TOKEN; the table names $TABLE_TOKEN for chain $CHAIN until scripts/record-copies.mjs writes the new record's copies, and --check then compares all three"
else
  fail "the record's token is $TOKEN, but Crow's operators accept $TABLE_TOKEN on chain $CHAIN ($TABLE)"
fi
expect "ERC-3009 collector escrow" "$ESCROW" call "$C3009" 'authCaptureEscrow()(address)'
expect "ERC-3009 collector multicall3" "$MULTICALL3" call "$C3009" 'multicall3()(address)'

# The beacon's runtime is deterministic (its one immutable is a constant), so an agent can check
# rules.BEACON().codehash against this value before signing (backlog: which beacon a rules contract uses).
BEACON_INIT="$(forge inspect --root "$ROOT" "$BEACON_ID" bytecode)"
BEACON_RUNTIME="$(cast call --rpc-url "$RPC" --create "$BEACON_INIT")"
BEACON_CODEHASH="$(cast keccak "$BEACON_RUNTIME")"
BEACON_GOT="$(codehash "$BEACON")"
[ "$BEACON_GOT" = "$BEACON_CODEHASH" ] || fail "beacon code differs from the compiled DrandQuicknetBeacon"
# beaconValue reverts unless the BLS proof verifies, so a returned value is the proof check passing on this chain's
# EIP-2537 precompiles.
VALUE_1000="$(call "$BEACON" 'beaconValue(uint64,bytes)(bytes32)' 1000 "$SIG_1000")"
refuses "a signature outside G1" "$BEACON" 'beaconValue(uint64,bytes)(bytes32)' 1000 "$SIG_1000_PLUS_TORSION"
refuses "another round's signature" "$BEACON" 'beaconValue(uint64,bytes)(bytes32)' 1001 "$SIG_1000"

TOKEN_JSON=null
if [ -n "$TOKEN" ]; then
  TOKEN_BLOCK="$(mined "$TOKEN_TX" "$TOKEN")"
  if [ "$MODE" = deploy ] && [ "$TOKEN_BLOCK" -gt "$FINAL_BLOCK" ]; then
    fail "the token's creation now sits in block $TOKEN_BLOCK, past the $FINALITY block $FINAL_BLOCK: the chain moved under the run; nothing was written"
  fi
  creation_matches "$TOKEN_ID" "$TOKEN_TX"
  TOKEN_NAME="$(call "$TOKEN" 'name()(string)')"
  TOKEN_SYMBOL="$(call "$TOKEN" 'symbol()(string)')"
  TOKEN_DECIMALS="$(call "$TOKEN" 'decimals()(uint8)')"
  # Agents sign ERC-3009 authorizations against this domain, so check it rather than assume Solady's version "1".
  DOMAIN_TYPEHASH="$(cast keccak 'EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)')"
  NAME_HASH="$(cast keccak "$TOKEN_NAME")"
  VERSION_HASH="$(cast keccak 1)"
  DOMAIN_ENCODED="$(cast abi-encode 'f(bytes32,bytes32,bytes32,uint256,address)' \
    "$DOMAIN_TYPEHASH" "$NAME_HASH" "$VERSION_HASH" "$CHAIN" "$TOKEN")"
  TOKEN_DOMAIN="$(cast keccak "$DOMAIN_ENCODED")"
  expect "token DOMAIN_SEPARATOR (name, version 1, chain $CHAIN, address)" "$TOKEN_DOMAIN" \
    call "$TOKEN" 'DOMAIN_SEPARATOR()(bytes32)'
  TOKEN_JSON="$(jq -n --arg address "$TOKEN" --arg tx "$TOKEN_TX" --argjson block "$TOKEN_BLOCK" \
    --arg name "$TOKEN_NAME" --arg symbol "$TOKEN_SYMBOL" --argjson decimals "$TOKEN_DECIMALS" \
    --arg domainSeparator "$TOKEN_DOMAIN" \
    '{address: $address, name: $name, version: "1", symbol: $symbol, decimals: $decimals,
      domainSeparator: $domainSeparator, tx: $tx, block: $block}')"
fi

# When the deployment happened: the first creation's block time, in UTC. The dated copy of this record is named by it
# (scripts/record-copies.mjs keep), so two deployments on one day get two names.
DEPLOYED_TS="$(cast block "$ESCROW_BLOCK" --field timestamp --rpc-url "$RPC")" || fail "reading block $ESCROW_BLOCK failed"
DEPLOYED_TS="$(cast to-dec "$DEPLOYED_TS")" || fail "bad block time $DEPLOYED_TS"
DEPLOYED_AT="$(jq -rn --argjson t "$DEPLOYED_TS" '$t | todate')" || fail "formatting the block time failed"

SETTINGS_RAW="$(forge config --root "$ROOT" --json)"
SETTINGS="$(jq -e '{solc: .solc, viaIR: .via_ir, optimizer: .optimizer, optimizerRuns: .optimizer_runs, evmVersion: .evm_version}' <<<"$SETTINGS_RAW")"

RECORD="$(jq -n \
  --arg commit "$COMMIT" \
  --arg deployer "$DEPLOYER" \
  --argjson compiler "$SETTINGS" \
  --argjson fromBlock "$ESCROW_BLOCK" --arg deployedAt "$DEPLOYED_AT" \
  --arg escrow "$ESCROW" --arg escrowTx "$ESCROW_TX" --argjson escrowBlock "$ESCROW_BLOCK" \
  --arg tokenStoreImplementation "$TOKEN_STORE_IMPL" \
  --arg c3009 "$C3009" --arg c3009Tx "$C3009_TX" --argjson c3009Block "$C3009_BLOCK" \
  --arg beacon "$BEACON" --arg beaconTx "$BEACON_TX" --argjson beaconBlock "$BEACON_BLOCK" \
  --arg rules "$RULES" --arg rulesTx "$RULES_TX" --argjson rulesBlock "$RULES_BLOCK" \
  --arg value1000 "$VALUE_1000" --arg beaconCodeHash "$BEACON_CODEHASH" \
  --arg multicall "$MULTICALL3" --arg multicallCodeHash "$MULTICALL3_CODEHASH" \
  --argjson expiryMarginSec "$EXPIRY_MARGIN" --argjson beaconMarginSec "$BEACON_MARGIN" \
  --argjson chainId "$CHAIN" \
  --argjson token "$TOKEN_JSON" --arg tokenAddress "$TOKEN" \
  '{
    chainId: $chainId,
    commit: $commit,
    compiler: $compiler,
    deployer: $deployer,
    fromBlock: $fromBlock,
    deployedAt: $deployedAt,
    escrow: $escrow,
    erc3009Collector: $c3009,
    multicall: $multicall,
    rules: $rules,
    beacon: $beacon,
    expiryMarginSec: $expiryMarginSec,
    beaconMarginSec: $beaconMarginSec,
    token: $token,
    checks: {
      creationCodeMatchesBuild: true,
      multicallCodeHash: $multicallCodeHash,
      beaconCodeHash: $beaconCodeHash,
      beaconRound1000Value: $value1000,
      beaconRefusesOutsideG1: true,
      beaconRefusesAnotherRound: true
    },
    contracts: {
      AuthCaptureEscrow: {address: $escrow, tx: $escrowTx, block: $escrowBlock, args: [],
        tokenStoreImplementation: $tokenStoreImplementation},
      ERC3009PaymentCollector: {address: $c3009, tx: $c3009Tx, block: $c3009Block, args: [$escrow, $multicall]},
      DrandQuicknetBeacon: {address: $beacon, tx: $beaconTx, block: $beaconBlock, args: []},
      HoldbackRules: {address: $rules, tx: $rulesTx, block: $rulesBlock,
        args: [$escrow, $c3009, ($expiryMarginSec | tostring), $beacon, $tokenAddress, ($beaconMarginSec | tostring)]}
    }
  }')"

# verify_all: the five contracts on Sourcify, through its API v2, by the committed tool (T-410). It checks each
# contract against the chain first and sends nothing unless all five are exact; VERIFY_DRY_RUN=1 stops it there. A
# rehearsal may name a stand-in Sourcify server on this machine in SOURCIFY_URL; Sepolia goes to Sourcify itself.
verify_all() {
  local tool="$ROOT/../scripts/sourcify-verify.mjs" args
  [ -f "$tool" ] || fail "scripts/sourcify-verify.mjs is missing"
  args=(--record "$OUT" --rpc "$RPC" --root "$ROOT/..")
  if [ -n "${SOURCIFY_URL:-}" ]; then args+=(--sourcify "$SOURCIFY_URL"); fi
  if [ "${VERIFY_DRY_RUN:-}" = 1 ]; then
    node "$tool" "${args[@]}" || fail "the source check failed: nothing was sent to Sourcify"
    echo "deploy-sepolia: dry run: nothing was sent to Sourcify"
    return 0
  fi
  if [ "$CHAIN" = "$LOCAL" ] && [ -z "${SOURCIFY_URL:-}" ]; then
    fail "no explorer serves the local chain; a rehearsal runs --verify with VERIFY_DRY_RUN=1, or SOURCIFY_URL names a stand-in"
  fi
  node "$tool" "${args[@]}" --submit || fail "Sourcify verification did not end in five exact matches: read the lines above"
  echo "deploy-sepolia: the five contracts are an exact match on Sourcify"
}

if [ "$MODE" = check ]; then
  RECORDED="$(jq -S . "$OUT")"
  DERIVED="$(jq -S . <<<"$RECORD")"
  [ "$RECORDED" = "$DERIVED" ] || fail "the record $OUT differs from what the chain and this build give"
  echo "deploy-sepolia: $OUT matches the chain and the build at $COMMIT"
  if [ "$VERIFY" = yes ]; then verify_all; fi
else
  # Written whole or not at all: a temporary file beside the record, moved into place.
  mkdir -p "$(dirname "$OUT")"
  TMP_RECORD="$(mktemp "$(dirname "$OUT")/.record.XXXXXX")" || fail "making a temporary file beside $OUT failed"
  printf '%s\n' "$RECORD" >"$TMP_RECORD" || fail "writing $TMP_RECORD failed"
  mv -f "$TMP_RECORD" "$OUT" || fail "moving the record into $OUT failed"
  RECORD_WRITTEN=yes
  echo "wrote $OUT"
fi
