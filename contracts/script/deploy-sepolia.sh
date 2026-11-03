#!/usr/bin/env bash
# Deploys the reviewed Holdback settlement contracts to Ethereum Sepolia, one `forge create --broadcast` per contract
# (no `forge script`, no `cast send`), checks the deployment, and writes contracts/deployments/sepolia.json.
#
# Refuses any chain but Sepolia (11155111): no real money, and no mainnet at any point (hard rule; D4). The deployer
# is a throwaway key with no authority on chain (the contracts have no admin keys); it pays gas and nothing else.
#
# Usage: contracts/script/deploy-sepolia.sh <rpc-url> <keystore-file> <password-file>
set -euo pipefail

RPC="$1"
KEYSTORE="$2"
PASSWORD_FILE="$3"

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

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/deployments/sepolia.json"

fail() {
  echo "deploy-sepolia: $1" >&2
  exit 1
}

chain="$(cast chain-id --rpc-url "$RPC")"
[ "$chain" = "$SEPOLIA" ] || fail "chain id $chain is not Sepolia ($SEPOLIA)"
[ -z "$(git -C "$ROOT" status --porcelain -- src lib foundry.toml remappings.txt)" ] ||
  fail "contracts/src, lib or the build config differ from the commit"
# keccak256 of eth_getCode, the same value as EXTCODEHASH (`cast codehash` needs eth_getProof, which not every RPC serves).
codehash() {
  cast keccak "$(cast code "$1" --rpc-url "$RPC")"
}
[ "$(codehash "$PERMIT2")" = "$PERMIT2_CODEHASH" ] || fail "unexpected code at Permit2"
[ "$(codehash "$MULTICALL3")" = "$MULTICALL3_CODEHASH" ] || fail "unexpected code at Multicall3"

# create <path:Contract> [constructor args...]: deploys and echoes "address tx block".
create() {
  local id="$1"
  shift
  local args=(--root "$ROOT" --rpc-url "$RPC" --keystore "$KEYSTORE" --password-file "$PASSWORD_FILE" --broadcast --json)
  local json
  if [ "$#" -gt 0 ]; then
    json="$(forge create "$id" "${args[@]}" --constructor-args "$@")"
  else
    json="$(forge create "$id" "${args[@]}")"
  fi
  local address tx block
  address="$(jq -r '.deployedTo' <<<"$json")"
  tx="$(jq -r '.transactionHash' <<<"$json")"
  block="$(cast receipt "$tx" blockNumber --rpc-url "$RPC")"
  echo "$address $tx $block"
}

read -r ESCROW ESCROW_TX ESCROW_BLOCK <<<"$(create lib/commerce-payments/src/AuthCaptureEscrow.sol:AuthCaptureEscrow)"
read -r C3009 C3009_TX C3009_BLOCK <<<"$(create \
  lib/commerce-payments/src/collectors/ERC3009PaymentCollector.sol:ERC3009PaymentCollector "$ESCROW" "$MULTICALL3")"
read -r CP2 CP2_TX CP2_BLOCK <<<"$(create \
  lib/commerce-payments/src/collectors/Permit2PaymentCollector.sol:Permit2PaymentCollector "$ESCROW" "$PERMIT2" "$MULTICALL3")"
read -r BEACON BEACON_TX BEACON_BLOCK <<<"$(create src/DrandQuicknetBeacon.sol:DrandQuicknetBeacon)"
read -r RULES RULES_TX RULES_BLOCK <<<"$(create src/HoldbackRules.sol:HoldbackRules \
  "$ESCROW" "$C3009" "$CP2" "$EXPIRY_MARGIN" "$BEACON")"
BONDS="$(cast call "$RULES" 'BONDS()(address)' --rpc-url "$RPC")"
TOKEN_STORE_IMPL="$(cast call "$ESCROW" 'tokenStoreImplementation()(address)' --rpc-url "$RPC")"

# The demo's open-mint test token, when it is on this commit (Sepolia demo session). The escrow is token-agnostic:
# the terms name the token, so the core set does not depend on it.
TOKEN_JSON=null
if [ -f "$ROOT/script/TestUSDC.sol" ]; then
  read -r TOKEN TOKEN_TX TOKEN_BLOCK <<<"$(create script/TestUSDC.sol:TestUSDC)"
  TOKEN_NAME="$(cast call "$TOKEN" 'name()(string)' --rpc-url "$RPC" | tr -d '"')"
  # Agents sign ERC-3009 authorizations against this domain, so check it rather than assume Solady's version "1".
  DOMAIN_TYPEHASH="$(cast keccak 'EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)')"
  TOKEN_DOMAIN="$(cast keccak "$(cast abi-encode 'f(bytes32,bytes32,bytes32,uint256,address)' \
    "$DOMAIN_TYPEHASH" "$(cast keccak "$TOKEN_NAME")" "$(cast keccak 1)" "$SEPOLIA" "$TOKEN")")"
  [ "$(cast call "$TOKEN" 'DOMAIN_SEPARATOR()(bytes32)' --rpc-url "$RPC")" = "$TOKEN_DOMAIN" ] ||
    fail "token EIP-712 domain is not (name, version 1, Sepolia, address)"
  TOKEN_JSON="$(jq -n --arg address "$TOKEN" --arg tx "$TOKEN_TX" --argjson block "$TOKEN_BLOCK" \
    --arg name "$TOKEN_NAME" --arg domainSeparator "$TOKEN_DOMAIN" \
    --arg symbol "$(cast call "$TOKEN" 'symbol()(string)' --rpc-url "$RPC" | tr -d '"')" \
    --argjson decimals "$(cast call "$TOKEN" 'decimals()(uint8)' --rpc-url "$RPC" | awk '{print $1}')" \
    '{address: $address, name: $name, version: "1", symbol: $symbol, decimals: $decimals,
      domainSeparator: $domainSeparator, tx: $tx, block: $block}')"
