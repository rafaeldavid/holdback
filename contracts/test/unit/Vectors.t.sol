// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {HoldbackRules} from "../../src/HoldbackRules.sol";
import {HoldbackTypes as H} from "../../src/HoldbackTypes.sol";
import {TypesHarness} from "./Base.sol";

/// Cross-language vectors: the values `packages/core` (eip712.ts, viem) computes for spec/examples, with every
/// token identifier set to the address 0x…beef (ADR-0025). The contract must rebuild the same commitment ID,
/// delivery hash and message digests from the settlement view. The generator is
/// `packages/core/src/eip712.vectors.test.ts`, which pins the same values (domain 0.8, ADR-0033). The example's payout address differs from its seller.
contract VectorsTest is Test {
    TypesHarness internal hx = new TypesHarness();
    address internal constant TOKEN = 0x000000000000000000000000000000000000bEEF;
    address internal constant VERIFYING = 0x00000000000000000000000000000000000000A1;

    function _terms() internal pure returns (H.Terms memory t) {
        t = H.Terms({
            schemaVersionHash: 0x15e7a716d821b9602c70f6d0f574efbb8147fb465215d43354c7b3e69d03ed92,
            clubIdHash: 0x7b600434c72773d2aacdfc4846c576db4f5f847cab94ead38a22a3c4e01c7003,
            rulebookHash: 0xb70959b8b5a5a9d365df7471120396553ed1bc0bff83059e4862e6d11b36a556,
            buyer: 0x04D6c65223896Ba94e731bc9eB765C19Bd289b0d,
            seller: 0x9Ff412388F11e58327E71F841705dbC739c8CC46,
            buyerPaymentAddress: 0x04D6c65223896Ba94e731bc9eB765C19Bd289b0d,
            sellerPayoutAddress: 0x7a1c3e5b9d2F4A6c8e0B1d3f5A7c9E1b3D5f7A9c,
            deliverableHash: 0x303342f144fa951dc84612d5d026d641ee77f3ae3b044d39b3e6d5661894d942,
            acceptanceHash: 0x731647db76ade2a3774a204fc9a7d13eb74798faf5e4d19891aa9d3f1642378b,
            token: TOKEN,
            price: 2_000_000_000,
            adjudicator: 0x5d10FecaB9242E66cb134b77309a3566eD75e3dd,
            fallbackAdjudicator: 0xf9E6283D068Ff7016653Ab6d36A7fab0294F4B8A,
            appealAdjudicator: 0xc372Bd536a0f63fe9fde6bCa1Db179Ce93612520,
            policyIdHash: 0xa7fcda573d388c38e9e41562983452a3ede149b3178f64a80b4943442b6bd0df,
            fee: 50_000_000,
            registryHash: 0x54bdcd5545af7f0a1d42fa9adad89dc6f5d20ea8c0e16b270d2160b78b16007a,
            policyHash: 0x04221c401f162ef3a3c07c9d97024f3a13eb30f262b0c088ee6f63fa2c893dbb,
            timing: H.Timing({
                offerExpiresAt: 1_793_355_300,
                fundBy: 1_793_356_200,
                deliverBy: 1_793_527_200,
                judgeBy: 1_793_527_320,
                fallbackBy: 1_793_527_440,
                appealWindowSec: 0,
                appealDecideSec: 300,
                maxSubmissions: 1,
                disputeBy: 0,
                disputeJudgeSec: 0,
                disputeFallbackSec: 0
            }),
            remedyHash: 0xb3099e0ca3d62f5d64e5cdc2fefbfb1b1bacb5df470701ef7a01712767aec0fc,
            disclosureHash: 0x1f713daff8965bac6742f665b7e755122adde9106c49510690e558c219af8fb9,
            buyerKeyHash: 0xb08985bc1a36214c9bbdf466c2c71f95c8faa37b97430a0e19f820121cbe6f29,
            nonce: 0x9e3f156324d42f0ea4b6f4fce81d56fbd64a2143a3fdd60a130d9c90e5b4d688,
            createdAt: 1_793_354_400
        });
    }

    bytes32 internal constant ID = 0x6bdb0a2fe90f698ca6e4786c36d35b5147ef9abb0771057aa4c1a3911569b248;
    /// The delivery example's struct hash under ID: what a Decision and an EarlyAccept name (ADR-0029).
    bytes32 internal constant DELIVERY = 0x93ab77cc02ea63b2c518c651abd645ebb44e3735f5efcbdc7221bde8c42d10d8;

    function _digest(bytes32 structHash) internal pure returns (bytes32) {
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("Holdback"),
                keccak256("0.8"),
                uint256(31337),
                VERIFYING
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", domain, structHash));
    }

    function test_commitmentId_matchesCore() public view {
        assertEq(hx.id(_terms()), ID);
    }

    /// The rules contract, deployed at the vectors' verifying address, signs under core's domain: its digest of the
    /// commitment ID is core's terms digest, and `_digest` (used by the vectors below) builds the same domain.
    function test_termsDigest_matchesCore() public {
        vm.chainId(31337);
        bytes memory args = abi.encode(address(0), address(0), address(0), uint64(0), address(0), TOKEN);
        deployCodeTo("HoldbackRules.sol:HoldbackRules", args, VERIFYING);
        bytes32 core = 0xce857ec719814ca437a36c4d8c05df882d685c72172a0333adfe30f3a8187e61;
        assertEq(HoldbackRules(VERIFYING).typedDataHash(ID), core);
        assertEq(_digest(ID), core);
    }

    function test_delivery_matchesCore() public view {
        H.Delivery memory d = H.Delivery({
            attempt: 1,
            ciphertextHash: 0x7e13908b9c3b8587f3cba826428532a23df07b2d0252d76727164d4eb2778b26,
            plaintextSha256Hash: 0x312256d554bbcaa14751ae42fbbc5cce2fd828ca4fb6a68b946d04ef527f7357,
            plaintextMimeHash: 0xd9fcb5a1963a15496f693a54c6815451aa808319f51b7fa94462ba55a869a52a,
            encryptedKeysHash: keccak256(
                abi.encodePacked(
                    bytes32(0xf33423a18f410bdbcfdb49aef9eba54b303e50136ab9fbb1bea530921a5c902a),
                    bytes32(0xe00649bdb073ee0d5c607ff0a8d900755537a66257925b58b9c6799e1f0e6e1f),
                    bytes32(0x91c107b44c911caeebe8a80b37bd583866389fa9d1d499d4da8cf3301c03cb14)
                )
            ),
            submittedAt: 1_793_463_600
        });
        assertEq(hx.delivery(ID, d), DELIVERY);
    }

    function test_encryptedKey_matchesCore() public view {
        H.KeyProof memory k;
        k.scheme = "x25519-xsalsa20poly1305";
        k.ciphertext = "13Acae29634ec37a28a379a7876a56f9f1Af4d814d6";
        k.unlockKindHash = keccak256("none");
        assertEq(
            hx.key(0x5d10FecaB9242E66cb134b77309a3566eD75e3dd, k),
            0xf33423a18f410bdbcfdb49aef9eba54b303e50136ab9fbb1bea530921a5c902a
        );
        k.ciphertext = "eb14aaA72f1a3daA2a6e2b4247775812a6a3a3e4f4d";
        k.unlockKindHash = keccak256(""); // absent unlock
        assertEq(
            hx.key(0xf9E6283D068Ff7016653Ab6d36A7fab0294F4B8A, k),
            0xe00649bdb073ee0d5c607ff0a8d900755537a66257925b58b9c6799e1f0e6e1f
        );
    }

    function test_decision_matchesCore() public view {
        H.Decision memory m;
        m.attempt = 1;
        m.deliveryHash = DELIVERY;
        m.role = H.ROLE_PRIMARY;
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
        H.Terms memory t = _terms();
        assertEq(
            _digest(hx.decision(ID, t.adjudicator, t, m)),
            0xcf2fff4c045473283a1414ae5c36847f25989f4aec9869c018805fd3b9e21f94
        );
    }

    function test_acceptance_matchesCore() public view {
        H.Acceptance memory a = H.Acceptance({
            seedCommitment: 0x9b7729175e6efa947ff5980e87390813228dc2eef1c4b2f1d72a9c3d2eb02d3e,
            bondReserved: 2_000_000_000,
            nonce: 0x8d635dd7a4aa046df7d485f7ae93b9db2d906874bf8df5a3efc046a42add2c51,
            expiresAt: 1_793_355_300,
            signature: ""
        });
        assertEq(
            _digest(hx.acceptance(ID, _terms(), a)), 0x67022aceda5ba70cb31d1ea142866b79e0de661257385e4ef36b767b5e448004
        );
    }

    function test_agree_and_earlyAccept_matchCore() public view {
        address b = _terms().buyer;
        H.Agree memory g = H.Agree({
            nonce: bytes32(uint256(0x11) * (type(uint256).max / 0xff)),
            expiresAt: 1_793_355_300,
            signature: ""
        });
        assertEq(_digest(hx.agree(ID, b, g)), 0x06aaeb1dcb956056d5ccf829563bb722b8684fb293e79e65a475d94eb4b9a5f9);
        H.EarlyAccept memory e = H.EarlyAccept({
            attempt: 1,
            deliveryHash: DELIVERY,
            nonce: bytes32(uint256(0x22) * (type(uint256).max / 0xff)),
            expiresAt: 1_793_527_200,
            signature: ""
        });
        assertEq(_digest(hx.early(ID, b, e)), 0x0af6c0c7c9e76a8bab144abf72e1eb8ab3388cf1bba5c138bb1a487514474117);
    }

    function test_mutual_matchesCore() public view {
        H.Mutual memory m;
        m.hasDelivery = true;
        m.deliveryHash = 0x4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b;
        m.payouts = new H.Payout[](2);
        m.payouts[0] = H.Payout(0x9Ff412388F11e58327E71F841705dbC739c8CC46, 1_200_000_000);
        m.payouts[1] = H.Payout(0x9999999999999999999999999999999999999999, 800_000_000);
        m.releaseKey = true;
        m.nonce = 0x5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d;
        m.expiresAt = 1_793_527_320;
        assertEq(_digest(hx.mutual(ID, TOKEN, m)), 0x32adb8a961ee550fd52e4fd24c8d92debbdb15104bb497bfd44236a4667a61d9);
    }

    // The Appeal vector left with the contract's appealHash (T-346, ADR-0031 §8): phase one hashes no Appeal.
    // packages/core and spec/ keep theirs, digest 0xa1222f359777b62c6ec7b694b710d7b3c86b9914cb89e05e8d4b4f423aac3b52.

    function test_panelSeed_matchesCore() public view {
        assertEq(
            hx.panelSeed(ID, H.ROLE_FALLBACK, 1, bytes32(uint256(0x33) * (type(uint256).max / 0xff))),
            0x11d7d7df48d0f1abe95c4cf05415151fe4007df150f1072d1e5730d2fd7d1121
        );
    }
}
