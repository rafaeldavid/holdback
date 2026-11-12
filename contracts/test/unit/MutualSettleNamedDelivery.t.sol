// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {HoldbackRules} from "../../src/HoldbackRules.sol";
import {HoldbackTypes as H} from "../../src/HoldbackTypes.sol";
import {Base} from "./Base.sol";

/// T-357, ADR-0031 SC-5b: in Held a settlement both parties sign may name a delivery nobody posted and release its key
/// (`mutualSettle`, :379-387). The key released is the buyer's envelope in the delivery the settlement names, and only
/// that one: a settlement that names one delivery cannot release another's key.
contract MutualSettleNamedDeliveryTest is Base {
    event KeyReleased(bytes32 indexed id, address indexed recipient, uint8 path, string scheme, string ciphertext);
    event MutuallySettled(bytes32 indexed id, bool keyReleased);

    /// A second seller-signed delivery of the same deal: other bytes, and a buyer envelope with another ciphertext.
    function _otherDelivery() internal view returns (H.Delivery memory d, H.KeyProof memory k) {
        k = _buyerKey();
        k.ciphertext = "other-buyer-envelope";
        k.keyHashes[1] = hx.key(buyer, k);
        d = H.Delivery({
            attempt: 1,
            ciphertextHash: keccak256("other ciphertext"),
            plaintextSha256Hash: keccak256("sha256:other"),
            plaintextMimeHash: keccak256("text/csv"),
            encryptedKeysHash: keccak256(abi.encodePacked(k.keyHashes)),
            submittedAt: 1_790_000_000
        });
    }

    /// A settlement both parties signed that names `named` and releases its key: 70% to the seller, the rest to the buyer.
    function _settlement(H.Terms memory t, bytes32 id, bytes32 named) internal view returns (H.Mutual memory mu) {
        mu.hasDelivery = true;
        mu.deliveryHash = named;
        mu.releaseKey = true;
        mu.payouts = new H.Payout[](2);
        mu.payouts[0] = H.Payout(seller, (t.price * 7) / 10);
        mu.payouts[1] = H.Payout(buyer, t.price - (t.price * 7) / 10);
        mu.nonce = keccak256("late work");
        mu.expiresAt = type(uint64).max;
        bytes32 h = hx.mutual(id, t.token, mu);
        mu.buyerSignature = _sign(BUYER_PK, h);
        mu.sellerSignature = _sign(SELLER_PK, h);
    }

    function test_lateSettlement_releasesTheKeyOfTheDeliveryItNames() public {
        (H.Terms memory t, bytes32 id) = _funded();
        (H.Delivery memory a, H.KeyProof memory ka) = _delivery();
        H.Mutual memory mu = _settlement(t, id, hx.delivery(id, a));
        vm.warp(t.timing.deliverBy + 60);
        uint256 s0 = usdc.balanceOf(seller);
        vm.expectEmit(true, false, false, true, address(rules));
        emit MutuallySettled(id, true);
        vm.expectEmit(true, true, false, true, address(rules));
        emit KeyReleased(id, buyer, rules.KEY_MUTUAL(), ka.scheme, "buyer-envelope");
        rules.mutualSettle(t, mu, a, ka);
        assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.Settled));
        assertEq(usdc.balanceOf(seller), s0 + (t.price * 7) / 10, "the seller's share");
        assertEq(rules.deliveryHashOf(id), bytes32(0), "nothing was posted: the settlement names the delivery, the contract stores none");
    }

    /// Named A, carried B with B's own proof: B is not the delivery both signed.
    function test_namingOneDelivery_cannotReleaseAnothersKey_carriedDelivery() public {
        (H.Terms memory t, bytes32 id) = _funded();
        (H.Delivery memory a,) = _delivery();
        (H.Delivery memory b, H.KeyProof memory kb) = _otherDelivery();
        H.Mutual memory mu = _settlement(t, id, hx.delivery(id, a));
        vm.warp(t.timing.deliverBy + 60);
        vm.expectRevert(HoldbackRules.BadKeyProof.selector);
        rules.mutualSettle(t, mu, b, kb);
        assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.Held), "nothing moved");
    }

    /// Named and carried A, with B's envelope and key list: the proof is not against A's key list.
    function test_namingOneDelivery_cannotReleaseAnothersKey_keyProof() public {
        (H.Terms memory t, bytes32 id) = _funded();
        (H.Delivery memory a,) = _delivery();
        (, H.KeyProof memory kb) = _otherDelivery();
        H.Mutual memory mu = _settlement(t, id, hx.delivery(id, a));
        vm.warp(t.timing.deliverBy + 60);
        vm.expectRevert(HoldbackRules.BadKeyProof.selector);
        rules.mutualSettle(t, mu, a, kb);
    }

    /// Named and carried A, with A's key list but B's buyer envelope swapped in at the buyer's index.
    function test_namingOneDelivery_cannotReleaseAnothersKey_swappedEnvelope() public {
        (H.Terms memory t, bytes32 id) = _funded();
        (H.Delivery memory a, H.KeyProof memory ka) = _delivery();
        H.Mutual memory mu = _settlement(t, id, hx.delivery(id, a));
        ka.ciphertext = "other-buyer-envelope";
        vm.warp(t.timing.deliverBy + 60);
        vm.expectRevert(HoldbackRules.BadKeyProof.selector);
        rules.mutualSettle(t, mu, a, ka);
    }

    /// The proof points at another recipient's envelope in A: only the buyer's is released.
    function test_namedDelivery_releasesOnlyTheBuyersEnvelope() public {
        (H.Terms memory t, bytes32 id) = _funded();
        (H.Delivery memory a, H.KeyProof memory ka) = _delivery();
        H.Mutual memory mu = _settlement(t, id, hx.delivery(id, a));
        ka.index = 0; // the primary's envelope
        vm.expectRevert(HoldbackRules.BadKeyProof.selector);
        rules.mutualSettle(t, mu, a, ka);
    }

    /// After a delivery is posted, a settlement names the posted one (:374): an unposted delivery cannot stand in.
    function test_afterAPostedDelivery_anUnpostedOneCannotBeNamed() public {
        (H.Terms memory t, bytes32 id) = _funded();
        _deliver(t, id);
        (H.Delivery memory b, H.KeyProof memory kb) = _otherDelivery();
        H.Mutual memory mu = _settlement(t, id, hx.delivery(id, b));
        vm.expectRevert(HoldbackRules.InvalidMessage.selector);
        rules.mutualSettle(t, mu, b, kb);
    }

    /// One party's signature for both releases nothing: the seller's signature on the named hash is what endorses it.
    function test_lateSettlement_needsBothSignatures() public {
        (H.Terms memory t, bytes32 id) = _funded();
        (H.Delivery memory a, H.KeyProof memory ka) = _delivery();
        H.Mutual memory mu = _settlement(t, id, hx.delivery(id, a));
        mu.sellerSignature = mu.buyerSignature;
        vm.expectRevert(HoldbackRules.BadSignature.selector);
        rules.mutualSettle(t, mu, a, ka);
    }
}
