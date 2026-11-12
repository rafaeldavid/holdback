// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {HoldbackRules} from "../../src/HoldbackRules.sol";
import {HoldbackTypes as H} from "../../src/HoldbackTypes.sol";
import {Base} from "./Base.sol";

/// @title L-4: the primary's seed commitment is checked in full and bound to the commitment (T-380, R8 fix 1)
/// @notice The word stores `seedTag = uint144(keccak256(abi.encode(seedCommitment, id)))` at funding, and the
///         primary's decision must reveal a seed whose `keccak256` gives the same tag for the same ID. So every bit of
///         the acceptance's `seedCommitment` enters the check, and two seeds whose tags collide on one deal (about
///         2^72 hash attempts) give a choice on that deal only. The parent (`test/differential/parent/`) stored the
///         commitment's low 144 bits: each test below fails on it.
contract SeedTagTest is Base {
    /// Funds `t` with an acceptance whose seed commitment is `commitment`, signed by the primary.
    function _fundWith(H.Terms memory t, bytes32 commitment) internal returns (bytes32 id) {
        H.Acceptance memory a = _acceptance(t, ADJ_PK);
        a.seedCommitment = commitment;
        a.signature = _sign(ADJ_PK, hx.acceptance(hx.id(t), t, a));
        vm.prank(relayer);
        id = rules.agreeAndFund(t, _sellerSig(t, SELLER_PK), a, _agree(t, BUYER_PK), _erc3009(t, BUYER_PK));
    }

    function _decideAsPrimary(H.Terms memory t, bytes32 id) internal returns (bool ok, bytes memory ret) {
        (H.Delivery memory d,) = _delivery();
        H.Decision memory m = _primary(t, id, H.OUTCOME_REJECT);
        (ok, ret) = address(rules).call(
            abi.encodeCall(HoldbackRules.decide, (t, m, d, _deliverySig(id, d, SELLER_PK)))
        );
    }

    function test_seedTag_hashesTheWholeCommitmentWithTheId() public {
        (H.Terms memory t, bytes32 id) = _funded();
        bytes32 commitment = keccak256(abi.encodePacked(SEED));
        assertEq(rules.dealOf(id).seedTag, uint144(uint256(keccak256(abi.encode(commitment, id)))), "seedTag");
    }

    /// The same seed commitment on two deals stores two tags: a collision found for one deal is no use on another.
    function test_seedTag_differsPerCommitment() public {
        (, bytes32 a) = _funded();
        bytes32 b = _fund(_terms()); // `_terms` draws a new nonce each call
        assertTrue(a != b, "one deal");
        assertTrue(rules.dealOf(a).seedTag != rules.dealOf(b).seedTag, "the tag does not bind the commitment ID");
    }

    /// A commitment equal to keccak256(SEED) on its low 144 bits and different above them: the parent let the seed
    /// SEED decide; now the decision reverts with `BadSeed`.
    function test_attack_highBitsOfTheCommitment_badSeed() public {
        H.Terms memory t = _terms();
        bytes32 commitment = keccak256(abi.encodePacked(SEED)) ^ bytes32(uint256(1) << 255);
        bytes32 id = _fundWith(t, commitment);
        (bool ok, bytes memory ret) = _decideAsPrimary(t, id);
        assertFalse(ok, "a seed whose hash differs from the commitment decided");
        assertEq(ret, abi.encodeWithSelector(HoldbackRules.BadSeed.selector));
        assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.Held), "the deal moved");
    }

    /// The revealed seed still decides when its hash is the commitment.
    function test_rightSeed_decides() public {
        (H.Terms memory t, bytes32 id) = _funded();
        (bool ok,) = _decideAsPrimary(t, id);
        assertTrue(ok, "the right seed was refused");
        assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.Refunded));
    }
}