fi

# The deployment is wired as the review assumed, and the beacon verifies on this chain's EIP-2537 precompiles.
[ "$(cast call "$RULES" 'ESCROW()(address)' --rpc-url "$RPC")" = "$ESCROW" ] || fail "rules ESCROW mismatch"
[ "$(cast call "$RULES" 'BEACON()(address)' --rpc-url "$RPC")" = "$BEACON" ] || fail "rules BEACON mismatch"
[ "$(cast call "$RULES" 'EXPIRY_MARGIN()(uint64)' --rpc-url "$RPC" | awk '{print $1}')" = "$EXPIRY_MARGIN" ] || fail "margin mismatch"
[ "$(cast call "$BONDS" 'RULES()(address)' --rpc-url "$RPC")" = "$RULES" ] || fail "bonds RULES mismatch"
# beaconValue reverts unless the BLS proof verifies, so a returned value is the proof check passing on this chain.
VALUE_1000="$(cast call "$BEACON" 'beaconValue(uint64,bytes)(bytes32)' 1000 "$SIG_1000" --rpc-url "$RPC")" ||
  fail "beacon refused drand round 1000"
if cast call "$BEACON" 'beaconValue(uint64,bytes)(bytes32)' 1000 "$SIG_1000_PLUS_TORSION" --rpc-url "$RPC" >/dev/null 2>&1; then
  fail "beacon accepted a signature outside G1"
fi
if cast call "$BEACON" 'beaconValue(uint64,bytes)(bytes32)' 1001 "$SIG_1000" --rpc-url "$RPC" >/dev/null 2>&1; then
  fail "beacon accepted another round's signature"
fi
# The beacon's runtime is deterministic (its one immutable is a constant), so an agent can check
# rules.BEACON().codehash against this value before signing (backlog: which beacon a rules contract uses).
BEACON_RUNTIME="$(cast call --rpc-url "$RPC" --create \
  "$(forge inspect --root "$ROOT" src/DrandQuicknetBeacon.sol:DrandQuicknetBeacon bytecode)")"
BEACON_CODEHASH="$(cast keccak "$BEACON_RUNTIME")"
[ "$(codehash "$BEACON")" = "$BEACON_CODEHASH" ] ||
  fail "beacon code differs from the compiled DrandQuicknetBeacon"

SETTINGS="$(forge config --root "$ROOT" --json | jq '{solc: .solc, viaIR: .via_ir, optimizer: .optimizer, optimizerRuns: .optimizer_runs, evmVersion: .evm_version}')"

mkdir -p "$(dirname "$OUT")"
jq -n \
  --arg commit "$(git -C "$ROOT" rev-parse HEAD)" \
  --arg deployer "$(cast wallet address --keystore "$KEYSTORE" --password-file "$PASSWORD_FILE")" \
  --argjson compiler "$SETTINGS" \
  --argjson fromBlock "$ESCROW_BLOCK" \
  --arg escrow "$ESCROW" --arg escrowTx "$ESCROW_TX" --argjson escrowBlock "$ESCROW_BLOCK" \
  --arg tokenStoreImplementation "$TOKEN_STORE_IMPL" \
  --arg c3009 "$C3009" --arg c3009Tx "$C3009_TX" --argjson c3009Block "$C3009_BLOCK" \
  --arg cp2 "$CP2" --arg cp2Tx "$CP2_TX" --argjson cp2Block "$CP2_BLOCK" \
  --arg beacon "$BEACON" --arg beaconTx "$BEACON_TX" --argjson beaconBlock "$BEACON_BLOCK" \
  --arg rules "$RULES" --arg rulesTx "$RULES_TX" --argjson rulesBlock "$RULES_BLOCK" \
  --arg bonds "$BONDS" --arg value1000 "$VALUE_1000" --arg beaconCodeHash "$BEACON_CODEHASH" \
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
    bonds: $bonds,
    beacon: $beacon,
    expiryMarginSec: $expiryMarginSec,
    token: $token,
    checks: {
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
        args: [$escrow, $c3009, $cp2, ($expiryMarginSec | tostring), $beacon]},
      HoldbackBonds: {address: $bonds, tx: $rulesTx, block: $rulesBlock, args: [], createdBy: "HoldbackRules constructor"}
    }
  }' >"$OUT"
echo "wrote $OUT"
