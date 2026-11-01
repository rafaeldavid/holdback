// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {console} from "forge-std/console.sol";
import {HoldbackTypes as H} from "../../src/HoldbackTypes.sol";
import {Base} from "./Base.sol";

/// Gas per deal (D4; ADR-0024 §8 asked T-202 to measure). Run with
/// `forge test --match-contract GasPerDeal --isolate -vv`: --isolate runs each top-level call as its own transaction
/// (21000 intrinsic gas, calldata and cold access included). "Steady" = a warm-up deal already created the
/// operator's TokenStore clone and every recipient already holds the token.
contract GasPerDealTest is Base {
    function setUp() public override {
        super.setUp();
        (H.Terms memory t, bytes32 id) = _funded();
        (H.Delivery memory d,) = _delivery();
        rules.decide(t, _primary(t, id, H.OUTCOME_ACCEPT), d, _deliverySig(id, d, SELLER_PK));
        usdc.mint(address(0x7777), 1);
    }

    function _fundMeasured() internal returns (H.Terms memory t, bytes32 id, uint256 gas) {
        t = _terms();
        bytes memory s = _sellerSig(t, SELLER_PK);
        H.Acceptance memory a = _acceptance(t, ADJ_PK);
        H.Agree memory g = _agree(t, BUYER_PK);
        H.Funding memory f = _erc3009(t, BUYER_PK);
        vm.prank(relayer);
        id = rules.agreeAndFund(t, s, a, g, f);
        gas = vm.lastCallGas().gasTotalUsed;
    }

    function _log(string memory path, uint256 a, uint256 b) internal pure {
        console.log(path);
        console.log("  tx1 agreeAndFund", a);
        console.log("  tx2 settle      ", b);
        console.log("  total           ", a + b);
    }

    function test_gas_happyPath_decisionCarriesDelivery() public {
        (H.Terms memory t, bytes32 id, uint256 f) = _fundMeasured();
        (H.Delivery memory d,) = _delivery();
        bytes memory ds = _deliverySig(id, d, SELLER_PK);
        H.Decision memory m = _primary(t, id, H.OUTCOME_ACCEPT);
        rules.decide(t, m, d, ds);
        _log("happy path: agreeAndFund + decide(accept, delivery carried)", f, vm.lastCallGas().gasTotalUsed);
    }

    function test_gas_deliverOnChain() public {
        (H.Terms memory t, bytes32 id,) = _fundMeasured();
        (H.Delivery memory d,) = _delivery();
        bytes memory ds = _deliverySig(id, d, SELLER_PK);
        rules.deliver(t, d, ds);
        console.log("optional deliver (seller stops a reclaim)", vm.lastCallGas().gasTotalUsed);
        H.Decision memory m = _primary(t, id, H.OUTCOME_ACCEPT);
        rules.decide(t, m, _noDelivery(), "");
        console.log("decide(accept) after an on-chain delivery", vm.lastCallGas().gasTotalUsed);
    }

    function test_gas_reject() public {
        (H.Terms memory t, bytes32 id, uint256 f) = _fundMeasured();
        (H.Delivery memory d,) = _delivery();
        bytes memory ds = _deliverySig(id, d, SELLER_PK);
        H.Decision memory m = _primary(t, id, H.OUTCOME_REJECT);
        rules.decide(t, m, d, ds);
        _log("reject: fee-only capture + void", f, vm.lastCallGas().gasTotalUsed);
    }

    function test_gas_earlyAccept() public {
        (H.Terms memory t, bytes32 id, uint256 f) = _fundMeasured();
        (H.Delivery memory d, H.KeyProof memory k) = _delivery();
        bytes memory ds = _deliverySig(id, d, SELLER_PK);
        H.EarlyAccept memory m = H.EarlyAccept({attempt: 1, nonce: 0, expiresAt: type(uint64).max, signature: ""});
        m.signature = _sign(BUYER_PK, hx.early(id, buyer, m));
        rules.earlyAccept(t, m, d, ds, k);
        _log("early accept (delivery carried, key released)", f, vm.lastCallGas().gasTotalUsed);
    }

    function test_gas_reclaim() public {
        (H.Terms memory t,, uint256 f) = _fundMeasured();
        vm.warp(t.timing.deliverBy);
        rules.reclaim(t);
        _log("reclaim (permissionless, nothing delivered)", f, vm.lastCallGas().gasTotalUsed);
    }

    function test_gas_mutualSettlement() public {
        (H.Terms memory t, bytes32 id, uint256 f) = _fundMeasured();
        H.Mutual memory m;
        m.payouts = new H.Payout[](2);
        m.payouts[0] = H.Payout(seller, PRICE / 2);
        m.payouts[1] = H.Payout(buyer, PRICE - PRICE / 2);
        m.expiresAt = type(uint64).max;
        bytes32 h = hx.mutual(id, t.token, m);
        m.buyerSignature = _sign(BUYER_PK, h);
        m.sellerSignature = _sign(SELLER_PK, h);
        H.KeyProof memory none;
        rules.mutualSettle(t, m, _noDelivery(), none);
        _log("mutual settlement (half each, before delivery)", f, vm.lastCallGas().gasTotalUsed);
    }

    function test_gas_default() public {
        (H.Terms memory t, bytes32 id,) = _fundMeasured();
        (H.Delivery memory d,) = _delivery();
        rules.deliver(t, d, _deliverySig(id, d, SELLER_PK));
        vm.warp(t.timing.judgeBy);
        rules.triggerFallback(t);
        console.log("triggerFallback", vm.lastCallGas().gasTotalUsed);
        vm.warp(t.timing.fallbackBy);
        rules.triggerDefault(t);
        console.log("triggerDefault (default + apply in one call)", vm.lastCallGas().gasTotalUsed);
    }
}
