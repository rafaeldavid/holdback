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
#
# Every check fails closed. Bash ignores a failure inside `$(...)` used as an argument or inside `[ ]`, and inside a
# function running in `$(...)` (bash 3.2 has no inherit_errexit), so each substitution is a plain assignment or ends
# in `|| fail`.
set -euo pipefail

SEPOLIA=11155111
# foundry.toml pins chain_id 31337 for the local chain; every forge and cast call below signs for Sepolia instead.
export FOUNDRY_CHAIN_ID=$SEPOLIA

PERMIT2=0x000000000022D473030F116dDEE9F6B43aC78BA3
PERMIT2_CODEHASH=0x96d9f5c3f0fb0423426b7f970186235b7347027f4e5c19c40c412b7d97fc3751
MULTICALL3=0xcA11bde05977b3631167028862bE2a173976CA11
MULTICALL3_CODEHASH=0xd5c15df687b16f2ff992fc8d767b4216323184a2bbc6ee2f9c398c318e770891
EXPIRY_MARGIN=86400 # T-206 review §7: one day, the value the local EVM world and the tests use

# drand quicknet round 1000, and the same signature plus an order-3 curve point outside G1 (T-206 audit cross-check).
SIG_1000=0xb44679b9a59af2ec876b1a6b1ad52ea9b1615fc3982b19576350f93447cb1125e342b73a8dd2bacbe47e4b6b63ed5e39
SIG_1000_PLUS_TORSION=0xabbaa2cd356c8b543308abe2c07d92facb092294f841b0c295786b635167aba148d4e2e86fedf3cf2c04c43b68a5aaee
INVALID_SIGNATURE=0x8baa579f # DrandQuicknetBeacon's InvalidSignature()

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/deployments/sepolia.json"
BUILD_INPUTS=(src lib foundry.toml remappings.txt script/TestUSDC.sol)

fail() {
  echo "deploy-sepolia: $1" >&2
  exit 1
}

if [ "${1:-}" = --check ]; then
  [ "$#" -eq 2 ] || fail "usage: deploy-sepolia.sh --check <rpc-url>"
  MODE=check
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
  jq -er "$1" "$OUT" || fail "contracts/deployments/sepolia.json has no $1"
}

CHAIN="$(cast chain-id --rpc-url "$RPC")"
[ "$CHAIN" = "$SEPOLIA" ] || fail "chain id $CHAIN is not Sepolia ($SEPOLIA)"

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

PERMIT2_GOT="$(codehash "$PERMIT2")"
[ "$PERMIT2_GOT" = "$PERMIT2_CODEHASH" ] || fail "unexpected code at Permit2"
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
CP2_ID=lib/commerce-payments/src/collectors/Permit2PaymentCollector.sol:Permit2PaymentCollector
BEACON_ID=src/DrandQuicknetBeacon.sol:DrandQuicknetBeacon
RULES_ID=src/HoldbackRules.sol:HoldbackRules
TOKEN_ID=script/TestUSDC.sol:TestUSDC

if [ "$MODE" = deploy ]; then
  OUT_LINE="$(create "$ESCROW_ID")"
  read -r ESCROW ESCROW_TX <<<"$OUT_LINE"
  OUT_LINE="$(create "$C3009_ID" "$ESCROW" "$MULTICALL3")"
  read -r C3009 C3009_TX <<<"$OUT_LINE"
  OUT_LINE="$(create "$CP2_ID" "$ESCROW" "$PERMIT2" "$MULTICALL3")"
  read -r CP2 CP2_TX <<<"$OUT_LINE"
  OUT_LINE="$(create "$BEACON_ID")"
  read -r BEACON BEACON_TX <<<"$OUT_LINE"
  OUT_LINE="$(create "$RULES_ID" "$ESCROW" "$C3009" "$CP2" "$EXPIRY_MARGIN" "$BEACON")"
  read -r RULES RULES_TX <<<"$OUT_LINE"
  # The demo's open-mint test token, when it is on this commit (Sepolia demo session). The escrow is token-agnostic:
  # the terms name the token, so the core set does not depend on it.
  TOKEN=""
  if [ -f "$ROOT/script/TestUSDC.sol" ]; then
    OUT_LINE="$(create "$TOKEN_ID")"
    read -r TOKEN TOKEN_TX <<<"$OUT_LINE"
  fi
