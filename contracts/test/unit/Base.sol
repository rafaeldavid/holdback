// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {AuthCaptureEscrow} from "commerce-payments/AuthCaptureEscrow.sol";
import {ERC3009PaymentCollector} from "commerce-payments/collectors/ERC3009PaymentCollector.sol";
import {Permit2PaymentCollector} from "commerce-payments/collectors/Permit2PaymentCollector.sol";
import {IERC3009} from "commerce-payments/interfaces/IERC3009.sol";
import {MockERC3009Token} from "commerce-payments-test/mocks/MockERC3009Token.sol";
import {IPermit2} from "permit2/interfaces/IPermit2.sol";
import {DeployPermit2} from "permit2/../test/utils/DeployPermit2.sol";

import {HoldbackRules} from "../../src/HoldbackRules.sol";
import {IHoldbackRules} from "../../src/IHoldbackRules.sol";
import {HoldbackTypes as H} from "../../src/HoldbackTypes.sol";
import {SimBeacon} from "../../script/SimBeacon.sol";

/// Exposes the library's struct hashes (calldata-only) to tests.
contract TypesHarness {
    function id(H.Terms calldata t) external pure returns (bytes32) {
        return H.commitmentId(t);
    }

    function acceptance(bytes32 i, H.Terms calldata t, H.Acceptance calldata a) external pure returns (bytes32) {
        return H.acceptanceHash(i, t, a);
    }

    function agree(bytes32 i, address b, H.Agree calldata a) external pure returns (bytes32) {
        return H.agreeHash(i, b, a);
    }

    function early(bytes32 i, address b, H.EarlyAccept calldata m) external pure returns (bytes32) {
        return H.earlyAcceptHash(i, b, m);
    }

    function delivery(bytes32 i, H.Delivery calldata d) external pure returns (bytes32) {
        return H.deliveryHash(i, d);
    }

    function key(address r, H.KeyProof calldata k) external pure returns (bytes32) {
        return H.encryptedKeyHash(r, k);
    }

    function decision(bytes32 i, address a, H.Terms calldata t, H.Decision calldata m)
        external
        pure
        returns (bytes32)
    {
        return H.decisionHash(i, a, t, m);
    }

    function mutual(bytes32 i, address token, H.Mutual calldata m) external pure returns (bytes32) {
        return H.mutualHash(i, H.tokenIdHash(token), m);
    }

    function panelSeed(bytes32 i, uint8 role, uint8 attempt, bytes32 v) external pure returns (bytes32) {
        return H.panelSeed(i, role, attempt, v);
    }
}

