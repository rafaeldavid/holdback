// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AuthCaptureEscrow} from "commerce-payments/AuthCaptureEscrow.sol";
import {MockERC3009Token} from "commerce-payments-test/mocks/MockERC3009Token.sol";
import {ReentrancyGuardTransient} from "solady/utils/ReentrancyGuardTransient.sol";
import {HoldbackRules} from "../../src/HoldbackRules.sol";
import {HoldbackTypes as H} from "../../src/HoldbackTypes.sol";
import {Base} from "./Base.sol";

/// A token whose transfers call back the recipient (ERC-777 style), to probe reentrancy into the rules contract.
contract HookToken is MockERC3009Token {
    address public hook;

    constructor() MockERC3009Token("Hook", "HOOK", 6) {}

    function setHook(address h) external {
        hook = h;
    }

    function _afterTokenTransfer(address, address to, uint256) internal override {
        if (to == hook && hook != address(0)) Reenterer(hook).onTokens();
    }
}

/// A mutual-settlement payee (needs no signature) that replays a prepared call into the rules contract or CPP while
/// its payout is being transferred.
contract Reenterer {
    address public target;
    bytes public payload;
    bool public called;
    bool public succeeded;
    bytes public revertData;

    function arm(address target_, bytes calldata payload_) external {
        target = target_;
        payload = payload_;
    }

    function onTokens() external {
        called = true;
        (bool ok, bytes memory ret) = target.call(payload);
        succeeded = ok;
        revertData = ret;
    }
}

