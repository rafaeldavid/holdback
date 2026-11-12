#!/usr/bin/env bash
# Deploys the reviewed Holdback settlement contracts to Ethereum Sepolia, one `forge create --broadcast` per contract
# (no `forge script`, no `cast send`), checks the deployment, and writes contracts/deployments/sepolia.json.
# With --check it deploys nothing: it re-derives the record from the chain and this checkout's build, read-only, and
# fails unless the result equals contracts/deployments/sepolia.json.
#
# Refuses any chain but Sepolia (11155111): no real money, and no mainnet at any point (hard rule; D4). The deployer
# is a throwaway key with no authority on chain (the contracts have no admin keys); it pays gas and nothing else.
#
# Usage: contracts/script/deploy-sepolia.sh <rpc-url> <keystore-file> <password-file>
#        contracts/script/deploy-sepolia.sh --check <rpc-url>
#        contracts/script/deploy-sepolia.sh --verify <rpc-url>
#
# --verify runs --check first, then publishes each of the five contracts' source on the block explorers with the
# constructor arguments the checked record holds (`forge verify-contract`, T-383): Sourcify always, with no key and no
# account; Etherscan too when ETHERSCAN_API_KEY is in the environment, which forge reads by that name (it is never put
# on a command line). A contract already verified is skipped, so a rerun is safe. VERIFY_DRY_RUN=1 prints the
# commands instead of running them.
#
# A rehearsal (T-383): the same routine on a local anvil (chain 31337, an RPC on 127.0.0.1 or localhost only), with
# DEPLOY_RECORD naming the record to write or check, so a rehearsal never writes over contracts/deployments/sepolia.json.
# It deploys Sepolia's values, the beacon margin included, and Multicall3's canonical code must be at its address.
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
VERIFY_FORGE="${VERIFY_FORGE:-forge}"
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
  receipt="$(cast receipt "$1" --json --rpc-url "$RPC")" || fail "no receipt for $1"
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

CHAIN="$(cast chain-id --rpc-url "$RPC")" || fail "reading the chain id failed"
case "$CHAIN" in
"$SEPOLIA")
  # A Sepolia run writes and checks the one Sepolia record.
  [ "$OUT" = "$SEPOLIA_RECORD" ] || fail "on Sepolia the record is $SEPOLIA_RECORD; unset DEPLOY_RECORD"
  [ "$TABLE" = "$REPO_TABLE" ] || fail "on Sepolia the accepted-token table is $REPO_TABLE; unset ACCEPTED_TOKENS"
  ;;
"$LOCAL")
  LOCAL_RPC='^http://(127\.0\.0\.1|localhost)(:[0-9]+)?/?$'
  # The URL stays out of the message: a hosted RPC's URL may carry its key.
  [[ "$RPC" =~ $LOCAL_RPC ]] || fail "chain id $LOCAL is a rehearsal on this machine only; the RPC URL is not a local RPC (http://127.0.0.1 or http://localhost)"
  [ -n "${DEPLOY_RECORD:-}" ] || fail "a rehearsal on the local chain needs DEPLOY_RECORD, the record to write or check"
  # Compared as folders, resolved, not as strings: a relative or dotted spelling of sepolia.json names the same file.
  # A rehearsal's record lives anywhere but contracts/deployments/, so it can never write over a kept record.
  OUT_DIR="$(cd "$(dirname "$OUT")" 2>/dev/null && pwd -P)" || fail "the folder of DEPLOY_RECORD ($OUT) does not exist"
  DEPLOYMENTS_DIR="$(cd "$ROOT/deployments" && pwd -P)" || fail "contracts/deployments is missing"
  [ "$OUT_DIR" != "$DEPLOYMENTS_DIR" ] || fail "a rehearsal must not write or check a record in $DEPLOYMENTS_DIR; name a scratch file in DEPLOY_RECORD"
  [ ! "$OUT" -ef "$SEPOLIA_RECORD" ] || fail "a rehearsal must not write or check $SEPOLIA_RECORD"
  ;;
