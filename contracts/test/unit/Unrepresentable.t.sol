// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {HoldbackRules} from "../../src/HoldbackRules.sol";
import {HoldbackTypes as H} from "../../src/HoldbackTypes.sol";
import {Base} from "./Base.sol";

/// @title The contract refuses what core cannot represent, at core's bounds (T-380, R8 fix 3)
/// @notice `agreeAndFund` refuses with `Unrepresentable`, before any signature is checked, terms that core's encoding
///         cannot state, and only those (D31: parametrize, don't restrict):
///         - a deadline after 9999-12-31T23:59:59Z (253,402,300,799 s): core's timestamps are RFC 3339 with
///           four-digit years. The deadlines are in strict order, so `fallbackBy` bounds them all;
///         - an escalation window (`appealDecideSec`) above 2^32 - 1 s: core's window type (`parse.ts`);
///         - a hold (`price + fee`) above 2^120 - 1: the escrow's `maxAmount` type, refused as before; since T-380 core
///           refuses it too (`state.ts`, the phase-one profile).
///         With the first two, every time the word stores in `t1` fits its 40 bits: `t1` is a block time before
///         `fallbackBy + appealDecideSec` <= 257,697,268,094 < 2^40. Each test sends the value on each side of its bound;
///         the parent funded every refused value here but the hold. `packages/core/src/state.test.ts` shows core refusing
///         the same values at the same bounds.
contract UnrepresentableTest is Base {
    uint64 internal constant LAST_TIMESTAMP = 253_402_300_799;

    function _fundCall(H.Terms memory t) internal returns (bool ok, bytes memory ret) {
        bytes memory data = abi.encodeCall(
            HoldbackRules.agreeAndFund,
            (t, _sellerSig(t, SELLER_PK), _acceptance(t, ADJ_PK), _agree(t, BUYER_PK), _erc3009(t, BUYER_PK))
        );
        vm.prank(relayer);
        (ok, ret) = address(rules).call(data);
    }

    function _refused(H.Terms memory t) internal {
        uint256 b0 = usdc.balanceOf(buyer);
        (bool ok, bytes memory ret) = _fundCall(t);
        assertFalse(ok, "funded");
        assertEq(ret, abi.encodeWithSelector(HoldbackRules.Unrepresentable.selector));
        assertEq(uint8(rules.dealOf(hx.id(t)).stage), uint8(HoldbackRules.Stage.None), "nothing stored");
        assertEq(usdc.balanceOf(buyer), b0, "no token moved");
    }

    function _funds(H.Terms memory t) internal {
        (bool ok, bytes memory ret) = _fundCall(t);
        assertTrue(ok, string(ret));
        assertEq(uint8(rules.dealOf(hx.id(t)).stage), uint8(HoldbackRules.Stage.Held));
    }

    // ------------------------------------------------------------ the year 9999

    function test_fallbackBy_atTheLastSecondOf9999_funds() public {
        H.Terms memory t = _terms();
        t.timing.fallbackBy = LAST_TIMESTAMP;
        _funds(t);
    }

    function test_fallbackBy_after9999_refused() public {
        H.Terms memory t = _terms();
        t.timing.fallbackBy = LAST_TIMESTAMP + 1;
        _refused(t);
    }

    // ------------------------------------------------------------ the escalation window's 32 bits

    function test_appealDecideSec_at32Bits_funds() public {
        H.Terms memory t = _terms();
        t.timing.appealDecideSec = type(uint32).max;
        _funds(t);
    }

    function test_appealDecideSec_above32Bits_refused() public {
        H.Terms memory t = _terms();
        t.timing.appealDecideSec = uint64(type(uint32).max) + 1;
        _refused(t);
    }

    // ------------------------------------------------------------ the hold's 120 bits

    function test_hold_at120Bits_funds() public {
        H.Terms memory t = _terms();
        t.price = uint256(type(uint120).max) - t.fee;
        usdc.mint(buyer, type(uint120).max);
        _funds(t);
    }

    function test_hold_above120Bits_refused() public {
        H.Terms memory t = _terms();
        t.price = uint256(type(uint120).max) - t.fee + 1;
        usdc.mint(buyer, type(uint120).max);
        _refused(t);
    }

    // ------------------------------------------------------------ the word's 40-bit t1

    /// The largest terms both bounds allow: an escalation by the fallback in the last second before fallbackBy, the
    /// latest time the word can store, keeps its value, and the escalation is decided before its deadline.
    function test_t1_atTheLatestEscalation_fitsFortyBits() public {
        H.Terms memory t = _terms();
        (t.timing.fallbackBy, t.timing.appealDecideSec) = (LAST_TIMESTAMP, type(uint32).max);
        assertLt(uint256(t.timing.fallbackBy) + t.timing.appealDecideSec, uint256(1) << 40);
        bytes32 id = _fund(t);
        _deliver(t, id);
        vm.warp(t.timing.judgeBy);
        rules.triggerFallback(t);
        vm.warp(LAST_TIMESTAMP - 1);
        uint64 round = uint64(t.timing.judgeBy); // the sim beacon with Base's margin of 0
        H.Decision memory m = _beaconDecision(id, H.ROLE_FALLBACK, H.OUTCOME_ESCALATE, round);
        m = _signDecision(t, id, m, fallbackAdj, FB_PK);
        rules.decide(t, m, _noDelivery(), "");
        assertEq(rules.dealOf(id).t1, LAST_TIMESTAMP - 1, "t1 wrapped");
        vm.warp(uint256(LAST_TIMESTAMP) + 10);
        uint64 appealRound = LAST_TIMESTAMP; // t1 + 1
        m = _signDecision(t, id, _beaconDecision(id, H.ROLE_APPEAL, H.OUTCOME_REJECT, appealRound), appealAdj, AP_PK);
        rules.decide(t, m, _noDelivery(), "");
        assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.Refunded));
    }
}
