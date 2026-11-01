// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {console} from "forge-std/console.sol";
import {HoldbackRules} from "../src/HoldbackRules.sol";
import {SpikeBase} from "./SpikeBase.sol";

/// Gas per deal (D4: record it so the D33 fee can be checked against it).
/// Run with `forge test --match-contract GasPerDeal --isolate -vv`: --isolate executes each top-level call as its
/// own transaction (fresh warm/cold access sets, 21000 intrinsic gas and calldata cost included), so the logged
/// numbers approximate what a relayer pays on a real chain.
/// "steady" = the operator's TokenStore clone already exists and seller/adjudicator already hold the token;
/// "first" = the very first deal for this rules contract (pays the TokenStore clone deployment).
contract GasPerDealTest is SpikeBase {
    uint256 internal nextId;

    function _deal() internal returns (HoldbackRules.Terms memory t) {
        t = _terms(keccak256(abi.encode("deal", nextId++)));
    }

    function _warmUp() internal {
        HoldbackRules.Terms memory t = _deal();
        _fund(t);
        rules.decide(t, true, _decisionSig(t, true, ADJ_PK));
    }

    function _fundMeasured(HoldbackRules.Terms memory t) internal returns (uint256) {
        bytes memory sig = _signFunding(rules.paymentInfoFor(t), BUYER_PK);
        vm.prank(relayer);
        rules.fund(t, sig);
        return vm.lastCallGas().gasTotalUsed;
    }

    function _log(string memory path, uint256 fundGas, uint256 settleGas) internal pure {
        console.log(path);
        console.log("  fund   ", fundGas);
        console.log("  settle ", settleGas);
        console.log("  total  ", fundGas + settleGas);
    }

    function test_gas_first_accept() public {
        HoldbackRules.Terms memory t = _deal();
        uint256 f = _fundMeasured(t);
        bytes memory sig = _decisionSig(t, true, ADJ_PK);
        rules.decide(t, true, sig);
        _log("first deal, adjudicator accept", f, vm.lastCallGas().gasTotalUsed);
    }

    function test_gas_steady_accept() public {
        _warmUp();
        HoldbackRules.Terms memory t = _deal();
        uint256 f = _fundMeasured(t);
        bytes memory sig = _decisionSig(t, true, ADJ_PK);
        rules.decide(t, true, sig);
        _log("steady, adjudicator accept (happy path)", f, vm.lastCallGas().gasTotalUsed);
    }

    function test_gas_steady_earlyAccept() public {
        _warmUp();
        HoldbackRules.Terms memory t = _deal();
        uint256 f = _fundMeasured(t);
        bytes memory sig = _sign(BUYER_PK, rules.earlyAcceptDigest(rules.hashTerms(t)));
        rules.earlyAccept(t, sig);
        _log("steady, buyer early accept (happy path, no judge)", f, vm.lastCallGas().gasTotalUsed);
    }

    function test_gas_steady_reject() public {
        _warmUp();
        HoldbackRules.Terms memory t = _deal();
        uint256 f = _fundMeasured(t);
        bytes memory sig = _decisionSig(t, false, ADJ_PK);
        rules.decide(t, false, sig);
        _log("steady, adjudicator reject (fee-only capture + void)", f, vm.lastCallGas().gasTotalUsed);
    }

    function test_gas_steady_timeout() public {
        _warmUp();
        HoldbackRules.Terms memory t = _deal();
        uint256 f = _fundMeasured(t);
        vm.warp(t.decideBy);
        rules.timeout(t);
        _log("steady, permissionless timeout (void)", f, vm.lastCallGas().gasTotalUsed);
    }

    function test_gas_steady_reclaim() public {
        _warmUp();
        HoldbackRules.Terms memory t = _deal();
        uint256 f = _fundMeasured(t);
        vm.warp(t.holdExpiry);
        bytes memory piCall = abi.encodeCall(escrow.reclaim, (rules.paymentInfoFor(t)));
        vm.prank(buyer);
        (bool ok,) = address(escrow).call(piCall);
        assertTrue(ok);
        _log("steady, buyer reclaim after expiry (no operator)", f, vm.lastCallGas().gasTotalUsed);
    }
}