*) fail "chain id $CHAIN is not Sepolia ($SEPOLIA), nor the local chain ($LOCAL) for a rehearsal" ;;
esac
# foundry.toml pins chain_id 31337 for the local chain; every forge and cast call below signs for this chain instead.
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

# create <path:Contract> [constructor args...]: deploys and prints "address tx".
create() {
  local id="$1" json address tx
  shift
  local args=(--root "$ROOT" --rpc-url "$RPC" --keystore "$KEYSTORE" --password-file "$PASSWORD_FILE" --broadcast --json)
  if [ "$#" -gt 0 ]; then
    json="$(forge create "$id" "${args[@]}" --constructor-args "$@")" || fail "forge create $id failed"
  else
    json="$(forge create "$id" "${args[@]}")" || fail "forge create $id failed"
  fi
  address="$(jq -er '.deployedTo' <<<"$json")" || fail "forge create $id reported no address"
  tx="$(jq -er '.transactionHash' <<<"$json")" || fail "forge create $id reported no transaction"
  echo "$address $tx"
}

ESCROW_ID=lib/commerce-payments/src/AuthCaptureEscrow.sol:AuthCaptureEscrow
C3009_ID=lib/commerce-payments/src/collectors/ERC3009PaymentCollector.sol:ERC3009PaymentCollector
BEACON_ID=src/DrandQuicknetBeacon.sol:DrandQuicknetBeacon
RULES_ID=src/HoldbackRules.sol:HoldbackRules
TOKEN_ID=script/TestUSDC.sol:TestUSDC

if [ "$MODE" = deploy ]; then
  OUT_LINE="$(create "$ESCROW_ID")"
  read -r ESCROW ESCROW_TX <<<"$OUT_LINE"
  OUT_LINE="$(create "$C3009_ID" "$ESCROW" "$MULTICALL3")"
  read -r C3009 C3009_TX <<<"$OUT_LINE"
  OUT_LINE="$(create "$BEACON_ID")"
  read -r BEACON BEACON_TX <<<"$OUT_LINE"
  # The demo's open-mint test token. A deployment serves one token, fixed in the rules contract's constructor
  # (ADR-0031 §2, SC-1), so the token comes first.
  [ -f "$ROOT/script/TestUSDC.sol" ] || fail "script/TestUSDC.sol is missing: the rules contract needs its token at deploy"
  OUT_LINE="$(create "$TOKEN_ID")"
  read -r TOKEN TOKEN_TX <<<"$OUT_LINE"
  OUT_LINE="$(create "$RULES_ID" "$ESCROW" "$C3009" "$EXPIRY_MARGIN" "$BEACON" "$TOKEN" "$BEACON_MARGIN")"
  read -r RULES RULES_TX <<<"$OUT_LINE"
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

# run_verify <explorer> <command...>: runs one verification, or prints it under VERIFY_DRY_RUN=1. No key is ever on
# the command line: forge reads ETHERSCAN_API_KEY from the environment itself. forge's own output can still carry the
# key (a failed request prints its URL, `?apikey=…`; review of PR 424), so it is captured and the key's value replaced
# before anything is printed.
run_verify() {
  local who="$1" out status
  shift
  if [ "${VERIFY_DRY_RUN:-}" = 1 ]; then
    echo "deploy-sepolia: would run: $*"
    return 0
  fi
  status=0
  out="$("$@" 2>&1)" || status=$?
  if [ -n "${ETHERSCAN_API_KEY:-}" ]; then out="${out//"$ETHERSCAN_API_KEY"/<ETHERSCAN_API_KEY>}"; fi
  printf '%s\n' "$out"
  [ "$status" -eq 0 ] || fail "$who verification failed (exit $status): $*"
}

