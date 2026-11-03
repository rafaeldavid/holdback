// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {HoldbackRules} from "../../src/HoldbackRules.sol";
import {HoldbackTypes as H} from "../../src/HoldbackTypes.sol";
import {Base} from "./Base.sol";

/// T-212 item 3 (T-206 L-1 and the cross-family pass, review §8): a seller who signs two attempt-1 deliveries can pair
/// a signature about one with the other. These tests are the attacks as they stand before ADR-0029: each one succeeds,
/// and the chain then names a delivery nobody judged or opened.
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
            submittedAt: uint64(block.timestamp)
        });
    }

    function _early(H.Terms memory t, bytes32 id) internal view returns (H.EarlyAccept memory m) {
        m = H.EarlyAccept({attempt: 1, nonce: keccak256("early"), expiresAt: type(uint64).max, signature: ""});
        m.signature = _sign(BUYER_PK, hx.early(id, t.buyer, m));
    }

    /// The primary judged D1; a relayer carries D2 with its accept. The chain records D2 as the delivery paid for.
    function test_attack_carriedDecisionSettlesAnotherSignedDelivery() public {
        (H.Terms memory t, bytes32 id) = _funded();
        H.Decision memory m = _primary(t, id, H.OUTCOME_ACCEPT); // about D1
        (H.Delivery memory d2,) = _other();
        bytes memory sig2 = _deliverySig(id, d2, SELLER_PK);
        vm.expectEmit(true, true, false, true, address(rules));
        emit JobSubmitted(id, seller, hx.delivery(id, d2));
        rules.decide(t, m, d2, sig2);
        assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.Released));
    }

    /// D1 is posted; the buyer opened D1 and signed its early accept. Relayed with D2 and D2's key proof, it pays and
    /// releases D2's envelope, which the buyer never opened.
    function test_attack_earlyAcceptPairedWithAnotherSignedDelivery() public {
        (H.Terms memory t, bytes32 id) = _funded();
        _deliver(t, id); // D1
        H.EarlyAccept memory m = _early(t, id);
        (H.Delivery memory d2, H.KeyProof memory k2) = _other();
        bytes memory sig2 = _deliverySig(id, d2, SELLER_PK);
        vm.expectEmit(true, true, false, true, address(rules));
        emit KeyReleased(id, buyer, 1, KEY_SCHEME, "envelope-for-another-body");
        rules.earlyAccept(t, m, d2, sig2, k2);
        assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.Released));
    }

    /// D1 is posted; a mutual settlement naming D2 settles, though core refuses it (`state.ts`: "deliveryHash does not
    /// name the current delivery").
    function test_attack_mutualNamesADeliveryOtherThanThePosted() public {
        (H.Terms memory t, bytes32 id) = _funded();
        _deliver(t, id); // D1
        (H.Delivery memory d2,) = _other();
        H.Mutual memory m;
        m.hasDelivery = true;
        m.deliveryHash = hx.delivery(id, d2);
        m.payouts = new H.Payout[](1);
        m.payouts[0] = H.Payout(seller, PRICE);
        m.nonce = keccak256("mutual");
        m.expiresAt = type(uint64).max;
        bytes32 h = hx.mutual(id, t.token, m);
        m.buyerSignature = _sign(BUYER_PK, h);
        m.sellerSignature = _sign(SELLER_PK, h);
        H.KeyProof memory none;
        rules.mutualSettle(t, m, _noDelivery(), none);
        assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.Settled));
    }
}
