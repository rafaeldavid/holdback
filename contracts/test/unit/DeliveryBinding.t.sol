// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {HoldbackRules} from "../../src/HoldbackRules.sol";
import {HoldbackTypes as H} from "../../src/HoldbackTypes.sol";
import {Base} from "./Base.sol";

/// T-212 item 3 (T-206 L-1 and the cross-family pass, review §8; ADR-0029): a seller who signs two attempt-1
/// deliveries could pair a signature about one with the other. Every decision, early accept and mutual settlement
/// now names the delivery it settles by hash, and the contract stores the posted delivery's hash. The three
/// `test_attack_*` tests were the attacks (each succeeded before ADR-0029, commit cc424bd) and now pin the refusal.
contract DeliveryBindingTest is Base {
    event JobSubmitted(bytes32 indexed jobId, address indexed provider, bytes32 deliverable);
    event KeyReleased(bytes32 indexed id, address indexed recipient, uint8 path, string scheme, string ciphertext);

    /// A second seller-signed attempt-1 delivery: another body, with its own envelope for the buyer.
    function _other() internal view returns (H.Delivery memory d, H.KeyProof memory k) {
        k = _buyerKey();
        k.ciphertext = "envelope-for-another-body";
        k.keyHashes[1] = hx.key(buyer, k);
        d = H.Delivery({
            attempt: 1,
            ciphertextHash: keccak256("another ciphertext"),
            plaintextSha256Hash: keccak256("sha256:another"),
            plaintextMimeHash: keccak256("text/csv"),
            encryptedKeysHash: keccak256(abi.encodePacked(k.keyHashes)),
            submittedAt: 1_790_000_000
        });
    }

    function _otherHash(bytes32 id) internal view returns (bytes32) {
        (H.Delivery memory d2,) = _other();
        return hx.delivery(id, d2);
    }

    /// The early accept for a named delivery.
    function _earlyFor(H.Terms memory t, bytes32 id, bytes32 dh) internal view returns (H.EarlyAccept memory m) {
        m = H.EarlyAccept({attempt: 1, deliveryHash: dh, nonce: keccak256("early"), expiresAt: type(uint64).max, signature: ""});
        m.signature = _sign(BUYER_PK, hx.early(id, t.buyer, m));
    }

    function _primaryNaming(H.Terms memory t, bytes32 id, uint8 outcome, bytes32 dh)
        internal
        view
        returns (H.Decision memory m)
    {
        m = _decision(H.ROLE_PRIMARY, outcome);
        m.deliveryHash = dh;
        m = _signDecision(t, id, m, adjudicator, ADJ_PK);
    }

    function _mutualNaming(H.Terms memory t, bytes32 id, bytes32 dh) internal view returns (H.Mutual memory m) {
        m.hasDelivery = true;
        m.deliveryHash = dh;
        m.payouts = new H.Payout[](1);
        m.payouts[0] = H.Payout(seller, PRICE);
        m.nonce = keccak256("mutual");
        m.expiresAt = type(uint64).max;
        bytes32 h = hx.mutual(id, t.token, m);
        m.buyerSignature = _sign(BUYER_PK, h);
        m.sellerSignature = _sign(SELLER_PK, h);
    }

    // ------------------------------------------------------------ the attacks, refused

    /// The primary judged D1; a relayer carries D2 with its accept. Refused: the decision names D1.
    function test_attack_carriedDecisionSettlesAnotherSignedDelivery() public {
        (H.Terms memory t, bytes32 id) = _funded();
        H.Decision memory m = _primary(t, id, H.OUTCOME_ACCEPT); // names D1, the carried default
        (H.Delivery memory d2,) = _other();
        bytes memory sig2 = _deliverySig(id, d2, SELLER_PK);
        vm.expectRevert(HoldbackRules.InvalidMessage.selector);
        rules.decide(t, m, d2, sig2);
    }

    /// D1 is posted; the primary was handed D2 and decides about it. Refused: the decision names D2.
    function test_attack_decideSettlesAgainstAnotherSignedDelivery() public {
        (H.Terms memory t, bytes32 id) = _funded();
        _deliver(t, id); // D1
        H.Decision memory m = _primaryNaming(t, id, H.OUTCOME_ACCEPT, _otherHash(id));
        vm.expectRevert(HoldbackRules.InvalidMessage.selector);
        rules.decide(t, m, _noDelivery(), "");
    }

    /// D1 is posted; the buyer opened D1 and named it. Relayed with D2 and D2's key proof: refused. Relayed with D1:
    /// paid, and the envelope released is D1's.
    function test_attack_earlyAcceptPairedWithAnotherSignedDelivery() public {
        (H.Terms memory t, bytes32 id) = _funded();
        (H.Delivery memory d1, H.KeyProof memory k1) = _deliver(t, id);
        H.EarlyAccept memory m = _earlyFor(t, id, hx.delivery(id, d1));
        (H.Delivery memory d2, H.KeyProof memory k2) = _other();
        bytes memory sig2 = _deliverySig(id, d2, SELLER_PK);
        vm.expectRevert(HoldbackRules.InvalidMessage.selector);
        rules.earlyAccept(t, m, d2, sig2, k2);

        vm.expectEmit(true, true, false, true, address(rules));
        emit KeyReleased(id, buyer, 1, KEY_SCHEME, "buyer-envelope");
        rules.earlyAccept(t, m, d1, "", k1);
        assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.Released));
    }

    /// D1 is posted; a mutual settlement naming D2 is refused, as core refuses it (state.ts).
    function test_attack_mutualNamesADeliveryOtherThanThePosted() public {
        (H.Terms memory t, bytes32 id) = _funded();
        _deliver(t, id); // D1
        H.Mutual memory m = _mutualNaming(t, id, _otherHash(id));
        H.KeyProof memory none;
        vm.expectRevert(HoldbackRules.InvalidMessage.selector);
        rules.mutualSettle(t, m, _noDelivery(), none);
    }

    // ------------------------------------------------------------ Held: the carried delivery is the named one

    function test_held_carriedDeliveryMustMatchTheNamedHash_accept() public {
        _heldCarry(H.OUTCOME_ACCEPT);
    }

    function test_held_carriedDeliveryMustMatchTheNamedHash_reject() public {
        _heldCarry(H.OUTCOME_REJECT);
    }

    function test_held_carriedDeliveryMustMatchTheNamedHash_escalate() public {
        _heldCarry(H.OUTCOME_ESCALATE);
    }

    /// A decision naming D2 carried with D1 is refused; naming D1 with D1 lands D1 and settles.
    function _heldCarry(uint8 outcome) internal {
        (H.Terms memory t, bytes32 id) = _funded();
        (H.Delivery memory d1,) = _delivery();
        bytes memory sig1 = _deliverySig(id, d1, SELLER_PK);
        H.Decision memory wrong = _primaryNaming(t, id, outcome, _otherHash(id));
        vm.expectRevert(HoldbackRules.InvalidMessage.selector);
        rules.decide(t, wrong, d1, sig1);

        H.Decision memory right = _primaryNaming(t, id, outcome, hx.delivery(id, d1));
        vm.expectEmit(true, true, false, true, address(rules));
        emit JobSubmitted(id, seller, hx.delivery(id, d1));
        rules.decide(t, right, d1, sig1);
        assertEq(rules.deliveryHashOf(id), hx.delivery(id, d1));
        assertTrue(_stage(id) != HoldbackRules.Stage.Held);
    }

    function test_held_carriedDeliveryMustMatchTheNamedHash_earlyAccept() public {
        (H.Terms memory t, bytes32 id) = _funded();
        (H.Delivery memory d1, H.KeyProof memory k1) = _delivery();
        bytes memory sig1 = _deliverySig(id, d1, SELLER_PK);
        H.EarlyAccept memory wrong = _earlyFor(t, id, _otherHash(id));
        vm.expectRevert(HoldbackRules.InvalidMessage.selector);
        rules.earlyAccept(t, wrong, d1, sig1, k1);

        rules.earlyAccept(t, _earlyFor(t, id, hx.delivery(id, d1)), d1, sig1, k1);
        assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.Released));
        assertEq(rules.deliveryHashOf(id), hx.delivery(id, d1));
    }

    /// In Held the carried delivery must still be the seller's: the hash check does not replace the signature.
    function test_held_carriedDeliveryStillNeedsTheSellersSignature() public {
        (H.Terms memory t, bytes32 id) = _funded();
        (H.Delivery memory d1, H.KeyProof memory k1) = _delivery();
        bytes memory forged = _deliverySig(id, d1, OTHER_PK);
        H.EarlyAccept memory m = _earlyFor(t, id, hx.delivery(id, d1));
        vm.expectRevert(HoldbackRules.BadSignature.selector);
        rules.earlyAccept(t, m, d1, forged, k1);
    }

    /// After `deliver`, an early accept carries the posted delivery; its seller signature was checked when it landed
    /// and is not read again (one ecrecover less).
    function test_delivered_earlyAcceptDoesNotReReadTheSellerSignature() public {
        (H.Terms memory t, bytes32 id) = _funded();
        (H.Delivery memory d1, H.KeyProof memory k1) = _deliver(t, id);
        rules.earlyAccept(t, _earlyFor(t, id, hx.delivery(id, d1)), d1, "", k1);
        assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.Released));
    }

    // ------------------------------------------------------------ every role names the posted delivery

    function _escalated() internal returns (H.Terms memory t, bytes32 id, uint64 round) {
        (t, id) = _funded();
        _deliver(t, id);
        rules.decide(t, _primary(t, id, H.OUTCOME_ESCALATE), _noDelivery(), "");
        round = uint64(rules.dealOf(id).t1) + 1;
        vm.warp(round);
    }

    /// A beacon-seeded decision for `role`, naming `dh` (zero: the posted delivery).
    function _beaconNaming(H.Terms memory t, bytes32 id, uint8 role, uint64 round, bytes32 dh)
        internal
        view
        returns (H.Decision memory m)
    {
        m = _beaconDecision(id, role, H.OUTCOME_REJECT, round);
        m.deliveryHash = dh;
        (address who, uint256 pk) = role == H.ROLE_FALLBACK ? (fallbackAdj, FB_PK) : (appealAdj, AP_PK);
        m = _signDecision(t, id, m, who, pk);
    }

    function test_everyRoleNamesThePostedDelivery_fallback() public {
        (H.Terms memory t, bytes32 id) = _funded();
        _deliver(t, id);
        vm.warp(t.timing.judgeBy);
        rules.triggerFallback(t);
        H.Decision memory wrong = _beaconNaming(t, id, H.ROLE_FALLBACK, t.timing.judgeBy, _otherHash(id));
        vm.expectRevert(HoldbackRules.InvalidMessage.selector);
        rules.decide(t, wrong, _noDelivery(), "");
        rules.decide(t, _beaconNaming(t, id, H.ROLE_FALLBACK, t.timing.judgeBy, 0), _noDelivery(), "");
        assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.Refunded));
    }

    function test_everyRoleNamesThePostedDelivery_afterEscalation() public {
        (H.Terms memory t, bytes32 id, uint64 round) = _escalated();
        H.Decision memory wrong = _beaconNaming(t, id, H.ROLE_APPEAL, round, _otherHash(id));
        vm.expectRevert(HoldbackRules.InvalidMessage.selector);
        rules.decide(t, wrong, _noDelivery(), "");
        rules.decide(t, _beaconNaming(t, id, H.ROLE_APPEAL, round, 0), _noDelivery(), "");
        assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.Refunded));
    }

    function test_everyRoleNamesThePostedDelivery_primary() public {
        (H.Terms memory t, bytes32 id) = _funded();
        (H.Delivery memory d1,) = _deliver(t, id);
        rules.decide(t, _primaryNaming(t, id, H.OUTCOME_REJECT, hx.delivery(id, d1)), _noDelivery(), "");
        assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.Refunded));
    }

    /// A decision that names no delivery (a zero hash) is refused once one is posted.
    function test_everyRoleNamesThePostedDelivery_zeroHashRefused() public {
        (H.Terms memory t, bytes32 id) = _funded();
        _deliver(t, id);
        H.Decision memory m = _decision(H.ROLE_PRIMARY, H.OUTCOME_ACCEPT);
        m.deliveryHash = bytes32(0);
        m.signature = _sign(ADJ_PK, hx.decision(id, adjudicator, t, m));
        vm.expectRevert(HoldbackRules.InvalidMessage.selector);
        rules.decide(t, m, _noDelivery(), "");
    }

    // ------------------------------------------------------------ mutual settlement parity and the stored hash

    function test_mutual_refusesADeliveryHashOtherThanThePosted() public {
        (H.Terms memory t, bytes32 id) = _funded();
        (H.Delivery memory d1,) = _deliver(t, id);
        vm.warp(t.timing.judgeBy);
        rules.triggerFallback(t);
        H.KeyProof memory none;
        H.Mutual memory wrong = _mutualNaming(t, id, _otherHash(id));
        vm.expectRevert(HoldbackRules.InvalidMessage.selector);
        rules.mutualSettle(t, wrong, _noDelivery(), none);
        rules.mutualSettle(t, _mutualNaming(t, id, hx.delivery(id, d1)), _noDelivery(), none);
        assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.Settled));
    }

    function test_deliveryHashOf_setByDeliverAndByACarriedDelivery() public {
        (H.Terms memory t, bytes32 a) = _funded();
        assertEq(rules.deliveryHashOf(a), bytes32(0), "nothing before a delivery");
        (H.Delivery memory d1,) = _deliver(t, a);
        assertEq(rules.deliveryHashOf(a), hx.delivery(a, d1), "deliver stores it");

        (H.Terms memory u, bytes32 b) = _funded();
        (H.Delivery memory e1,) = _delivery();
        rules.decide(u, _primary(u, b, H.OUTCOME_ACCEPT), e1, _deliverySig(b, e1, SELLER_PK));
        assertEq(rules.deliveryHashOf(b), hx.delivery(b, e1), "a decision carrying the delivery stores it");
    }
}