# verify_one <Sourcify|Etherscan> <path:Contract> <address> [constructor-signature args...]. Neither run takes a
# verifier URL or key from the environment (forge reads VERIFIER_URL and VERIFIER_API_KEY), so a submission goes to the
# named explorer only; Sourcify also runs without ETHERSCAN_API_KEY, so no key goes to it.
verify_one() {
  local who="$1" id="$2" address="$3" encoded=""
  shift 3
  if [ "$#" -gt 0 ]; then
    encoded="$(cast abi-encode "$@")" || fail "encoding the constructor arguments of $id failed"
  fi
  local base=("$VERIFY_FORGE" verify-contract "$address" "$id" --root "$ROOT" --chain "$CHAIN" --watch)
  if [ -n "$encoded" ]; then base+=(--constructor-args "$encoded"); fi
  if [ "$who" = Sourcify ]; then
    run_verify Sourcify env -u ETHERSCAN_API_KEY -u VERIFIER_URL -u VERIFIER_API_KEY "${base[@]}" --verifier sourcify
  else
    run_verify Etherscan env -u VERIFIER_URL -u VERIFIER_API_KEY "${base[@]}" --verifier etherscan
  fi
}

# verify_all: the five contracts on Sourcify, then, with a key, the five on Etherscan: a failure on Etherscan leaves
# Sourcify complete. Each takes the constructor arguments of the record --check has just derived and matched.
verify_all() {
  # A rehearsal may name a stand-in for forge's verify-contract (a test's), which sends nothing; Sepolia may not.
  if [ "$CHAIN" = "$SEPOLIA" ] && [ "$VERIFY_FORGE" != forge ]; then fail "on Sepolia --verify runs forge itself; unset VERIFY_FORGE"; fi
  if [ "$CHAIN" = "$LOCAL" ] && [ "${VERIFY_DRY_RUN:-}" != 1 ] && [ "$VERIFY_FORGE" = forge ]; then
    fail "no explorer serves the local chain; a rehearsal runs --verify with VERIFY_DRY_RUN=1"
  fi
  local c3009_text rules_text c3009_args rules_args who explorers=(Sourcify)
  c3009_text="$(jq -er '.contracts.ERC3009PaymentCollector.args | join(" ")' <<<"$RECORD")" || fail "the record has no collector arguments"
  rules_text="$(jq -er '.contracts.HoldbackRules.args | join(" ")' <<<"$RECORD")" || fail "the record has no rules arguments"
  read -r -a c3009_args <<<"$c3009_text"
  read -r -a rules_args <<<"$rules_text"
  [ "${#c3009_args[@]}" -eq 2 ] || fail "the record's collector has ${#c3009_args[@]} arguments, not 2"
  [ "${#rules_args[@]}" -eq 6 ] || fail "the record's rules contract has ${#rules_args[@]} arguments, not 6"
  if [ -n "${ETHERSCAN_API_KEY:-}" ]; then explorers+=(Etherscan); fi
  for who in "${explorers[@]}"; do
    verify_one "$who" "$ESCROW_ID" "$ESCROW"
    verify_one "$who" "$C3009_ID" "$C3009" 'constructor(address,address)' "${c3009_args[@]}"
    verify_one "$who" "$BEACON_ID" "$BEACON"
    verify_one "$who" "$TOKEN_ID" "$TOKEN"
    verify_one "$who" "$RULES_ID" "$RULES" 'constructor(address,address,uint64,address,address,uint64)' "${rules_args[@]}"
  done
  if [ "${VERIFY_DRY_RUN:-}" = 1 ]; then
    echo "deploy-sepolia: dry run: nothing was sent to an explorer"
  elif [ -n "${ETHERSCAN_API_KEY:-}" ]; then
    echo "deploy-sepolia: the five contracts are verified on Sourcify and Etherscan"
  else
    echo "deploy-sepolia: the five contracts are verified on Sourcify; set ETHERSCAN_API_KEY to verify on Etherscan too"
  fi
}

if [ "$MODE" = check ]; then
  RECORDED="$(jq -S . "$OUT")"
  DERIVED="$(jq -S . <<<"$RECORD")"
  [ "$RECORDED" = "$DERIVED" ] || fail "the record $OUT differs from what the chain and this build give"
  echo "deploy-sepolia: $OUT matches the chain and the build at $COMMIT"
  if [ "$VERIFY" = yes ]; then verify_all; fi
else
  mkdir -p "$(dirname "$OUT")"
  printf '%s\n' "$RECORD" >"$OUT"
  echo "wrote $OUT"
fi
