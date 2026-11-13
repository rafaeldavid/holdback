// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IHoldbackRules} from "../../src/IHoldbackRules.sol";
import {HoldbackTypes as H} from "../../src/HoldbackTypes.sol";
import {Base} from "./Base.sol";

/// @title The checks no test refused before T-352
/// @notice Each test refuses an input that a check in HoldbackRules exists to refuse, where the first mutation run on
///         main (T-352, 2026-11-11, `contracts/scripts/mutate.mjs`) found that dropping or moving the check left every
///         test passing, or where `forge coverage` showed the check's revert never ran. The mutant each test kills is
///         named in its comment; `docs/audit/test-quality.md` has the run. Ported to the phase-one lane for package
///         R10 (T-352): errors through `IHoldbackRules` (T-384), payouts to the money addresses (ADR-0033), and no
///         test of the funding method, which phase one no longer has (SC-2).
contract MutationGapsTest is Base {
    // ------------------------------------------------------------ agreeAndFund: the hold's size
    // M005 and M006, the acceptance's and the agree's expiries, are AgreeAndFundExpiry.t.sol (holdback PR 358).

    /// M020: a hold of exactly 2^120 - 1 base units, CPP's largest, funds (D31: any value the encoding can represent).
    /// Phase one has no bond that the price could outgrow, so the deal is Held and the escrow holds the whole amount.
    function test_agreeAndFund_fundsAHoldAtTheLargestRepresentableAmount() public {
        H.Terms memory t = _terms();
        t.price = uint256(type(uint120).max) - FEE;
        usdc.mint(t.buyerPaymentAddress, t.price + FEE);
        bytes32 id = _fund(t);
        assertEq(uint8(_stage(id)), uint8(IHoldbackRules.Stage.Held));
        assertEq(_held(t), uint256(type(uint120).max));
    }

    /// The other side of M020's boundary: one base unit more is refused as unrepresentable.
    function test_agreeAndFund_refusesAHoldAboveTheLargestRepresentableAmount() public {
        H.Terms memory t = _terms();
        t.price = uint256(type(uint120).max) - FEE + 1;
        bytes memory sellerSig = _sellerSig(t, SELLER_PK);
        H.Acceptance memory acc = _acceptance(t, ADJ_PK);
        H.Agree memory ag = _agree(t, BUYER_PK);
        H.Funding memory f = H.Funding({signature: ""});
        vm.expectRevert(IHoldbackRules.Unrepresentable.selector);
        rules.agreeAndFund(t, sellerSig, acc, ag, f);
    }

    // ------------------------------------------------------------ earlyAccept and mutualSettle: expiry

    /// M139: an early accept at its expiresAt does not settle.
    function test_earlyAccept_refusesAnExpiredMessage() public {
        (H.Terms memory t, bytes32 id) = _funded();
        (H.Delivery memory d, H.KeyProof memory k) = _delivery();
        H.EarlyAccept memory m = _early(t, id, BUYER_PK);
        m.expiresAt = uint64(block.timestamp);
        m.signature = _sign(BUYER_PK, hx.early(id, t.buyer, m));
        bytes memory dsig = _deliverySig(id, d, SELLER_PK);
        vm.expectRevert(IHoldbackRules.MessageExpired.selector);
        rules.earlyAccept(t, m, d, dsig, k);
    }

    /// M083: a mutual settlement at its expiresAt does not settle.
    function test_mutualSettle_refusesAnExpiredMessage() public {
        (H.Terms memory t, bytes32 id) = _funded();
        H.Mutual memory m = _mutual(t, id, _toBuyer(t), false, false, bytes32(0), uint64(block.timestamp));
        H.KeyProof memory none;
        vm.expectRevert(IHoldbackRules.MessageExpired.selector);
        rules.mutualSettle(t, m, _noDelivery(), none);
    }

    // ------------------------------------------------------------ mutualSettle: what a settlement without a delivery may say

    /// A settlement that names no delivery cannot release a key (a revert branch no test reached before T-352).
    function test_mutualSettle_noDelivery_refusesAKeyRelease() public {
        (H.Terms memory t, bytes32 id) = _funded();
        H.Mutual memory m = _mutual(t, id, _toBuyer(t), false, true, bytes32(0), type(uint64).max);
        H.KeyProof memory none;
        vm.expectRevert(IHoldbackRules.InvalidMessage.selector);
        rules.mutualSettle(t, m, _noDelivery(), none);
    }

    /// A settlement that names no delivery cannot carry a delivery hash.
    function test_mutualSettle_noDelivery_refusesADeliveryHash() public {
        (H.Terms memory t, bytes32 id) = _funded();
        H.Mutual memory m = _mutual(t, id, _toBuyer(t), false, false, keccak256("a delivery"), type(uint64).max);
        H.KeyProof memory none;
        vm.expectRevert(IHoldbackRules.InvalidMessage.selector);
        rules.mutualSettle(t, m, _noDelivery(), none);
    }

    /// M088: the released key must come from the delivery the settlement names.
    function test_mutualSettle_refusesAKeyFromAnotherDelivery() public {
        (H.Terms memory t, bytes32 id) = _funded();
        (H.Delivery memory d, H.KeyProof memory k) = _deliver(t, id);
        H.Mutual memory m = _mutual(t, id, _toBuyer(t), true, true, hx.delivery(id, d), type(uint64).max);
        H.Delivery memory other = H.Delivery({
            attempt: d.attempt,
            ciphertextHash: keccak256("another ciphertext"),
            plaintextSha256Hash: d.plaintextSha256Hash,
            plaintextMimeHash: d.plaintextMimeHash,
            encryptedKeysHash: d.encryptedKeysHash,
            submittedAt: d.submittedAt
        });
        vm.expectRevert(IHoldbackRules.BadKeyProof.selector);
        rules.mutualSettle(t, m, other, k);
    }

    /// M074: after `deliver`, an early accept that names and carries another delivery body does not settle, even
    /// signed by the buyer (ADR-0029: the key travels with the posted delivery).
    function test_earlyAccept_afterDelivery_refusesAnotherDeliveryThanThePostedOne() public {
        (H.Terms memory t, bytes32 id) = _funded();
        (H.Delivery memory posted, H.KeyProof memory k) = _deliver(t, id);
        H.Delivery memory other = H.Delivery({
            attempt: posted.attempt,
            ciphertextHash: keccak256("another ciphertext"),
            plaintextSha256Hash: posted.plaintextSha256Hash,
            plaintextMimeHash: posted.plaintextMimeHash,
            encryptedKeysHash: posted.encryptedKeysHash,
            submittedAt: posted.submittedAt
        });
        H.EarlyAccept memory m = _early(t, id, BUYER_PK);
        m.deliveryHash = hx.delivery(id, other);
        m.signature = _sign(BUYER_PK, hx.early(id, t.buyer, m));
        vm.expectRevert(IHoldbackRules.InvalidMessage.selector);
        rules.earlyAccept(t, m, other, "", k);
    }

    /// M128: phase one takes one delivery attempt, `ONLY_ATTEMPT`; a seller-signed delivery with another attempt
    /// number is refused (`forge coverage` at c629d06 showed this revert never ran).
    function test_deliver_refusesAnotherAttemptNumber() public {
        (H.Terms memory t, bytes32 id) = _funded();
        (H.Delivery memory d,) = _delivery();
        d.attempt = 2;
        bytes memory sig = _deliverySig(id, d, SELLER_PK);
        vm.expectRevert(IHoldbackRules.InvalidMessage.selector);
        rules.deliver(t, d, sig);
    }

    // ------------------------------------------------------------ the key proof and the first decision

    /// M134: the proof's key list must be the delivery's: the buyer's own entry matching is not enough.
    function test_earlyAccept_refusesAKeyListThatIsNotTheDeliverys() public {
        (H.Terms memory t, bytes32 id) = _funded();
        (H.Delivery memory d, H.KeyProof memory k) = _delivery();
        H.EarlyAccept memory m = _early(t, id, BUYER_PK);
        bytes memory dsig = _deliverySig(id, d, SELLER_PK);
        k.keyHashes[0] = keccak256("an envelope the delivery does not list");
        vm.expectRevert(IHoldbackRules.BadKeyProof.selector);
        rules.earlyAccept(t, m, d, dsig, k);
    }

    /// M132: a key proof whose index is past the end of its key list is refused with BadKeyProof, not by the array
    /// bound's panic (the R10 run at c629d06 found no test that sent one).
    function test_earlyAccept_refusesAKeyIndexPastTheList() public {
        (H.Terms memory t, bytes32 id) = _funded();
        (H.Delivery memory d, H.KeyProof memory k) = _delivery();
        H.EarlyAccept memory m = _early(t, id, BUYER_PK);
        bytes memory dsig = _deliverySig(id, d, SELLER_PK);
        k.index = k.keyHashes.length;
        vm.expectRevert(IHoldbackRules.BadKeyProof.selector);
        rules.earlyAccept(t, m, d, dsig, k);
    }

    /// M047: a first-instance decision carries no appeal ground.
    function test_firstDecision_refusesAnAppealGround() public {
        (H.Terms memory t, bytes32 id) = _funded();
        _deliver(t, id);
        H.Decision memory m = _decision(H.ROLE_PRIMARY, H.OUTCOME_ACCEPT);
        m.appealGroundHash = keccak256("ground");
        m = _signDecision(t, id, m, adjudicator, ADJ_PK);
        vm.expectRevert(IHoldbackRules.InvalidMessage.selector);
        rules.decide(t, m, _noDelivery(), "");
    }

    // ------------------------------------------------------------ builders

    /// The whole price back to the buyer's payment address (ADR-0033).
    function _toBuyer(H.Terms memory t) internal pure returns (H.Payout[] memory p) {
        p = new H.Payout[](1);
        p[0] = H.Payout(t.buyerPaymentAddress, PRICE);
    }

    function _mutual(
        H.Terms memory t,
        bytes32 id,
        H.Payout[] memory payouts,
        bool hasDelivery,
        bool releaseKey,
        bytes32 dh,
        uint64 expiresAt
    ) internal view returns (H.Mutual memory m) {
        m.hasDelivery = hasDelivery;
        m.deliveryHash = dh;
        m.payouts = payouts;
        m.releaseKey = releaseKey;
        m.nonce = keccak256("mutual");
        m.expiresAt = expiresAt;
        bytes32 h = hx.mutual(id, t.token, m);
        m.buyerSignature = _sign(BUYER_PK, h);
        m.sellerSignature = _sign(SELLER_PK, h);
    }
}