/// T-322: regression tests for the defenses the T-206 red team found withstood (2026-11-03), ported from the
/// red-team worktree. Each test pins a measured defense; one pins an Info behaviour the parties own (D31, D32).
contract WithstoodTest is Base {
    /// One address in two roles: the primary's signed accept cannot be replayed as the fallback's decision after a
    /// takeover (role is hashed into the Decision; the fallback seed is the beacon's, not the commitment preimage).
    function test_defense_same_address_two_roles_no_cross_role_replay() public {
        H.Terms memory t = _terms();
        t.fallbackAdjudicator = adjudicator;
        bytes32 id = _fund(t);
        _deliver(t, id);
        H.Decision memory primary = _primary(t, id, H.OUTCOME_ACCEPT); // signed, never submitted
        vm.warp(t.timing.judgeBy);
        rules.triggerFallback(t);
        vm.expectRevert(HoldbackRules.InvalidMessage.selector);
        rules.decide(t, primary, _noDelivery(), "");
        // Re-labelled as a fallback decision with the primary's seed: the seed must be the beacon's.
        H.Decision memory relabelled = _decision(H.ROLE_FALLBACK, H.OUTCOME_ACCEPT);
        relabelled = _signDecision(t, id, relabelled, adjudicator, ADJ_PK);
        vm.expectRevert(HoldbackRules.BadSeed.selector);
        rules.decide(t, relabelled, _noDelivery(), "");
        // The honest fallback decision settles.
        H.Decision memory m = _beaconDecision(id, H.ROLE_FALLBACK, H.OUTCOME_ACCEPT, t.timing.judgeBy);
        m = _signDecision(t, id, m, adjudicator, ADJ_PK);
        rules.decide(t, m, _noDelivery(), "");
        assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.Released));
    }

    /// A mutual payout to the zero address reverts the whole settlement (CPP ZeroFeeReceiver): nothing is lost.
    function test_defense_mutual_payout_to_zero_address_reverts() public {
        (H.Terms memory t, bytes32 id) = _funded();
        H.Payout[] memory p = new H.Payout[](2);
        p[0] = H.Payout(address(0), 1);
        p[1] = H.Payout(buyer, PRICE - 1);
        H.Mutual memory m = _mutual(t, id, p);
        H.Delivery memory none;
        H.KeyProof memory k;
        vm.expectRevert(AuthCaptureEscrow.ZeroFeeReceiver.selector);
        rules.mutualSettle(t, m, none, k);
        assertEq(_held(t), PRICE + FEE);
    }

    /// Info, not a defense (D31, D32): the buyer and the seller co-sign a payout to the rules contract itself, the
    /// contract accepts it, and no function can move those tokens again. The parties own that choice, so the contract
    /// stays as it is; this test pins the behaviour so a change to it is deliberate.
    function test_info_mutual_payout_to_rules_strands_tokens() public {
        (H.Terms memory t, bytes32 id) = _funded();
        H.Payout[] memory p = new H.Payout[](1);
        p[0] = H.Payout(address(rules), PRICE);
        H.Mutual memory m = _mutual(t, id, p);
        H.Delivery memory none;
        H.KeyProof memory k;
        rules.mutualSettle(t, m, none, k);
        assertEq(usdc.balanceOf(address(rules)), PRICE, "no function can move these again");
    }

    /// Reentrancy through a hook token: the payee of a mutual settlement re-enters during its payout. The deal is
    /// already Settled (effects before interactions) and CPP's transient guard refuses nested operator calls. Since
    /// SC-1 a deployment serves one token and assumes it has no hook (ADR-0031 §2); this test deploys one for a hook
    /// token anyway, so the ordering defense stays proven if that assumption is ever broken.
    function test_defense_reentrant_payee_cannot_move_funds_again() public {
        HookToken hook = new HookToken();
        Reenterer r = new Reenterer();
        hook.setHook(address(r));
        hook.mint(buyer, 1_000_000_000);
        rules = new HoldbackRules(escrow, address(collector3009), MARGIN, sim, address(hook));

        H.Terms memory t = _terms();
        t.token = address(hook);
        bytes32 id = _fund(t);
        H.Payout[] memory p = new H.Payout[](2);
        p[0] = H.Payout(address(r), 1_000_000);
        p[1] = H.Payout(buyer, PRICE - 1_000_000);
        H.Mutual memory m = _mutual(t, id, p);
        H.Delivery memory none;
        H.KeyProof memory k;

        // 1. Re-enter the rules contract with the same co-signed settlement.
        r.arm(address(rules), abi.encodeCall(HoldbackRules.mutualSettle, (t, m, none, k)));
        rules.mutualSettle(t, m, none, k);
        assertTrue(r.called(), "the hook fired during the payout");
        assertFalse(r.succeeded(), "the nested settlement was refused");
        assertEq(bytes4(r.revertData()), HoldbackRules.WrongStage.selector);
        assertEq(hook.balanceOf(address(r)), 1_000_000, "paid exactly once");
        assertEq(hook.balanceOf(escrow.getTokenStore(address(rules))), 0);

        // 2. Re-enter CPP directly with the operator's PaymentInfo, on a fresh deal: CPP's transient reentrancy
        //    guard refuses before the operator check is even reached.
        H.Terms memory t2 = _terms();
        t2.token = address(hook);
        bytes32 id2 = _fund(t2);
        H.Mutual memory m2 = _mutual(t2, id2, p);
        r.arm(address(escrow), abi.encodeCall(AuthCaptureEscrow.void, (_pi(t2))));
        rules.mutualSettle(t2, m2, none, k);
        assertFalse(r.succeeded());
        assertEq(bytes4(r.revertData()), ReentrancyGuardTransient.Reentrancy.selector);
        assertEq(hook.balanceOf(escrow.getTokenStore(address(rules))), 0);
    }

    /// Cross-deployment replay: every Holdback signature is under a domain that names the verifying contract, so a
    /// full set of messages signed for one rules deployment is refused by a second one, and the buyer's CPP funding
    /// signature is bound to the first operator through the PaymentInfo salt and operator fields.
    function test_defense_cross_deployment_replay_refused() public {
        H.Terms memory t = _terms();
        bytes memory s = _sellerSig(t, SELLER_PK);
        H.Acceptance memory a = _acceptance(t, ADJ_PK);
        H.Agree memory g = _agree(t, BUYER_PK);
        H.Funding memory f = _erc3009(t, BUYER_PK);
        HoldbackRules other =
            new HoldbackRules(escrow, address(collector3009), MARGIN, sim, address(usdc));
        vm.expectRevert(HoldbackRules.BadSignature.selector);
        other.agreeAndFund(t, s, a, g, f);
        // The genuine deployment still accepts the same messages.
        rules.agreeAndFund(t, s, a, g, f);
    }

    /// A zero-address role can never sign: Solady's checker returns false for signer 0, so a deal that names no
    /// fallback (address(0)) goes to the default outcome, never to a decision anyone can forge.
    function test_defense_zero_address_role_cannot_sign() public {
        H.Terms memory t = _terms();
        t.fallbackAdjudicator = address(0);
        bytes32 id = _fund(t);
        _deliver(t, id);
        vm.warp(t.timing.judgeBy);
        rules.triggerFallback(t);
        H.Decision memory m = _beaconDecision(id, H.ROLE_FALLBACK, H.OUTCOME_ACCEPT, t.timing.judgeBy);
        m = _signDecision(t, id, m, address(0), OTHER_PK);
        vm.expectRevert(HoldbackRules.BadSignature.selector);
        rules.decide(t, m, _noDelivery(), "");
        vm.warp(t.timing.fallbackBy);
        rules.triggerDefault(t);
        assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.Refunded));
    }

    function _mutual(H.Terms memory t, bytes32 id, H.Payout[] memory p) internal view returns (H.Mutual memory m) {
        m.payouts = p;
        m.expiresAt = type(uint64).max;
        bytes32 h = hx.mutual(id, t.token, m);
        m.buyerSignature = _sign(BUYER_PK, h);
        m.sellerSignature = _sign(SELLER_PK, h);
    }
}
