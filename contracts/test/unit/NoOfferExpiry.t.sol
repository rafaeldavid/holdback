// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Vm} from "forge-std/Vm.sol";

import {HoldbackRules} from "../../src/HoldbackRules.sol";
import {HoldbackTypes as H} from "../../src/HoldbackTypes.sol";
import {IDeployedOffers} from "../handlers/RulesHandler.sol";
import {Base} from "./Base.sol";

/// @title SC-6: no on-chain record of an unfunded offer's expiry (T-356, ADR-0031 §7)
/// @notice `expireOffer` and `Stage.Expired` left. Before funding nothing about an offer is on chain, and from
///         `offerExpiresAt` (or `fundBy`) `agreeAndFund` refuses it, so the lapse needs no transaction: the operators
///         mark the offer expired by their own clock. An expired offer cannot be revived: a new date is new terms, a new
///         commitment ID and three new signatures. `reclaim` still emits `JobExpired`.
contract NoOfferExpiryTest is Base {
    /// The refused input: the expiry call the parent took (`test/differential/parent/`; the side-by-side harness
    /// drives the same `IDeployedOffers.expireOffer` on both sides). The phase-one contract has no such function and
    /// no fallback, so the call reverts with empty data and writes nothing.
    function test_expireOffer_isGone() public {
        H.Terms memory t = _terms();
        bytes32 id = hx.id(t);
        vm.warp(t.timing.offerExpiresAt);
        (bool ok, bytes memory ret) = address(rules).call(abi.encodeCall(IDeployedOffers.expireOffer, (t)));
        assertFalse(ok, "expireOffer is not in the phase-one ABI");
        assertEq(ret.length, 0);
        assertEq(uint8(rules.dealOf(id).stage), uint8(HoldbackRules.Stage.None));
    }

    /// An offer past `offerExpiresAt` stays unfunded and cannot fund, with every message correctly signed. Nothing is
    /// stored and no token moves.
    function test_unfundedOffer_pastItsExpiry_cannotFund() public {
        H.Terms memory t = _terms();
        bytes32 id = hx.id(t);
        bytes memory ss = _sellerSig(t, SELLER_PK);
        H.Acceptance memory acc = _acceptance(t, ADJ_PK);
        H.Agree memory ag = _agree(t, BUYER_PK);
        H.Funding memory f = _erc3009(t, BUYER_PK);
        uint256 before = usdc.balanceOf(buyer);

        vm.warp(t.timing.offerExpiresAt);
        vm.expectRevert(HoldbackRules.DeadlinePassed.selector);
        rules.agreeAndFund(t, ss, acc, ag, f);
        assertEq(uint8(rules.dealOf(id).stage), uint8(HoldbackRules.Stage.None));
        assertEq(usdc.balanceOf(buyer), before);
    }

    /// Every timeout on an unfunded offer finds no deal: `WrongStage(None)`, long after its expiry.
    function test_timeouts_onAnUnfundedOffer_findNoDeal() public {
        H.Terms memory t = _terms();
        vm.warp(t.timing.fallbackBy + t.timing.appealDecideSec + MARGIN);
        bytes memory none = abi.encodeWithSelector(HoldbackRules.WrongStage.selector, HoldbackRules.Stage.None);
        vm.expectRevert(none);
        rules.reclaim(t);
        vm.expectRevert(none);
        rules.triggerFallback(t);
        vm.expectRevert(none);
        rules.triggerDefault(t);
    }

    /// `JobExpired` stays: `reclaim` emits it for a funded deal with no delivery by `deliverBy`.
    function test_jobExpired_isStillEmittedByReclaim() public {
        (H.Terms memory t, bytes32 id) = _funded();
        vm.warp(t.timing.deliverBy);
        vm.recordLogs();
        rules.reclaim(t);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 seen;
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].emitter == address(rules) && logs[i].topics[0] == HoldbackRules.JobExpired.selector) {
                assertEq(logs[i].topics[1], id);
                seen++;
            }
        }
        assertEq(seen, 1);
    }
}