else
  ESCROW="$(field .contracts.AuthCaptureEscrow.address)"
  ESCROW_TX="$(field .contracts.AuthCaptureEscrow.tx)"
  C3009="$(field .contracts.ERC3009PaymentCollector.address)"
  C3009_TX="$(field .contracts.ERC3009PaymentCollector.tx)"
  CP2="$(field .contracts.Permit2PaymentCollector.address)"
  CP2_TX="$(field .contracts.Permit2PaymentCollector.tx)"
  BEACON="$(field .contracts.DrandQuicknetBeacon.address)"
  BEACON_TX="$(field .contracts.DrandQuicknetBeacon.tx)"
  RULES="$(field .contracts.HoldbackRules.address)"
  RULES_TX="$(field .contracts.HoldbackRules.tx)"
  TOKEN="$(jq -r '.token.address // ""' "$OUT")"
  [ -z "$TOKEN" ] || TOKEN_TX="$(field .token.tx)"
fi

# Each transaction succeeded, came from the deployer, and carried this build's creation code and arguments.
ESCROW_BLOCK="$(mined "$ESCROW_TX" "$ESCROW")"
C3009_BLOCK="$(mined "$C3009_TX" "$C3009")"
CP2_BLOCK="$(mined "$CP2_TX" "$CP2")"
BEACON_BLOCK="$(mined "$BEACON_TX" "$BEACON")"
RULES_BLOCK="$(mined "$RULES_TX" "$RULES")"
creation_matches "$ESCROW_ID" "$ESCROW_TX"
creation_matches "$C3009_ID" "$C3009_TX" 'constructor(address,address)' "$ESCROW" "$MULTICALL3"
creation_matches "$CP2_ID" "$CP2_TX" 'constructor(address,address,address)' "$ESCROW" "$PERMIT2" "$MULTICALL3"
creation_matches "$BEACON_ID" "$BEACON_TX"
creation_matches "$RULES_ID" "$RULES_TX" 'constructor(address,address,address,uint64,address)' \
  "$ESCROW" "$C3009" "$CP2" "$EXPIRY_MARGIN" "$BEACON"

# The deployment is wired as the review assumed. Phase one has no bond vault (ADR-0031 §8).
TOKEN_STORE_IMPL="$(call "$ESCROW" 'tokenStoreImplementation()(address)')"
expect "rules ESCROW" "$ESCROW" call "$RULES" 'ESCROW()(address)'
expect "rules ERC3009_COLLECTOR" "$C3009" call "$RULES" 'ERC3009_COLLECTOR()(address)'
expect "rules PERMIT2_COLLECTOR" "$CP2" call "$RULES" 'PERMIT2_COLLECTOR()(address)'
expect "rules BEACON" "$BEACON" call "$RULES" 'BEACON()(address)'
expect "rules EXPIRY_MARGIN" "$EXPIRY_MARGIN" call "$RULES" 'EXPIRY_MARGIN()(uint64)'
expect "ERC-3009 collector escrow" "$ESCROW" call "$C3009" 'authCaptureEscrow()(address)'
expect "ERC-3009 collector multicall3" "$MULTICALL3" call "$C3009" 'multicall3()(address)'
expect "Permit2 collector escrow" "$ESCROW" call "$CP2" 'authCaptureEscrow()(address)'
expect "Permit2 collector permit2" "$PERMIT2" call "$CP2" 'permit2()(address)'
expect "Permit2 collector multicall3" "$MULTICALL3" call "$CP2" 'multicall3()(address)'

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
    "$DOMAIN_TYPEHASH" "$NAME_HASH" "$VERSION_HASH" "$SEPOLIA" "$TOKEN")"
  TOKEN_DOMAIN="$(cast keccak "$DOMAIN_ENCODED")"
  expect "token DOMAIN_SEPARATOR (name, version 1, Sepolia, address)" "$TOKEN_DOMAIN" \
    call "$TOKEN" 'DOMAIN_SEPARATOR()(bytes32)'
  TOKEN_JSON="$(jq -n --arg address "$TOKEN" --arg tx "$TOKEN_TX" --argjson block "$TOKEN_BLOCK" \
    --arg name "$TOKEN_NAME" --arg symbol "$TOKEN_SYMBOL" --argjson decimals "$TOKEN_DECIMALS" \
    --arg domainSeparator "$TOKEN_DOMAIN" \
    '{address: $address, name: $name, version: "1", symbol: $symbol, decimals: $decimals,
      domainSeparator: $domainSeparator, tx: $tx, block: $block}')"
