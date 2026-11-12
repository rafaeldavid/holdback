// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Vm} from "forge-std/Vm.sol";

import {HoldbackRules} from "../../src/HoldbackRules.sol";
import {IHoldbackRules} from "../../src/IHoldbackRules.sol";
import {HoldbackTypes as H} from "../../src/HoldbackTypes.sol";
import {Base} from "./Base.sol";

/// T-346 (ADR-0031 §6b, SC-5b kept): the settlement for late work releases the key of the delivery it names, and
/// of no other. In Held, from deliverBy, both parties may settle and release the buyer's envelope in the same
/// transaction (`mutualSettle`, `HoldbackRules.sol`, the `releaseKey` branch). No delivery was posted, so the
/// contract holds the carried delivery to the hash both parties signed, and the buyer's envelope to that delivery's
/// key list. These tests pin both checks.
contract LateWorkKeyTest is Base {
    /// A second delivery: another body, with its own key list, whose buyer envelope is another ciphertext.
    function _otherDelivery() internal view returns (H.Delivery memory d, H.KeyProof memory k) {
        k = _buyerKey();
        k.ciphertext = "another-buyer-envelope";
        k.keyHashes[0] = keccak256("another primary envelope");
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

    /// Both parties' late settlement naming delivery `named`: the price to the seller, the key released.
    function _late(H.Terms memory t, bytes32 id, H.Delivery memory named) internal view returns (H.Mutual memory mu) {
        mu.hasDelivery = true;
        mu.deliveryHash = hx.delivery(id, named);
        mu.releaseKey = true;
        mu.payouts = new H.Payout[](1);
        mu.payouts[0] = H.Payout(seller, t.price);
        mu.expiresAt = type(uint64).max;
        bytes32 h = hx.mutual(id, t.token, mu);
        mu.buyerSignature = _sign(BUYER_PK, h);
        mu.sellerSignature = _sign(SELLER_PK, h);
    }

    function test_lateWork_releasesTheNamedDeliverysEnvelope() public {
        (H.Terms memory t, bytes32 id) = _funded();
        (H.Delivery memory dv, H.KeyProof memory k) = _delivery();
        H.Mutual memory mu = _late(t, id, dv);
        vm.warp(t.timing.deliverBy);
        vm.recordLogs();
        rules.mutualSettle(t, mu, dv, k);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 released;
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].emitter != address(rules) || logs[i].topics[0] != IHoldbackRules.KeyReleased.selector) continue;
            released++;
            assertEq(logs[i].topics[1], id);
            assertEq(address(uint160(uint256(logs[i].topics[2]))), buyer);
            (uint8 path, string memory scheme, string memory ciphertext) = abi.decode(logs[i].data, (uint8, string, string));
            assertEq(path, rules.KEY_MUTUAL());
            assertEq(scheme, k.scheme);
            // The envelope released is the one the named delivery's key list holds for the buyer.
            assertEq(ciphertext, "buyer-envelope");
            assertEq(hx.key(buyer, k), k.keyHashes[k.index]);
            assertEq(keccak256(abi.encodePacked(k.keyHashes)), dv.encryptedKeysHash);
        }
        assertEq(released, 1, "one key released");
        assertEq(uint8(rules.dealOf(id).stage), uint8(IHoldbackRules.Stage.Settled));
        // No delivery was posted: the late work changed hands only through the settlement.
        assertEq(rules.deliveryHashOf(id), bytes32(0));
    }

    /// The settlement names one delivery; the call carries another, with that other delivery's envelope.
    function test_lateWork_refusesAnotherDeliverysKey() public {
        (H.Terms memory t, bytes32 id) = _funded();
        (H.Delivery memory named,) = _delivery();
        (H.Delivery memory other, H.KeyProof memory otherKey) = _otherDelivery();
        H.Mutual memory mu = _late(t, id, named);
        vm.warp(t.timing.deliverBy);
        vm.expectRevert(IHoldbackRules.BadKeyProof.selector);
        rules.mutualSettle(t, mu, other, otherKey);
    }

    /// The carried delivery is the named one, but the envelope is proven against another delivery's key list.
    function test_lateWork_refusesAnEnvelopeFromAnotherKeyList() public {
        (H.Terms memory t, bytes32 id) = _funded();
        (H.Delivery memory named,) = _delivery();
        (, H.KeyProof memory otherKey) = _otherDelivery();
        H.Mutual memory mu = _late(t, id, named);
        vm.warp(t.timing.deliverBy);
        vm.expectRevert(IHoldbackRules.BadKeyProof.selector);
        rules.mutualSettle(t, mu, named, otherKey);
    }

    /// The named delivery's key list, but an envelope at another index: one sealed to another recipient.
    function test_lateWork_refusesAnotherRecipientsEnvelope() public {
        (H.Terms memory t, bytes32 id) = _funded();
        (H.Delivery memory dv, H.KeyProof memory k) = _delivery();
        H.Mutual memory mu = _late(t, id, dv);
        k.index = 0; // the primary's envelope slot
        vm.warp(t.timing.deliverBy);
        vm.expectRevert(IHoldbackRules.BadKeyProof.selector);
        rules.mutualSettle(t, mu, dv, k);
    }

    /// The same settlement without the late-work key still pays: the key is the parties' choice, the money theirs.
    function test_lateWork_withoutTheKey_paysAndReleasesNothing() public {
        (H.Terms memory t, bytes32 id) = _funded();
        (H.Delivery memory dv,) = _delivery();
        H.Mutual memory mu = _late(t, id, dv);
        mu.releaseKey = false;
        bytes32 h = hx.mutual(id, t.token, mu);
        mu.buyerSignature = _sign(BUYER_PK, h);
        mu.sellerSignature = _sign(SELLER_PK, h);
        H.KeyProof memory none;
        vm.warp(t.timing.deliverBy);
        vm.recordLogs();
        rules.mutualSettle(t, mu, dv, none);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; i++) {
            assertTrue(logs[i].topics.length == 0 || logs[i].topics[0] != IHoldbackRules.KeyReleased.selector);
        }
        assertEq(uint8(rules.dealOf(id).stage), uint8(IHoldbackRules.Stage.Settled));
    }
}
