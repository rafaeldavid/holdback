// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {LibString} from "solady/utils/LibString.sol";
import {FixedPointMathLib} from "solady/utils/FixedPointMathLib.sol";

/// @title HoldbackTypes
/// @notice The settlement view (ADR-0024 §8) and the EIP-712 struct hashes `packages/core/src/eip712.ts` signs.
///         Strings and nested bodies the contract does not enforce arrive as their EIP-712 encodings (keccak256 of
///         the string, or the nested struct hash), so the contract recomputes the same struct hashes from 32-byte
///         words. The commitment ID is the domain-free struct hash of CommitmentTerms (ADR-0016).
/// @dev Token identifiers on EVM settlement are the token's lowercase 0x-hex address (ADR-0025, Proposed): the
///      contract hashes `LibString.toHexString(token)` wherever the struct has a TokenAmount or settlement token.
library HoldbackTypes {
    // ---------------------------------------------------------------- calldata shapes

    struct Timing {
        uint64 offerExpiresAt;
        uint64 fundBy;
        uint64 deliverBy;
        uint64 judgeBy;
        uint64 fallbackBy;
        uint64 appealWindowSec;
        uint64 appealDecideSec;
        uint8 maxSubmissions;
        uint64 disputeBy;
        uint64 disputeJudgeSec;
        uint64 disputeFallbackSec;
    }

    /// @notice The settlement view: enforced fields in the clear, 32-byte encodings for the rest.
    struct Terms {
        bytes32 schemaVersionHash; // keccak256(schemaVersion)
        bytes32 clubIdHash; // keccak256(clubId)
        bytes32 rulebookHash;
        address buyer;
        address seller;
        bytes32 deliverableHash;
        bytes32 acceptanceHash;
        address token; // price, fee and settlement token (one token, as core requires)
        uint256 price;
        address adjudicator;
        address fallbackAdjudicator;
        address appealAdjudicator;
        bytes32 policyIdHash; // keccak256(policyId)
        uint256 fee;
        bytes32 registryHash;
        bytes32 policyHash;
        Timing timing;
        bytes32 remedyHash; // struct hash of Remedy
        bytes32 disclosureHash; // struct hash of Disclosure
        bytes32 buyerKeyHash; // keccak256(buyerEncryptionPublicKey)
        bytes32 nonce;
        uint64 createdAt;
    }

    /// @notice The primary adjudicator's AdjudicatorAcceptance; fee, policy and registry come from the terms.
    struct Acceptance {
        bytes32 seedCommitment;
        uint256 bondReserved;
        bytes32 nonce;
        uint64 expiresAt;
        bytes signature;
    }

    /// @notice The buyer's Agree.
    struct Agree {
        bytes32 nonce;
        uint64 expiresAt;
        bytes signature;
    }

    /// @notice The buyer's funding: a CPP collector signature (ADR-0025, Proposed).
    struct Funding {
        uint8 method; // 0 = ERC-3009 ReceiveWithAuthorization, 1 = Permit2 PermitTransferFrom
        bytes signature;
    }

    /// @notice The seller-signed Delivery as its field encodings (no ciphertext or envelopes on chain).
    struct Delivery {
        uint8 attempt;
        bytes32 ciphertextHash; // struct hash of Ciphertext
        bytes32 plaintextSha256Hash; // keccak256(plaintextSha256)
        bytes32 plaintextMimeHash; // keccak256(plaintextMime)
        bytes32 encryptedKeysHash; // keccak256(concat(struct hash of each EncryptedKey))
        uint64 submittedAt;
    }

    /// @notice A Decision. The adjudicator field is the one whose turn it is, so it is not carried.
    struct Decision {
        uint8 attempt;
        uint8 role; // ROLE_*
        uint8 outcome; // OUTCOME_*
        bytes32 seed;
        bytes32 judgmentRecordHash;
        string keyScheme; // keyForBuyer.scheme ("" when absent)
        string keyCiphertext; // keyForBuyer.ciphertext ("" when absent); emitted on release
        bytes32 appealGroundHash; // keccak256(appealGround), keccak256("") when absent
        bytes32 beaconSourceHash; // keccak256(beacon.source), keccak256("") when absent
        uint64 beaconRound;
        bytes32 beaconValue;
        bytes beaconSignature; // beacon.signature (48 bytes on drand quicknet, empty when absent); hashed below
        bytes32 encryptedKeysHash;
        bytes32 nonce;
        uint64 expiresAt;
        bytes signature;
    }

    struct EarlyAccept {
        uint8 attempt;
        bytes32 nonce;
        uint64 expiresAt;
        bytes signature;
    }

    /// @notice The buyer's envelope inside a delivery's encryptedKeys, with the list's element hashes as proof.
    struct KeyProof {
        string scheme;
        string ciphertext;
        bytes32 unlockKindHash; // keccak256(unlock.kind), keccak256("") when absent
        uint64 unlockRound;
        bytes32[] keyHashes; // struct hash of every EncryptedKey in the delivery, in order
        uint256 index; // position of the buyer's envelope
    }

    struct Payout {
        address to;
        uint256 amount;
    }

    struct Mutual {
        bool hasDelivery;
        bytes32 deliveryHash;
        Payout[] payouts;
        bool releaseKey;
        bytes32 nonce;
        uint64 expiresAt;
        bytes buyerSignature;
        bytes sellerSignature;
    }

    struct Appeal {
        uint8 appellant; // 0 = buyer, 1 = seller
        bytes32 groundsHash; // keccak256(grounds)
        uint256 bond;
        uint64 filedAt;
        bytes signature;
    }

    uint8 internal constant ROLE_PRIMARY = 0;
    uint8 internal constant ROLE_FALLBACK = 1;
    uint8 internal constant ROLE_APPEAL = 2;
    uint8 internal constant OUTCOME_ACCEPT = 0;
    uint8 internal constant OUTCOME_REJECT = 1;
    uint8 internal constant OUTCOME_ESCALATE = 2;

    // ---------------------------------------------------------------- type hashes (eip712.ts)

    string internal constant TOKEN_AMOUNT_T = "TokenAmount(string token,uint256 amount)";
    string internal constant KEY_UNLOCK_T = "KeyUnlock(string kind,uint64 round)";
    string internal constant ENCRYPTED_KEY_T =
        "EncryptedKey(address recipient,string scheme,string ciphertext,KeyUnlock unlock)";
    string internal constant ADJUDICATION_T =
        "Adjudication(address adjudicator,address fallbackAdjudicator,address appealAdjudicator,string policyId,TokenAmount fee,bytes32 registryHash,bytes32 policyHash)";
    string internal constant TIMING_T =
        "Timing(uint64 offerExpiresAt,uint64 fundBy,uint64 deliverBy,uint64 judgeBy,uint64 fallbackBy,uint64 appealWindowSec,uint64 appealDecideSec,uint8 maxSubmissions,uint64 disputeBy,uint64 disputeJudgeSec,uint64 disputeFallbackSec)";
    string internal constant SETTLEMENT_T = "Settlement(string mode,string token)";

    bytes32 internal constant TOKEN_AMOUNT_TYPEHASH = keccak256(bytes(TOKEN_AMOUNT_T));
    bytes32 internal constant KEY_UNLOCK_TYPEHASH = keccak256(bytes(KEY_UNLOCK_T));
    bytes32 internal constant ENCRYPTED_KEY_TYPEHASH = keccak256(abi.encodePacked(ENCRYPTED_KEY_T, KEY_UNLOCK_T));
    bytes32 internal constant ADJUDICATION_TYPEHASH = keccak256(abi.encodePacked(ADJUDICATION_T, TOKEN_AMOUNT_T));
    bytes32 internal constant TIMING_TYPEHASH = keccak256(bytes(TIMING_T));
    bytes32 internal constant SETTLEMENT_TYPEHASH = keccak256(bytes(SETTLEMENT_T));
    bytes32 internal constant TERMS_TYPEHASH = keccak256(
        abi.encodePacked(
            "CommitmentTerms(string schemaVersion,string clubId,bytes32 rulebookHash,address buyer,address seller,bytes32 deliverableHash,bytes32 acceptanceHash,TokenAmount price,Adjudication adjudication,Timing timing,Settlement settlement,Remedy remedy,Disclosure disclosure,string buyerEncryptionPublicKey,bytes32 nonce,uint64 createdAt)",
            ADJUDICATION_T,
            "Disclosure(string level)",
            "Remedy(string onReject)",
            SETTLEMENT_T,
            TIMING_T,
            TOKEN_AMOUNT_T
        )
    );
    bytes32 internal constant ACCEPTANCE_TYPEHASH = keccak256(
        abi.encodePacked(
            "AdjudicatorAcceptance(bytes32 commitmentId,address adjudicator,bytes32 seedCommitment,bytes32 policyHash,bytes32 registryHash,TokenAmount fee,TokenAmount bondReserved,bytes32 nonce,uint64 expiresAt)",
            TOKEN_AMOUNT_T
        )
    );
    bytes32 internal constant AGREE_TYPEHASH =
        keccak256("Agree(bytes32 commitmentId,address buyer,bytes32 nonce,uint64 expiresAt)");
    bytes32 internal constant EARLY_ACCEPT_TYPEHASH =
        keccak256("EarlyAccept(bytes32 commitmentId,address buyer,uint8 attempt,bytes32 nonce,uint64 expiresAt)");
    bytes32 internal constant SEALED_KEY_TYPEHASH = keccak256("SealedKey(string scheme,string ciphertext)");
    bytes32 internal constant BEACON_TYPEHASH =
        keccak256("Beacon(string source,uint64 round,bytes32 value,bytes signature)");
    bytes32 internal constant DECISION_TYPEHASH = keccak256(
        abi.encodePacked(
            "Decision(bytes32 commitmentId,uint8 attempt,address adjudicator,string role,string outcome,bytes32 seed,bytes32 policyHash,bytes32 registryHash,bytes32 judgmentRecordHash,SealedKey keyForBuyer,string appealGround,Beacon beacon,EncryptedKey[] encryptedKeys,bytes32 nonce,uint64 expiresAt)",
            "Beacon(string source,uint64 round,bytes32 value,bytes signature)",
            ENCRYPTED_KEY_T,
            KEY_UNLOCK_T,
            "SealedKey(string scheme,string ciphertext)"
        )
    );
    bytes32 internal constant DELIVERY_TYPEHASH = keccak256(
        abi.encodePacked(
            "Delivery(bytes32 commitmentId,uint8 attempt,Ciphertext ciphertext,string plaintextSha256,string plaintextMime,EncryptedKey[] encryptedKeys,uint64 submittedAt)",
            "Ciphertext(string uri,string sha256,uint64 bytes,string cipher)",
            ENCRYPTED_KEY_T,
            KEY_UNLOCK_T
        )
    );
    bytes32 internal constant APPEAL_TYPEHASH = keccak256(
        abi.encodePacked(
            "Appeal(bytes32 commitmentId,string appellant,address appellantAddress,string grounds,TokenAmount bond,uint64 filedAt)",
            TOKEN_AMOUNT_T
        )
    );
    bytes32 internal constant PAYOUT_TYPEHASH =
        keccak256(abi.encodePacked("Payout(address to,TokenAmount amount)", TOKEN_AMOUNT_T));
    bytes32 internal constant MUTUAL_TYPEHASH = keccak256(
        abi.encodePacked(
            "MutualSettlement(bytes32 commitmentId,bool hasDelivery,bytes32 deliveryHash,Payout[] payouts,bool releaseKey,bytes32 nonce,uint64 expiresAt)",
            "Payout(address to,TokenAmount amount)",
            TOKEN_AMOUNT_T
        )
    );

    bytes32 internal constant GUARANTEED_HASH = keccak256("guaranteed_on_decision");
    bytes32 internal constant EMPTY_HASH = keccak256("");

    // ---------------------------------------------------------------- struct hashes

    /// @notice keccak256 of the token identifier string: the lowercase 0x-hex address (ADR-0025, Proposed).
    function tokenIdHash(address token) internal pure returns (bytes32) {
        return keccak256(bytes(LibString.toHexString(token)));
    }

    function tokenAmountHash(bytes32 tokenHash, uint256 amount) internal pure returns (bytes32) {
        return keccak256(abi.encode(TOKEN_AMOUNT_TYPEHASH, tokenHash, amount));
    }

    function timingHash(Timing calldata t) internal pure returns (bytes32) {
        return keccak256(abi.encode(TIMING_TYPEHASH, t));
    }

    function adjudicationHash(Terms calldata t, bytes32 tokenHash) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                ADJUDICATION_TYPEHASH,
                t.adjudicator,
                t.fallbackAdjudicator,
                t.appealAdjudicator,
                t.policyIdHash,
                tokenAmountHash(tokenHash, t.fee),
                t.registryHash,
                t.policyHash
            )
        );
    }

    /// @notice The commitment ID: the struct hash of CommitmentTerms, rebuilt from the settlement view.
    function commitmentId(Terms calldata t) internal pure returns (bytes32) {
        bytes32 tokenHash = tokenIdHash(t.token);
        bytes memory head = abi.encode(
            TERMS_TYPEHASH,
            t.schemaVersionHash,
            t.clubIdHash,
            t.rulebookHash,
            t.buyer,
            t.seller,
            t.deliverableHash,
            t.acceptanceHash,
            tokenAmountHash(tokenHash, t.price)
        );
        bytes memory tail = abi.encode(
            adjudicationHash(t, tokenHash),
            timingHash(t.timing),
            keccak256(abi.encode(SETTLEMENT_TYPEHASH, GUARANTEED_HASH, tokenHash)),
            t.remedyHash,
            t.disclosureHash,
            t.buyerKeyHash,
            t.nonce,
            t.createdAt
        );
        return keccak256(bytes.concat(head, tail));
    }

    function acceptanceHash(bytes32 id, Terms calldata t, Acceptance calldata a) internal pure returns (bytes32) {
        bytes32 tokenHash = tokenIdHash(t.token);
        return keccak256(
            abi.encode(
                ACCEPTANCE_TYPEHASH,
                id,
                t.adjudicator,
                a.seedCommitment,
                t.policyHash,
                t.registryHash,
                tokenAmountHash(tokenHash, t.fee),
                tokenAmountHash(tokenHash, a.bondReserved),
                a.nonce,
                a.expiresAt
            )
        );
    }

    function agreeHash(bytes32 id, address buyer, Agree calldata a) internal pure returns (bytes32) {
        return keccak256(abi.encode(AGREE_TYPEHASH, id, buyer, a.nonce, a.expiresAt));
    }

    function earlyAcceptHash(bytes32 id, address buyer, EarlyAccept calldata m) internal pure returns (bytes32) {
        return keccak256(abi.encode(EARLY_ACCEPT_TYPEHASH, id, buyer, m.attempt, m.nonce, m.expiresAt));
    }

    function deliveryHash(bytes32 id, Delivery calldata d) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                DELIVERY_TYPEHASH,
                id,
                d.attempt,
                d.ciphertextHash,
                d.plaintextSha256Hash,
                d.plaintextMimeHash,
                d.encryptedKeysHash,
                d.submittedAt
            )
        );
    }

    function encryptedKeyHash(address recipient, KeyProof calldata k) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                ENCRYPTED_KEY_TYPEHASH,
                recipient,
                keccak256(bytes(k.scheme)),
                keccak256(bytes(k.ciphertext)),
                keccak256(abi.encode(KEY_UNLOCK_TYPEHASH, k.unlockKindHash, k.unlockRound))
            )
        );
    }

    function roleHash(uint8 role) internal pure returns (bytes32) {
        if (role == ROLE_PRIMARY) return keccak256("primary");
        if (role == ROLE_FALLBACK) return keccak256("fallback");
        return keccak256("appeal");
    }

    function outcomeHash(uint8 outcome) internal pure returns (bytes32) {
        if (outcome == OUTCOME_ACCEPT) return keccak256("accept");
        if (outcome == OUTCOME_REJECT) return keccak256("reject");
        return keccak256("escalate");
    }

    function decisionHash(bytes32 id, address adjudicator, Terms calldata t, Decision calldata m)
        internal
        pure
        returns (bytes32)
    {
        bytes32 sealedKey =
            keccak256(abi.encode(SEALED_KEY_TYPEHASH, keccak256(bytes(m.keyScheme)), keccak256(bytes(m.keyCiphertext))));
        bytes32 beacon = keccak256(
            abi.encode(BEACON_TYPEHASH, m.beaconSourceHash, m.beaconRound, m.beaconValue, keccak256(m.beaconSignature))
        );
        bytes memory head = abi.encode(
            DECISION_TYPEHASH,
            id,
            m.attempt,
            adjudicator,
            roleHash(m.role),
            outcomeHash(m.outcome),
            m.seed,
            t.policyHash,
            t.registryHash
        );
        bytes memory tail = abi.encode(
            m.judgmentRecordHash, sealedKey, m.appealGroundHash, beacon, m.encryptedKeysHash, m.nonce, m.expiresAt
        );
        return keccak256(bytes.concat(head, tail));
    }

    function appealHash(bytes32 id, address appellant, bytes32 tokenHash, Appeal calldata a)
        internal
        pure
        returns (bytes32)
    {
        bytes32 who = a.appellant == 0 ? keccak256("buyer") : keccak256("seller");
        return keccak256(
            abi.encode(
                APPEAL_TYPEHASH, id, who, appellant, a.groundsHash, tokenAmountHash(tokenHash, a.bond), a.filedAt
            )
        );
    }

    function mutualHash(bytes32 id, bytes32 tokenHash, Mutual calldata m) internal pure returns (bytes32) {
        uint256 n = m.payouts.length;
        bytes32[] memory items = new bytes32[](n);
        for (uint256 i; i < n; ++i) {
            items[i] =
                keccak256(abi.encode(PAYOUT_TYPEHASH, m.payouts[i].to, tokenAmountHash(tokenHash, m.payouts[i].amount)));
        }
        return keccak256(
            abi.encode(
                MUTUAL_TYPEHASH,
                id,
                m.hasDelivery,
                m.deliveryHash,
                keccak256(abi.encodePacked(items)),
                m.releaseKey,
                m.nonce,
                m.expiresAt
            )
        );
    }

    /// @notice panelSeed(role) = keccak256(commitmentId ‖ role ‖ attempt ‖ beaconValue) (ADR-0018, core panelSeed).
    function panelSeed(bytes32 id, uint8 role, uint8 attempt, bytes32 beaconValue) internal pure returns (bytes32) {
        string memory r = role == ROLE_FALLBACK ? "fallback" : "appeal";
        return keccak256(abi.encodePacked(id, r, attempt, beaconValue));
    }
}

/// @title Money
/// @notice ADR-0022 rounding on chain: every rate multiplication names its direction (rule 5).
library Money {
    uint256 internal constant ALL_BPS = 10_000;

    /// @notice Rule 1: a requirement rounds up.
    function requirement(uint256 amount, uint256 bps) internal pure returns (uint256) {
        return FixedPointMathLib.mulDivUp(amount, bps, ALL_BPS);
    }

    /// @notice Rule 3: a payout from a bond rounds down; the bond keeps the dust.
    function payout(uint256 amount, uint256 bps) internal pure returns (uint256) {
        return FixedPointMathLib.mulDiv(amount, bps, ALL_BPS);
    }

    /// @notice Rule 2: a split of one pot rounds the rate side down; the remainder goes to the named party.
    function split(uint256 pot, uint256 bps) internal pure returns (uint256 share, uint256 remainder) {
        share = FixedPointMathLib.mulDiv(pot, bps, ALL_BPS);
        remainder = pot - share;
    }
}