fi

SETTINGS_RAW="$(forge config --root "$ROOT" --json)"
SETTINGS="$(jq -e '{solc: .solc, viaIR: .via_ir, optimizer: .optimizer, optimizerRuns: .optimizer_runs, evmVersion: .evm_version}' <<<"$SETTINGS_RAW")"

RECORD="$(jq -n \
  --arg commit "$COMMIT" \
  --arg deployer "$DEPLOYER" \
  --argjson compiler "$SETTINGS" \
  --argjson fromBlock "$ESCROW_BLOCK" \
  --arg escrow "$ESCROW" --arg escrowTx "$ESCROW_TX" --argjson escrowBlock "$ESCROW_BLOCK" \
  --arg tokenStoreImplementation "$TOKEN_STORE_IMPL" \
  --arg c3009 "$C3009" --arg c3009Tx "$C3009_TX" --argjson c3009Block "$C3009_BLOCK" \
  --arg cp2 "$CP2" --arg cp2Tx "$CP2_TX" --argjson cp2Block "$CP2_BLOCK" \
  --arg beacon "$BEACON" --arg beaconTx "$BEACON_TX" --argjson beaconBlock "$BEACON_BLOCK" \
  --arg rules "$RULES" --arg rulesTx "$RULES_TX" --argjson rulesBlock "$RULES_BLOCK" \
  --arg value1000 "$VALUE_1000" --arg beaconCodeHash "$BEACON_CODEHASH" \
  --arg permit2 "$PERMIT2" --arg permit2CodeHash "$PERMIT2_CODEHASH" \
  --arg multicall "$MULTICALL3" --arg multicallCodeHash "$MULTICALL3_CODEHASH" \
  --argjson expiryMarginSec "$EXPIRY_MARGIN" \
  --argjson token "$TOKEN_JSON" \
  '{
    chainId: 11155111,
    commit: $commit,
    compiler: $compiler,
    deployer: $deployer,
    fromBlock: $fromBlock,
    escrow: $escrow,
    erc3009Collector: $c3009,
    permit2Collector: $cp2,
    permit2: $permit2,
    multicall: $multicall,
    rules: $rules,
    beacon: $beacon,
    expiryMarginSec: $expiryMarginSec,
    token: $token,
    checks: {
      creationCodeMatchesBuild: true,
      permit2CodeHash: $permit2CodeHash,
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
      Permit2PaymentCollector: {address: $cp2, tx: $cp2Tx, block: $cp2Block, args: [$escrow, $permit2, $multicall]},
      DrandQuicknetBeacon: {address: $beacon, tx: $beaconTx, block: $beaconBlock, args: []},
      HoldbackRules: {address: $rules, tx: $rulesTx, block: $rulesBlock,
        args: [$escrow, $c3009, $cp2, ($expiryMarginSec | tostring), $beacon]}
    }
  }')"

if [ "$MODE" = check ]; then
  RECORDED="$(jq -S . "$OUT")"
  DERIVED="$(jq -S . <<<"$RECORD")"
  [ "$RECORDED" = "$DERIVED" ] || fail "contracts/deployments/sepolia.json differs from what the chain and this build give"
  echo "deploy-sepolia: contracts/deployments/sepolia.json matches the chain and the build at $COMMIT"
else
  mkdir -p "$(dirname "$OUT")"
  printf '%s\n' "$RECORD" >"$OUT"
  echo "wrote $OUT"
fi