/// Shared fixture: CPP v1.1.0 (vendored, unmodified), both collectors, Permit2, a mock USDC with ERC-3009, and
/// HoldbackRules (phase one: no bond vault, ADR-0031 §8) and the sim beacon (T-209: the drand verifier has its own suites). Local EVM only (chain id 31337); no RPC.
/// Since SC-2 (ADR-0031 §3) the rules contract funds by ERC-3009 only and takes no Permit2 collector. The world still
/// deploys Permit2 and its collector: the pinned contracts the side-by-side harness and `PhaseOneNoBonds.t.sol` deploy
/// take one, and `Erc3009Only.t.sol` shows a valid Permit2 signature is refused.
abstract contract Base is Test, DeployPermit2 {
    bytes32 internal constant RECEIVE_WITH_AUTHORIZATION_TYPEHASH =
        0xd099cc98ef71107a616c4f0f941f04c322d8e254fe26b3c6668db87aae413de8;
    bytes32 internal constant PERMIT_TRANSFER_FROM_TYPEHASH = keccak256(
        "PermitTransferFrom(TokenPermissions permitted,address spender,uint256 nonce,uint256 deadline)TokenPermissions(address token,uint256 amount)"
    );
    bytes32 internal constant TOKEN_PERMISSIONS_TYPEHASH = keccak256("TokenPermissions(address token,uint256 amount)");
    address internal constant MULTICALL3 = 0xcA11bde05977b3631167028862bE2a173976CA11;
    uint64 internal constant MARGIN = 1 days;
    /// ADR-0032: the beacon margin of Ethereum mainnet and Sepolia, which the drand suites deploy with.
    uint64 internal constant DRAND_MARGIN = 29;

    AuthCaptureEscrow internal escrow;
    ERC3009PaymentCollector internal collector3009;
    Permit2PaymentCollector internal collectorPermit2;
    address internal permit2;
    MockERC3009Token internal usdc;
    SimBeacon internal sim;
    HoldbackRules internal rules;
    TypesHarness internal hx;

    uint256 internal constant BUYER_PK = 0xB0B;
    uint256 internal constant SELLER_PK = 0x5E11;
    uint256 internal constant ADJ_PK = 0xA11CE;
    uint256 internal constant FB_PK = 0xFA11;
    uint256 internal constant AP_PK = 0xA99E;
    uint256 internal constant OTHER_PK = 0xBAD;
    address internal buyer;
    address internal seller;
    address internal adjudicator;
    address internal fallbackAdj;
    address internal appealAdj;
    address internal relayer;

    uint256 internal constant PRICE = 26_000_000; // 26 tUSD, 6 decimals
    uint256 internal constant FEE = 500_000; // 0.50 tUSD adjudication fee
    bytes32 internal constant SEED = keccak256("primary seed");
    bytes32 internal constant SIM_SEED = keccak256("sim seed");
    string internal constant KEY_SCHEME = "x25519-xsalsa20poly1305";
    string internal constant KEY_CT = "c2VhbGVkLWtleS1mb3ItYnV5ZXI";

    uint256 internal salt;

    /// The rules contract's beacon margin (ADR-0032): 0 on the local chain, which keeps the sim rounds at judgeBy and
    /// t1 + 1. A suite that tests the margin on the sim beacon overrides it.
    function _beaconMargin() internal view virtual returns (uint64) {
        return 0;
    }

    function setUp() public virtual {
        vm.chainId(31337);
        vm.warp(1_790_000_000);
        escrow = new AuthCaptureEscrow();
        permit2 = deployPermit2();
        collector3009 = new ERC3009PaymentCollector(address(escrow), MULTICALL3);
        collectorPermit2 = new Permit2PaymentCollector(address(escrow), permit2, MULTICALL3);
        usdc = new MockERC3009Token("Mock USDC", "mUSDC", 6);
        sim = new SimBeacon(SIM_SEED);
        rules = new HoldbackRules(escrow, address(collector3009), MARGIN, sim, address(usdc), _beaconMargin());
        hx = new TypesHarness();

        buyer = vm.addr(BUYER_PK);
        seller = vm.addr(SELLER_PK);
        adjudicator = vm.addr(ADJ_PK);
        fallbackAdj = vm.addr(FB_PK);
        appealAdj = vm.addr(AP_PK);
        relayer = makeAddr("relayer");
        usdc.mint(buyer, 1_000_000_000);
        usdc.mint(seller, 1_000_000_000);
    }

    // ------------------------------------------------------------ builders

    /// The `bondReserved` an acceptance signs: 0 on a phase-one deployment, which refuses any other value (ADR-0031
    /// §8, point 2). The side-by-side harness's pinned side overrides it with the price, which the deployed
    /// contracts require.
    function _bondReserved(H.Terms memory) internal view virtual returns (uint256) {
        return 0;
    }

    function _terms() internal returns (H.Terms memory t) {
        uint64 now_ = uint64(block.timestamp);
        t = H.Terms({
            schemaVersionHash: keccak256("0.8"),
            clubIdHash: keccak256("data-services-v1"),
            rulebookHash: keccak256("rulebook"),
            buyer: buyer,
            seller: seller,
            buyerPaymentAddress: buyer, // ADR-0033: equal to the signing addresses unless a test sets them apart
            sellerPayoutAddress: seller,
            deliverableHash: keccak256("deliverable"),
            acceptanceHash: keccak256("acceptance"),
            token: address(usdc),
            price: PRICE,
            adjudicator: adjudicator,
            fallbackAdjudicator: fallbackAdj,
            appealAdjudicator: appealAdj,
            policyIdHash: keccak256("bench-a/p1"),
            fee: FEE,
            registryHash: keccak256("registry"),
            policyHash: keccak256("policy"),
            timing: H.Timing({
                offerExpiresAt: now_ + 1 hours,
                fundBy: now_ + 2 hours,
                deliverBy: now_ + 1 days,
                judgeBy: now_ + 2 days,
                fallbackBy: now_ + 3 days,
                appealWindowSec: 0, // phase one has no party appeal (ADR-0033 §2b)
                appealDecideSec: 1 days,
                maxSubmissions: 1,
                disputeBy: 0,
                disputeJudgeSec: 0,
                disputeFallbackSec: 0
            }),
            remedyHash: keccak256("remedy"),
            disclosureHash: keccak256("disclosure"),
            buyerKeyHash: keccak256("buyer key"),
            nonce: keccak256(abi.encode("nonce", salt++)),
            createdAt: now_
        });
    }

    function _sign(uint256 pk, bytes32 structHash) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, rules.typedDataHash(structHash));
        return abi.encodePacked(r, s, v);
    }

    function _signRaw(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    /// The CPP PaymentInfo the rules contract derives (ADR-0025).
    function _pi(H.Terms memory t) internal view returns (AuthCaptureEscrow.PaymentInfo memory) {
        uint48 expiry = uint48(t.timing.fallbackBy + t.timing.appealDecideSec + rules.EXPIRY_MARGIN()); // the deployment's
        return AuthCaptureEscrow.PaymentInfo({
            operator: address(rules),
            payer: t.buyerPaymentAddress,
            receiver: t.sellerPayoutAddress,
            token: t.token,
            maxAmount: uint120(t.price + t.fee),
            preApprovalExpiry: uint48(t.timing.fundBy),
            authorizationExpiry: expiry,
            refundExpiry: expiry,
            minFeeBps: 0,
            maxFeeBps: 10_000,
            feeReceiver: address(0),
            salt: uint256(hx.id(t))
        });
    }

    function _payerAgnosticHash(AuthCaptureEscrow.PaymentInfo memory pi) internal view returns (bytes32) {
        pi.payer = address(0);
        return escrow.getHash(pi);
    }

    function _erc3009(H.Terms memory t, uint256 pk) internal view returns (H.Funding memory) {
        AuthCaptureEscrow.PaymentInfo memory pi = _pi(t);
        bytes32 structHash = keccak256(
            abi.encode(
                RECEIVE_WITH_AUTHORIZATION_TYPEHASH,
                pi.payer,
                address(collector3009),
                uint256(pi.maxAmount),
                uint256(0),
                uint256(pi.preApprovalExpiry),
                _payerAgnosticHash(pi)
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", IERC3009(pi.token).DOMAIN_SEPARATOR(), structHash));
        return H.Funding({signature: _signRaw(pk, digest)});
    }

    /// A Permit2 PermitTransferFrom signature for the deal's hold, for the Permit2 collector. Phase one has no
    /// Permit2 path (SC-2): it is the pinned contracts' funding, and the input `Erc3009Only.t.sol` shows refused.
    function _permit2(H.Terms memory t, uint256 pk) internal view returns (bytes memory) {
        AuthCaptureEscrow.PaymentInfo memory pi = _pi(t);
        bytes32 permitHash = keccak256(
            abi.encode(
                PERMIT_TRANSFER_FROM_TYPEHASH,
                keccak256(abi.encode(TOKEN_PERMISSIONS_TYPEHASH, pi.token, uint256(pi.maxAmount))),
                address(collectorPermit2),
                uint256(_payerAgnosticHash(pi)),
                uint256(pi.preApprovalExpiry)
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", IPermit2(permit2).DOMAIN_SEPARATOR(), permitHash));
        return _signRaw(pk, digest);
    }

    function _acceptance(H.Terms memory t, uint256 pk) internal view returns (H.Acceptance memory a) {
        a = H.Acceptance({
            seedCommitment: keccak256(abi.encodePacked(SEED)),
            bondReserved: _bondReserved(t),
            nonce: keccak256("acc"),
            expiresAt: t.timing.offerExpiresAt,
            signature: ""
        });
        a.signature = _sign(pk, hx.acceptance(hx.id(t), t, a));
    }

    function _agree(H.Terms memory t, uint256 pk) internal view returns (H.Agree memory a) {
        a = H.Agree({nonce: keccak256("agree"), expiresAt: t.timing.offerExpiresAt, signature: ""});
        a.signature = _sign(pk, hx.agree(hx.id(t), t.buyer, a));
    }

    function _sellerSig(H.Terms memory t, uint256 pk) internal view returns (bytes memory) {
        return _sign(pk, hx.id(t));
    }

    function _fund(H.Terms memory t) internal returns (bytes32 id) {
        vm.prank(relayer);
        id = rules.agreeAndFund(
            t, _sellerSig(t, SELLER_PK), _acceptance(t, ADJ_PK), _agree(t, BUYER_PK), _erc3009(t, BUYER_PK)
        );
    }

    function _funded() internal returns (H.Terms memory t, bytes32 id) {
        t = _terms();
        id = _fund(t);
    }

    // ------------------------------------------------------------ delivery and keys

    function _buyerKey() internal pure returns (H.KeyProof memory k) {
        k.scheme = KEY_SCHEME;
        k.ciphertext = "buyer-envelope";
        k.unlockKindHash = keccak256("");
        k.unlockRound = 0;
        k.keyHashes = new bytes32[](3);
        k.keyHashes[0] = keccak256("primary envelope");
        k.keyHashes[2] = keccak256("fallback envelope");
        k.index = 1;
    }

    /// A delivery whose encryptedKeys hold the buyer's envelope (index 1) among others. Its fields are fixed (the
    /// contract never reads submittedAt), so it hashes the same before and after a warp: a signature that names it
    /// (ADR-0029) still names the posted delivery later.
    function _delivery() internal view returns (H.Delivery memory d, H.KeyProof memory k) {
        k = _buyerKey();
        k.keyHashes[1] = hx.key(buyer, k);
        d = H.Delivery({
            attempt: 1,
            ciphertextHash: keccak256("ciphertext"),
            plaintextSha256Hash: keccak256("sha256:plain"),
            plaintextMimeHash: keccak256("text/csv"),
            encryptedKeysHash: keccak256(abi.encodePacked(k.keyHashes)),
            submittedAt: 1_790_000_000
        });
    }

    function _deliverySig(bytes32 id, H.Delivery memory d, uint256 pk) internal view returns (bytes memory) {
        return _sign(pk, hx.delivery(id, d));
    }

    function _deliver(H.Terms memory t, bytes32 id) internal returns (H.Delivery memory d, H.KeyProof memory k) {
        (d, k) = _delivery();
        rules.deliver(t, d, _deliverySig(id, d, SELLER_PK));
    }

    function _noDelivery() internal pure returns (H.Delivery memory d) {}

    // ------------------------------------------------------------ decisions

    function _decision(uint8 role, uint8 outcome) internal pure returns (H.Decision memory m) {
        m.attempt = 1;
        m.role = role;
        m.outcome = outcome;
        m.seed = SEED;
        m.judgmentRecordHash = keccak256("record");
        if (outcome == H.OUTCOME_ACCEPT) {
            m.keyScheme = KEY_SCHEME;
            m.keyCiphertext = KEY_CT;
        }
        m.appealGroundHash = keccak256("");
        m.beaconSourceHash = keccak256("");
        m.encryptedKeysHash = keccak256("");
        m.nonce = keccak256("decision");
        m.expiresAt = type(uint64).max;
    }

    /// The sim beacon's value for a round: keccak256(simSeed ‖ round) (ADR-0018 §3).
    function _simValue(uint64 round) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(SIM_SEED, round));
    }

    /// A fallback or appeal decision seeded from the beacon round the settlement state fixes (ADR-0018). The sim
    /// beacon refuses a round the chain clock has not reached, so a caller deciding right after an escalation or an
    /// appeal warps past the round first, as a decider waits for drand's next round.
    function _beaconDecision(bytes32 id, uint8 role, uint8 outcome, uint64 round)
        internal
        view
        returns (H.Decision memory m)
    {
        m = _decision(role, outcome);
        m.beaconSourceHash = keccak256("sim");
        m.beaconRound = round;
        m.beaconValue = _simValue(round);
        m.seed = hx.panelSeed(id, role, m.attempt, m.beaconValue);
    }

    /// The delivery a signature names by default (ADR-0029): the posted one, or else `_delivery()`, the one a decision
    /// or early accept in `Held` carries.
    function _namedDelivery(bytes32 id) internal view returns (bytes32 dh) {
        dh = rules.deliveryHashOf(id);
        if (dh == bytes32(0)) {
            (H.Delivery memory d,) = _delivery();
            dh = hx.delivery(id, d);
        }
    }

    /// Signs `m`; a decision that names no delivery names `_namedDelivery(id)`.
    function _signDecision(H.Terms memory t, bytes32 id, H.Decision memory m, address who, uint256 pk)
        internal
        view
        returns (H.Decision memory)
    {
        if (m.deliveryHash == bytes32(0)) m.deliveryHash = _namedDelivery(id);
        m.signature = _sign(pk, hx.decision(id, who, t, m));
        return m;
    }

    /// The buyer's early accept for the delivery named by default (`_namedDelivery`).
    function _early(H.Terms memory t, bytes32 id, uint256 pk) internal view returns (H.EarlyAccept memory m) {
        m = H.EarlyAccept({
            attempt: 1,
            deliveryHash: _namedDelivery(id),
            nonce: keccak256("early"),
            expiresAt: type(uint64).max,
            signature: ""
        });
        m.signature = _sign(pk, hx.early(id, t.buyer, m));
    }

    function _primary(H.Terms memory t, bytes32 id, uint8 outcome) internal view returns (H.Decision memory) {
        return _signDecision(t, id, _decision(H.ROLE_PRIMARY, outcome), adjudicator, ADJ_PK);
    }

    function _stage(bytes32 id) internal view returns (IHoldbackRules.Stage) {
        return rules.dealOf(id).stage;
    }

    /// What CPP's TokenStore for this operator holds (one deal at a time in these tests).
    function _held(H.Terms memory) internal view returns (uint256) {
        return usdc.balanceOf(escrow.getTokenStore(address(rules)));
    }
}
