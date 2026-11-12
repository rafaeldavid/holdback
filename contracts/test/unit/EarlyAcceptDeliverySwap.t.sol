// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {HoldbackRules} from "../../src/HoldbackRules.sol";
import {HoldbackTypes as H} from "../../src/HoldbackTypes.sol";
import {Base} from "./Base.sol";

/// T-335: the T-206 adversarial pass's EarlyAcceptDeliverySwap tests (2026-11-03, against baac930), ported to HEAD.
/// Finding L-1 (record integrity, D26): at baac930 `EarlyAccept` bound the attempt only, so a relayer could pair the
/// buyer's one signature with any seller-signed attempt-1 delivery, and `JobSubmitted` and `KeyReleased` named a
/// delivery the buyer never saw. Fixed in PR #161 (ADR-0029): the early accept names the delivery hash, the contract
/// stores the posted one, and both must match the carried delivery. The two attacks are regressions now.
contract EarlyAcceptDeliverySwapTest is Base {
    event KeyReleased(bytes32 indexed id, address indexed recipient, uint8 path, string scheme, string ciphertext);

    /// A second seller-signed attempt-1 delivery with other content and another buyer envelope.
    function _otherDelivery() internal view returns (H.Delivery memory d, H.KeyProof memory k) {
        k = _buyerKey();
        k.ciphertext = "an envelope the buyer never opened";
        k.keyHashes[1] = hx.key(buyer, k);
        d = H.Delivery({
            attempt: 1,
            ciphertextHash: keccak256("other ciphertext"),
            plaintextSha256Hash: keccak256("sha256:other"),
            plaintextMimeHash: keccak256("text/csv"),
            encryptedKeysHash: keccak256(abi.encodePacked(k.keyHashes)),
            submittedAt: uint64(block.timestamp)
        });
    }

    /// L-1, fixed in PR #161. Was test_attack_early_accept_paired_with_another_signed_delivery_after_onchain_deliver:
    /// delivery A is on chain and the buyer accepted A; the relayer carried B and B's envelope was released. Now the
    /// swap is refused, and the buyer's accept settles only with A.
    function test_regression_early_accept_paired_with_another_signed_delivery_after_onchain_deliver() public {
        (H.Terms memory t, bytes32 id) = _funded();
        (H.Delivery memory a, H.KeyProof memory ka) = _deliver(t, id); // A is the delivery on chain
        (H.Delivery memory b, H.KeyProof memory kb) = _otherDelivery();
        assertTrue(hx.delivery(id, a) != hx.delivery(id, b));
        H.EarlyAccept memory m = _early(t, id, BUYER_PK); // names A, the posted delivery
        bytes memory sigB = _deliverySig(id, b, SELLER_PK);
        vm.expectRevert(HoldbackRules.InvalidMessage.selector);
        rules.earlyAccept(t, m, b, sigB, kb);
        assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.Delivered), "nothing settled");

        vm.expectEmit(true, true, false, true, address(rules));
        emit KeyReleased(id, buyer, 1, KEY_SCHEME, ka.ciphertext);
        rules.earlyAccept(t, m, a, "", ka);
        assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.Released));
    }

    /// L-1, fixed in PR #161. Was test_attack_early_accept_in_held_records_a_delivery_the_buyer_never_saw: in `Held`
    /// the relayer carried B with the buyer's accept, and `JobSubmitted` recorded B. Now the call reverts whole and
    /// no delivery is recorded.
    function test_regression_early_accept_in_held_records_a_delivery_the_buyer_never_saw() public {
        (H.Terms memory t, bytes32 id) = _funded();
        (H.Delivery memory b, H.KeyProof memory kb) = _otherDelivery();
        H.EarlyAccept memory m = _early(t, id, BUYER_PK); // names `_delivery()`, the one the buyer opened
        assertTrue(m.deliveryHash != hx.delivery(id, b));
        bytes memory sigB = _deliverySig(id, b, SELLER_PK);
        vm.expectRevert(HoldbackRules.InvalidMessage.selector);
        rules.earlyAccept(t, m, b, sigB, kb);
        assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.Held));
        assertEq(rules.deliveryHashOf(id), bytes32(0), "no delivery recorded");
    }
}
