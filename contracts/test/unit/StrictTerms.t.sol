// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AuthCaptureEscrow} from "commerce-payments/AuthCaptureEscrow.sol";

import {HoldbackRules} from "../../src/HoldbackRules.sol";
import {HoldbackTypes as H} from "../../src/HoldbackTypes.sol";
import {Base} from "./Base.sol";

/// @title SC-5: refuse terms settlement cannot process (T-356, ADR-0031 §6)
/// @notice `agreeAndFund` refuses, with `InvalidMessage` and before any signature is checked:
///         - deadlines not in strict order, `offerExpiresAt < fundBy < deliverBy < judgeBy < fallbackBy`, compared
///           exactly as `packages/core/src/timing.ts` compares them (an equal pair is refused: no step's window may be
///           zero);
///         - `maxSubmissions` other than 1 (the contract takes one delivery);
///         - an escalation decision window (`appealDecideSec`) of 0, which the schema already forbids.
///         Every refused input was funded by the parent (`test/differential/parent/`). A zero price is not refused
///         (Rafa, 2026-11-11); a deal that holds nothing (price 0 and fee 0) is refused by the escrow itself
///         (`test_zeroPriceZeroFee_escrowRefusesZeroAmount` below; on `main`, `ZeroPrice.t.sol`). `appealWindowSec` is not
///         checked: whether phase one requires it to be 0 is open with Rafa.
contract StrictTermsTest is Base {
    /// Relays `agreeAndFund` for `t` with every message correctly signed for it; returns the outcome.
    function _fundCall(H.Terms memory t) internal returns (bool ok, bytes memory ret) {
        bytes memory data = abi.encodeCall(
            HoldbackRules.agreeAndFund,
            (t, _sellerSig(t, SELLER_PK), _acceptance(t, ADJ_PK), _agree(t, BUYER_PK), _erc3009(t, BUYER_PK))
        );
        vm.prank(relayer);
        (ok, ret) = address(rules).call(data);
    }

    /// The refusal: `InvalidMessage`, nothing stored, no token moved.
    function _refused(H.Terms memory t) internal {
        uint256 b0 = usdc.balanceOf(buyer);
        (bool ok, bytes memory ret) = _fundCall(t);
        assertFalse(ok, "funded");
        assertEq(ret, abi.encodeWithSelector(HoldbackRules.InvalidMessage.selector));
        assertEq(uint8(rules.dealOf(hx.id(t)).stage), uint8(HoldbackRules.Stage.None), "nothing stored");
        assertEq(usdc.balanceOf(buyer), b0, "no token moved");
    }

    function _funds(H.Terms memory t) internal {
        (bool ok,) = _fundCall(t);
        assertTrue(ok, "refused");
        assertEq(uint8(rules.dealOf(hx.id(t)).stage), uint8(HoldbackRules.Stage.Held));
    }

    // ------------------------------------------------------------ deadlines in strict order

    function test_equal_offerExpiresAt_fundBy_refused() public {
        H.Terms memory t = _terms();
        t.timing.fundBy = t.timing.offerExpiresAt;
        _refused(t);
    }

    function test_equal_fundBy_deliverBy_refused() public {
        H.Terms memory t = _terms();
        t.timing.deliverBy = t.timing.fundBy;
        _refused(t);
    }

    function test_equal_deliverBy_judgeBy_refused() public {
        H.Terms memory t = _terms();
        t.timing.judgeBy = t.timing.deliverBy;
        _refused(t);
    }

    function test_equal_judgeBy_fallbackBy_refused() public {
        H.Terms memory t = _terms();
        t.timing.fallbackBy = t.timing.judgeBy;
        _refused(t);
    }

    /// The cases ADR-0031 §6 names: the escrow's expiry before the delivery deadline (fallbackBy far before
    /// deliverBy), a delivery deadline after judgeBy, fundBy before offerExpiresAt.
    function test_reversed_pairs_refused() public {
        H.Terms memory a = _terms();
        a.timing.fallbackBy = a.timing.fundBy + 1;
        _refused(a);
        H.Terms memory b = _terms();
        b.timing.deliverBy = b.timing.judgeBy + 1;
        _refused(b);
        H.Terms memory c = _terms();
        c.timing.offerExpiresAt = c.timing.fundBy + 1;
        _refused(c);
    }

    /// Any order: the refusal holds for every pair, fuzzed. Terms whose five deadlines are strictly ordered fund.
    function testFuzz_order(uint64 a, uint64 b, uint64 c, uint64 d, uint64 e) public {
        uint64 now_ = uint64(block.timestamp);
        H.Terms memory t = _terms();
        t.timing.offerExpiresAt = now_ + 1 + a % 30 days;
        t.timing.fundBy = now_ + 1 + b % 30 days;
        t.timing.deliverBy = now_ + 1 + c % 30 days;
        t.timing.judgeBy = now_ + 1 + d % 30 days;
        t.timing.fallbackBy = now_ + 1 + e % 30 days;
        H.Timing memory m = t.timing;
        bool strict = m.offerExpiresAt < m.fundBy && m.fundBy < m.deliverBy && m.deliverBy < m.judgeBy
            && m.judgeBy < m.fallbackBy;
        if (strict) _funds(t);
        else _refused(t);
    }

    /// The tightest strict order, one second apart, funds: the rule refuses only equal or reversed pairs (D31).
    function test_oneSecondApart_funds() public {
        H.Terms memory t = _terms();
        uint64 at = t.timing.offerExpiresAt;
        (t.timing.fundBy, t.timing.deliverBy, t.timing.judgeBy, t.timing.fallbackBy) = (at + 1, at + 2, at + 3, at + 4);
        _funds(t);
    }

    // ------------------------------------------------------------ one delivery attempt

    function test_maxSubmissions_otherThanOne_refused() public {
        uint8[4] memory bad = [0, 2, 3, 255];
        for (uint256 i; i < bad.length; i++) {
            H.Terms memory t = _terms();
            t.timing.maxSubmissions = bad[i];
            _refused(t);
        }
    }

    // ------------------------------------------------------------ an escalation window of at least a second

    function test_appealDecideSec_zero_refused() public {
        H.Terms memory t = _terms();
        t.timing.appealDecideSec = 0;
        _refused(t);
    }

    function test_appealDecideSec_one_funds() public {
        H.Terms memory t = _terms();
        t.timing.appealDecideSec = 1;
        _funds(t);
    }

    /// `appealWindowSec` is signed and not read: 0 still funds (no check added, removed or changed; open with Rafa).
    function test_appealWindowSec_isNotChecked() public {
        H.Terms memory t = _terms();
        t.timing.appealWindowSec = 0;
        _funds(t);
    }

    // ------------------------------------------------------------ what is not refused

    /// A zero price with a fee above 0 funds (Rafa, 2026-11-11).
    function test_zeroPrice_withFee_funds() public {
        H.Terms memory t = _terms();
        t.price = 0;
        _funds(t);
    }

    /// The deal that holds nothing (price 0 and fee 0) is not one of SC-5's refusals: the rules contract lets it
    /// through, and the escrow refuses to hold 0 with its own `ZeroAmount`. Pinned here on the lane (as on `main` in
    /// `ZeroPrice.t.sol`, T-345); core and the operator's prepare routes refuse it off chain with that reason.
    function test_zeroPriceZeroFee_escrowRefusesZeroAmount() public {
        H.Terms memory t = _terms();
        (t.price, t.fee) = (0, 0);
        (bool ok, bytes memory ret) = _fundCall(t);
        assertFalse(ok);
        assertEq(ret, abi.encodeWithSelector(AuthCaptureEscrow.ZeroAmount.selector));
        assertEq(uint8(rules.dealOf(hx.id(t)).stage), uint8(HoldbackRules.Stage.None));
    }

    /// The refusal comes before the signature checks: wrong-key terms out of order answer `InvalidMessage`.
    function test_refusedBeforeSignatures() public {
        H.Terms memory t = _terms();
        t.timing.fundBy = t.timing.offerExpiresAt;
        bytes memory wrong = _sellerSig(t, OTHER_PK);
        H.Acceptance memory acc = _acceptance(t, ADJ_PK);
        H.Agree memory ag = _agree(t, BUYER_PK);
        H.Funding memory f = _erc3009(t, BUYER_PK);
        vm.expectRevert(HoldbackRules.InvalidMessage.selector);
        rules.agreeAndFund(t, wrong, acc, ag, f);
    }
}
