// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {HoldbackTypes as H} from "../../src/HoldbackTypes.sol";
import {VectorsTest} from "./Vectors.t.sol";

/// @title Decision digests for the fallback and appeal roles match core (T-352, R10)
/// @notice `test_decision_matchesCore` pins the primary's decision digest only. The R10 mutation run at c629d06 found
///         that `roleHash` could hash the fallback role as the appeal role with every test passing (mutant T05): the
///         tests sign through the same library, so the contract and the test agree, while every off-chain signer
///         (packages/core, eip712.ts) would have its fallback decisions refused. These vectors are core's
///         `messageDigest` for the same example decision with only the role changed, computed on 2026-11-12 from the
///         lane at c629d06 with the same inputs as `packages/core/src/eip712.vectors.test.ts` (whose primary digest,
///         0x64343a2c…59e1, the same computation reproduced). Inheriting `VectorsTest` reuses its terms and domain, so
///         its own vector tests run here a second time.
contract RoleVectorsTest is VectorsTest {
    function _decision(uint8 role) internal pure returns (H.Decision memory m) {
        m.attempt = 1;
        m.deliveryHash = DELIVERY;
        m.role = role;
        m.outcome = H.OUTCOME_ACCEPT;
        m.seed = 0x40a7da5565ae8c475972696a25d415b73a73e9451aa19d897e227ec6e7ff827a;
        m.judgmentRecordHash = 0xd0b0155458b2777710df84a106cdeea499f8fdae428b73f2476fdb0a3fadefe8;
        m.keyScheme = "x25519-xsalsa20poly1305";
        m.keyCiphertext = "c2VhbGVkLWtleS1mb3ItYnV5ZXI";
        m.appealGroundHash = keccak256("");
        m.beaconSourceHash = keccak256("");
        m.encryptedKeysHash = keccak256("");
        m.nonce = 0x8c23bc960ccf68b0e04c82f1ed509ea8f25e46b2698e01a8d437da4979a6e96d;
        m.expiresAt = 1_793_527_320;
    }

    /// T05: the fallback's role hashes as "fallback", as core signs it.
    function test_decision_fallbackRole_matchesCore() public view {
        H.Terms memory t = _terms();
        assertEq(
            _digest(hx.decision(ID, t.adjudicator, t, _decision(H.ROLE_FALLBACK))),
            0x36a53f5e00f8667a82cdb7589237528a96cdfcdc1bebccf3bbbd1224ffdd191b
        );
    }

    /// The appeal adjudicator's role (escalations in phase one) hashes as "appeal", as core signs it.
    function test_decision_appealRole_matchesCore() public view {
        H.Terms memory t = _terms();
        assertEq(
            _digest(hx.decision(ID, t.adjudicator, t, _decision(H.ROLE_APPEAL))),
            0xdf36cfedd8b2ecad09dff2144b173ca11491141f45abc74f76e25a368cb03a27
        );
    }
}
