// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AuthCaptureEscrow} from "commerce-payments/AuthCaptureEscrow.sol";
import {EIP712} from "solady/utils/EIP712.sol";
import {SignatureCheckerLib} from "solady/utils/SignatureCheckerLib.sol";

import {HoldbackBonds} from "./HoldbackBonds.sol";
import {IHoldbackBeacon} from "./IHoldbackBeacon.sol";
import {HoldbackTypes as H, Money} from "./HoldbackTypes.sol";

/// @title HoldbackRules
/// @notice The Holdback rules contract: the on-chain form of SimChain's escrow rules for
///         `guaranteed_on_decision`, operating Commerce Payments' AuthCaptureEscrow v1.1.0 (ADR-0003, option A).
///         Buyer funds sit in CPP's per-operator TokenStore; this contract moves them only on
///         (a) the deciding adjudicator's signed decision, (b) the buyer's signed early accept, (c) a settlement both
///         parties signed, or (d) a timeout anyone may trigger. Every entry point is permissionless: anyone relays.
/// @dev No owner, role, pause, upgrade, fallback or receive. The contract takes the settlement view (ADR-0024 §8)
///      in calldata, recomputes the commitment ID from it, and stores one word per commitment. Offer, adjudicator
///      acceptance and agreement are signatures checked at `agreeAndFund`; nothing is stored before funding.
contract HoldbackRules is EIP712 {
    // State

    enum Stage {
        None,
        Held,
        Delivered,
        FallbackJudging,
        Escalated,
        Released,
        Refunded,
        Settled,
        Expired
    }

    enum AppealState {
        None, // a first-instance decision: the window is open until appealBy
        Open,
        Upheld,
        Overturned,
        Expired,
        Closed // nothing to appeal (early accept, reclaim, default, escalation decision, mutual settlement)

    }

    /// @notice One storage word per commitment.
    struct Deal {
        Stage stage;
        uint8 attempt; // delivery attempt seen on chain (0 until a delivery is verified)
        AppealState appeal;
        uint8 flags; // F_*
        uint40 t1; // decidedAt, escalatedAt or fallbackSince
        uint40 t2; // appeal openedAt
        uint144 seedTag; // low 144 bits of the primary's seedCommitment
    }

    uint8 internal constant F_PRIMARY = 1; // primary bond encumbered for this commitment
    uint8 internal constant F_FALLBACK = 2; // the fallback's bond, reserved by its own decision
    uint8 internal constant F_BY_FALLBACK = 8; // the first-instance decision came from the fallback

    // Key release paths (ADR-0012).
    uint8 public constant KEY_DECISION = 0;
    uint8 public constant KEY_EARLY_ACCEPT = 1;
    uint8 public constant KEY_MUTUAL = 2;
    uint8 public constant KEY_APPEAL = 3;

    /// @notice Mutual settlement fee share to the sitting adjudicator (rulebook `adjudicatorFeeShareAfterDeliveryBps`).
    ///         The rulebook is not on chain, so the Phase 1 default of 0 applies; the remainder goes to the buyer.
    uint256 public constant MUTUAL_FEE_SHARE_BPS = 0;

    AuthCaptureEscrow public immutable ESCROW;
    address public immutable ERC3009_COLLECTOR;
    address public immutable PERMIT2_COLLECTOR;
    HoldbackBonds public immutable BONDS;
    /// @notice Added after the last moment a capture can happen (fallbackBy + appealDecideSec) to get CPP's
    ///         authorizationExpiry, after which only the buyer's own reclaim on CPP remains (ADR-0003).
    uint64 public immutable EXPIRY_MARGIN;
    /// @notice The beacon that fixes fallback and appeal panel seeds (ADR-0018): the drand quicknet verifier
    ///         on shared chains, the sim beacon on anvil. Fixed at deploy; it also owns the round arithmetic.
    IHoldbackBeacon public immutable BEACON;

    mapping(bytes32 commitmentId => Deal) internal _deals;

    // Events

    // ERC-8183-shaped (draft names; job ID = commitment ID).
    event JobCreated(
        bytes32 indexed jobId, address indexed client, address indexed provider, address evaluator, uint256 expiredAt
    );
    event JobFunded(bytes32 indexed jobId, address indexed client, uint256 amount);
    event JobSubmitted(bytes32 indexed jobId, address indexed provider, bytes32 deliverable);
    event JobCompleted(bytes32 indexed jobId, address indexed evaluator, bytes32 reason);
    event JobRejected(bytes32 indexed jobId, address indexed rejector, bytes32 reason);
    event JobExpired(bytes32 indexed jobId);
    event PaymentReleased(bytes32 indexed jobId, address indexed provider, uint256 amount);
    event Refunded(bytes32 indexed jobId, address indexed client, uint256 amount);

    // Holdback.
    event FeePaid(bytes32 indexed id, address indexed adjudicator, uint256 amount);
    event Paid(bytes32 indexed id, address indexed to, uint256 amount);
    event Decided(
        bytes32 indexed id,
        address indexed adjudicator,
        uint8 role,
        uint8 outcome,
        bytes32 judgmentRecordHash,
        bytes32 seed
    );
    /// @notice The buyer's sealed content key, emitted in the same transaction as the payment (ADR-0012).
    event KeyReleased(bytes32 indexed id, address indexed recipient, uint8 path, string scheme, string ciphertext);
    event FallbackTriggered(bytes32 indexed id, uint64 beaconRound);
    event Defaulted(bytes32 indexed id, Stage from);
    event AppealFiled(bytes32 indexed id, address indexed appellant, uint256 bond);
    event AppealClosed(bytes32 indexed id, AppealState verdict);
    event MutuallySettled(bytes32 indexed id, bool keyReleased);

    // Errors

    error WrongStage(Stage current);
    error WrongAppealState(AppealState current);
    error BadSignature();
    error DeadlinePassed();
    error TooEarly();
    error MessageExpired();
    error Unrepresentable();
    error InvalidMessage();
    error BadKeyProof();
    error BadSeed();

    constructor(
        AuthCaptureEscrow escrow,
        address erc3009Collector,
        address permit2Collector,
        uint64 expiryMargin,
        IHoldbackBeacon beacon
    ) {
        ESCROW = escrow;
        ERC3009_COLLECTOR = erc3009Collector;
        PERMIT2_COLLECTOR = permit2Collector;
        EXPIRY_MARGIN = expiryMargin;
        BEACON = beacon;
        BONDS = new HoldbackBonds();
    }

    // Views

    function dealOf(bytes32 id) external view returns (Deal memory) {
        return _deals[id];
    }

    /// @notice The EIP-712 digest a party signs for a struct hash under this contract's domain
    ///         ("Holdback", "0.6", chain ID, this address).
    function typedDataHash(bytes32 structHash) external view returns (bytes32) {
        return _hashTypedData(structHash);
    }

    /// @dev The CPP PaymentInfo for a commitment: derived from the terms, nothing chosen later. Not exposed (EIP-170
    ///      size); clients derive it as ADR-0025 describes.
    function _paymentInfo(bytes32 id, H.Terms calldata t)
        internal
        view
        returns (AuthCaptureEscrow.PaymentInfo memory pi)
    {
        uint256 hold = t.price + t.fee;
        uint256 expiry = uint256(t.timing.fallbackBy) + t.timing.appealDecideSec + EXPIRY_MARGIN;
        if (hold > type(uint120).max || expiry > type(uint48).max || t.timing.fundBy > type(uint48).max) {
            revert Unrepresentable();
        }
        pi = AuthCaptureEscrow.PaymentInfo({
            operator: address(this),
            payer: t.buyer,
            receiver: t.seller,
            token: t.token,
            maxAmount: uint120(hold),
            preApprovalExpiry: uint48(t.timing.fundBy),
            authorizationExpiry: uint48(expiry),
            refundExpiry: uint48(expiry),
            minFeeBps: 0,
            maxFeeBps: uint16(Money.ALL_BPS), // the fee rule is this contract's code, not CPP's bounds
            feeReceiver: address(0), // whichever adjudicator decides, chosen by this code
            salt: uint256(id)
        });
    }

    // Agree and fund (transaction 1)

    /// @notice Verifies the seller's signature over the terms, the primary's acceptance and the buyer's Agree, then
    ///         moves price + fee from the buyer into CPP's hold with the buyer's collector signature.
    function agreeAndFund(
        H.Terms calldata t,
        bytes calldata sellerSignature,
        H.Acceptance calldata acc,
        H.Agree calldata ag,
        H.Funding calldata f
    ) external returns (bytes32 id) {
        id = H.commitmentId(t);
        Deal storage d = _deals[id];
        if (d.stage != Stage.None) revert WrongStage(d.stage);
        if (block.timestamp >= t.timing.offerExpiresAt || block.timestamp >= t.timing.fundBy) revert DeadlinePassed();
        if (block.timestamp >= acc.expiresAt || block.timestamp >= ag.expiresAt) revert MessageExpired();
        if (acc.bondReserved < t.price || f.method > 1) revert InvalidMessage();
        _requireSigned(t.seller, id, sellerSignature);
        _requireSigned(t.adjudicator, H.acceptanceHash(id, t, acc), acc.signature);
        _requireSigned(t.buyer, H.agreeHash(id, t.buyer, ag), ag.signature);
        AuthCaptureEscrow.PaymentInfo memory pi = _paymentInfo(id, t);

        d.stage = Stage.Held;
        d.flags = F_PRIMARY;
        d.seedTag = uint144(uint256(acc.seedCommitment));
        // Guaranteed mode: the primary's bond covers 100% of the price, rounded up (ADR-0007, ADR-0022 rule 1).
        BONDS.encumber(t.adjudicator, t.token, Money.requirement(t.price, Money.ALL_BPS));
        emit JobCreated(id, t.buyer, t.seller, t.adjudicator, pi.authorizationExpiry);
        emit JobFunded(id, t.buyer, pi.maxAmount);
        ESCROW.authorize(pi, pi.maxAmount, f.method == 0 ? ERC3009_COLLECTOR : PERMIT2_COLLECTOR, f.signature);
    }

    // Deliver

    /// @notice Anyone posts the seller-signed delivery before deliverBy, which stops a reclaim. Optional on the happy
    ///         path: a decision or early accept may carry the delivery instead, also before deliverBy (D4: two
    ///         transactions).
    function deliver(H.Terms calldata t, H.Delivery calldata dv, bytes calldata sellerSignature) external {
        bytes32 id = H.commitmentId(t);
        Deal storage d = _deals[id];
        if (d.stage != Stage.Held) revert WrongStage(d.stage);
        _acceptDelivery(id, t, d, dv, sellerSignature);
        d.stage = Stage.Delivered;
    }

    // Decide

    /// @notice Anyone relays the adjudicator's signed decision. In `Held`, the decision carries the delivery it
    ///         judged (`dv`, `sellerSignature`), which must land before deliverBy. Outside `Held` they are ignored.
    function decide(H.Terms calldata t, H.Decision calldata m, H.Delivery calldata dv, bytes calldata sellerSignature)
        external
    {
        bytes32 id = H.commitmentId(t);
        Deal memory d = _deals[id];
        if (block.timestamp >= m.expiresAt) revert MessageExpired();
        if (d.stage == Stage.Held) {
            _acceptDelivery(id, t, _deals[id], dv, sellerSignature);
            d.stage = Stage.Delivered;
            d.attempt = dv.attempt;
        }

        // Whose turn it is, until when, and which beacon round fixes the seed (ADR-0016, ADR-0018).
        uint8 role;
        uint256 deadline;
        uint256 round;
        Stage s = d.stage;
        if (s == Stage.Delivered) {
            role = H.ROLE_PRIMARY;
            deadline = t.timing.judgeBy;
        } else if (s == Stage.FallbackJudging) {
            role = H.ROLE_FALLBACK;
            deadline = t.timing.fallbackBy;
            round = BEACON.roundAt(t.timing.judgeBy);
        } else if (s == Stage.Escalated) {
            role = H.ROLE_APPEAL;
            deadline = uint256(d.t1) + t.timing.appealDecideSec;
            round = BEACON.roundAt(d.t1) + 1;
        } else if ((s == Stage.Released || s == Stage.Refunded) && d.appeal == AppealState.Open) {
            role = H.ROLE_APPEAL;
            deadline = uint256(d.t1) + t.timing.appealWindowSec + t.timing.appealDecideSec;
            round = BEACON.roundAt(d.t2) + 1;
        } else {
            revert WrongStage(s);
        }
        // Every role judges the delivered attempt; panelSeed hashes it, so a free attempt would be a free seed.
        if (
            m.role != role || m.attempt != d.attempt
                || m.outcome > (role == H.ROLE_APPEAL ? H.OUTCOME_REJECT : H.OUTCOME_ESCALATE)
        ) {
            revert InvalidMessage();
        }
        // ADR-0012 (formal model KeyOnlyWithPayment): the buyer's key travels only with an accept, and never on a deal
        // that stands Refunded.
        if (bytes(m.keyCiphertext).length > 0 && (m.outcome != H.OUTCOME_ACCEPT || s == Stage.Refunded)) {
            revert InvalidMessage();
        }
        if (block.timestamp >= deadline) revert DeadlinePassed();
        if (role == H.ROLE_PRIMARY) {
            // The primary reveals the preimage of its seedCommitment.
            if (uint144(uint256(keccak256(abi.encodePacked(m.seed)))) != d.seedTag) revert BadSeed();
        } else if (
            m.beaconRound != round || m.beaconValue != BEACON.beaconValue(m.beaconRound, m.beaconSignature)
                || m.seed != H.panelSeed(id, role, m.attempt, m.beaconValue)
        ) {
            // The round is fixed by state; the beacon proves its value (BLS on drand quicknet); the seed follows.
            // The signature bytes are the ones the adjudicator signed: decisionHash hashes m.beaconSignature.
            revert BadSeed();
        }
        address adjudicator = role == H.ROLE_PRIMARY
            ? t.adjudicator
            : role == H.ROLE_FALLBACK ? t.fallbackAdjudicator : t.appealAdjudicator;
        _requireSigned(adjudicator, H.decisionHash(id, adjudicator, t, m), m.signature);
        emit Decided(id, adjudicator, m.role, m.outcome, m.judgmentRecordHash, m.seed);

        if (s == Stage.Escalated) _escalationDecision(id, t, d, m);
        else if (role == H.ROLE_APPEAL) _appealDecision(id, t, d, m);
        else _firstInstance(id, t, d, m, adjudicator);
    }

    function _firstInstance(bytes32 id, H.Terms calldata t, Deal memory d, H.Decision calldata m, address adjudicator)
        internal
    {
        bool primary = m.role == H.ROLE_PRIMARY;
        if (m.appealGroundHash != H.EMPTY_HASH) revert InvalidMessage();
        if (m.outcome == H.OUTCOME_ESCALATE) {
            // No money moves. Nothing is reserved for the appeal adjudicator, who signed nothing for this deal
            // (ADR-0016 §1: a sham commitment cannot lock a bond the adjudicator never reserved).
            _releaseBonds(t, d.flags);
            d.flags = 0;
            d.stage = Stage.Escalated;
            d.t1 = uint40(block.timestamp);
            _deals[id] = d;
            return;
        }
        // The decider's bond stays encumbered until the appeal closes; the primary's is released if the fallback
        // decides. The fallback reserves its own bond by deciding: uncovered, it cannot, and the deal defaults.
        _releaseBonds(t, primary ? 0 : d.flags);
        if (!primary) BONDS.encumber(t.fallbackAdjudicator, t.token, t.price);
        d.flags = primary ? F_PRIMARY : F_FALLBACK | F_BY_FALLBACK;
        d.stage = m.outcome == H.OUTCOME_ACCEPT ? Stage.Released : Stage.Refunded;
        d.appeal = AppealState.None;
        d.t1 = uint40(block.timestamp);
        _deals[id] = d;
        _settleDecision(id, t, adjudicator, m);
    }

    function _escalationDecision(bytes32 id, H.Terms calldata t, Deal memory d, H.Decision calldata m) internal {
        _releaseBonds(t, d.flags);
        d.flags = 0;
        d.stage = m.outcome == H.OUTCOME_ACCEPT ? Stage.Released : Stage.Refunded;
        d.appeal = AppealState.Closed; // a decision reached through escalation is not appealable
        _deals[id] = d;
        _settleDecision(id, t, t.appealAdjudicator, m);
    }

    /// @dev guaranteed_on_decision: the money moves at the decision. Accept: price to the seller and the fee to the
    ///      decider. Reject: a fee-only capture to the decider, then void returns the price to the buyer (ADR-0003).
    function _settleDecision(bytes32 id, H.Terms calldata t, address adjudicator, H.Decision calldata m) internal {
        AuthCaptureEscrow.PaymentInfo memory pi = _paymentInfo(id, t);
        if (m.outcome == H.OUTCOME_ACCEPT) {
            if (bytes(m.keyCiphertext).length == 0) revert InvalidMessage(); // the two-sided hold needs the key
            _capture(pi, pi.maxAmount, t.fee, t.fee == 0 ? address(0) : adjudicator);
            emit JobCompleted(id, adjudicator, m.judgmentRecordHash);
            emit PaymentReleased(id, t.seller, t.price);
            _releaseKey(id, t.buyer, KEY_DECISION, m.keyScheme, m.keyCiphertext);
        } else {
            if (t.fee > 0) _capture(pi, t.fee, t.fee, adjudicator);
            if (t.price > 0) _void(pi);
            emit JobRejected(id, adjudicator, m.judgmentRecordHash);
            emit Refunded(id, t.buyer, t.price);
        }
        if (t.fee > 0) emit FeePaid(id, adjudicator, t.fee);
    }

    /// @dev A party appeal moves bond money only; the escrow already settled at the first decision.
    function _appealDecision(bytes32 id, H.Terms calldata t, Deal memory d, H.Decision calldata m) internal {
        bool firstAccepted = d.stage == Stage.Released;
        bool upheld = (m.outcome == H.OUTCOME_ACCEPT) == firstAccepted;
        address first = d.flags & F_BY_FALLBACK != 0 ? t.fallbackAdjudicator : t.adjudicator;
        // Only the first decider's bond is still encumbered: released if upheld, paid out below if overturned.
        if (upheld) _releaseBonds(t, d.flags);
        d.flags &= F_BY_FALLBACK;
        d.appeal = upheld ? AppealState.Upheld : AppealState.Overturned;
        _deals[id] = d;
        // Upheld: the forfeited appeal bond goes to the first adjudicator's bond (ADR-0014 §2a). Overturned: back to
        // the appellant, and the first adjudicator's bond pays the wronged party the price (guaranteed mode, ADR-0007).
        BONDS.payAppealBond(id, t.token, upheld ? first : address(0));
        emit AppealClosed(id, d.appeal);
        if (!upheld) BONDS.slash(id, first, t.token, t.price, firstAccepted ? t.buyer : t.seller);
        if (bytes(m.keyCiphertext).length > 0) _releaseKey(id, t.buyer, KEY_APPEAL, m.keyScheme, m.keyCiphertext);
    }

    // Early accept

    /// @notice Anyone relays the buyer's signed early accept: the price to the seller, the fee back to the buyer
    ///         (no adjudicator judged), and the buyer's envelope from the seller-signed delivery in the same
    ///         transaction (ADR-0012).
    function earlyAccept(
        H.Terms calldata t,
        H.EarlyAccept calldata m,
        H.Delivery calldata dv,
        bytes calldata sellerSignature,
        H.KeyProof calldata k
    ) external {
        bytes32 id = H.commitmentId(t);
        Deal storage d = _deals[id];
        Stage s = d.stage;
        if (s != Stage.Held && s != Stage.Delivered) revert WrongStage(s);
        if (block.timestamp >= m.expiresAt) revert MessageExpired();
        if (s == Stage.Delivered && dv.attempt != d.attempt) revert InvalidMessage();
        if (m.attempt != dv.attempt) revert InvalidMessage();
        _requireSigned(t.buyer, H.earlyAcceptHash(id, t.buyer, m), m.signature);
        if (s == Stage.Held) _acceptDelivery(id, t, d, dv, sellerSignature);
        else _requireSigned(t.seller, H.deliveryHash(id, dv), sellerSignature);
        _requireKeyProof(t.buyer, dv.encryptedKeysHash, k);

        uint8 flags = d.flags;
        d.stage = Stage.Released;
        d.appeal = AppealState.Closed;
        d.flags = 0;
        _releaseBonds(t, flags);
        AuthCaptureEscrow.PaymentInfo memory pi = _paymentInfo(id, t);
        if (t.price > 0) _capture(pi, t.price, 0, address(0));
        if (t.fee > 0) _void(pi);
        emit JobCompleted(id, t.buyer, bytes32(0));
        emit PaymentReleased(id, t.seller, t.price);
        if (t.fee > 0) emit Refunded(id, t.buyer, t.fee);
        _releaseKey(id, t.buyer, KEY_EARLY_ACCEPT, k.scheme, k.ciphertext);
    }

    // Mutual settlement

    /// @notice A settlement both parties signed closes a funded, undecided commitment (ADR-0019, D23): the payouts
    ///         split the price; the fee goes back to the buyer (fee share 0 bps). With `releaseKey`, the buyer's
    ///         envelope from the named delivery is released in the same transaction.
    function mutualSettle(H.Terms calldata t, H.Mutual calldata m, H.Delivery calldata dv, H.KeyProof calldata k)
        external
    {
        bytes32 id = H.commitmentId(t);
        Deal storage d = _deals[id];
        Stage s = d.stage;
        if (s != Stage.Held && s != Stage.Delivered && s != Stage.FallbackJudging && s != Stage.Escalated) {
            revert WrongStage(s);
        }
        if (block.timestamp >= m.expiresAt) revert MessageExpired();
        if (!m.hasDelivery && (m.releaseKey || m.deliveryHash != bytes32(0) || s != Stage.Held)) {
            revert InvalidMessage();
        }
        bytes32 tokenHash = H.tokenIdHash(t.token);
        bytes32 structHash = H.mutualHash(id, tokenHash, m);
        _requireSigned(t.buyer, structHash, m.buyerSignature);
        _requireSigned(t.seller, structHash, m.sellerSignature);
        if (m.releaseKey) {
            if (H.deliveryHash(id, dv) != m.deliveryHash) revert BadKeyProof();
            _requireKeyProof(t.buyer, dv.encryptedKeysHash, k);
        }

        uint8 flags = d.flags;
        d.stage = Stage.Settled;
        d.appeal = AppealState.Closed;
        d.flags = 0;
        _releaseBonds(t, flags);
        _payOut(id, t, m.payouts, s);
        emit MutuallySettled(id, m.releaseKey);
        if (m.releaseKey) _releaseKey(id, t.buyer, KEY_MUTUAL, k.scheme, k.ciphertext);
    }

    function _payOut(bytes32 id, H.Terms calldata t, H.Payout[] calldata payouts, Stage s) internal {
        AuthCaptureEscrow.PaymentInfo memory pi = _paymentInfo(id, t);
        uint256 total;
        uint256 toSeller;
        uint256 captured;
        for (uint256 i; i < payouts.length; ++i) {
            H.Payout calldata p = payouts[i];
            if (p.amount == 0) revert InvalidMessage();
            total += p.amount;
            if (p.to == t.seller) {
                toSeller += p.amount;
            } else if (p.to != t.buyer) {
                // An all-fee capture pays any address (maxFeeBps = 10000, feeReceiver = 0).
                captured += p.amount;
                _capture(pi, p.amount, p.amount, p.to);
                emit Paid(id, p.to, p.amount);
            }
        }
        if (total != t.price) revert InvalidMessage();
        if (toSeller > 0) {
            _capture(pi, toSeller, 0, address(0));
            emit PaymentReleased(id, t.seller, toSeller);
        }
        // ADR-0022 rule 2: the fee share rounds down to the sitting adjudicator, the remainder to the buyer.
        (uint256 share,) = Money.split(t.fee, MUTUAL_FEE_SHARE_BPS);
        if (share > 0) {
            address sitting = s == Stage.FallbackJudging
                ? t.fallbackAdjudicator
                : s == Stage.Escalated ? t.appealAdjudicator : t.adjudicator;
            _capture(pi, share, share, sitting);
            emit FeePaid(id, sitting, share);
        }
        // Everything still held (the buyer's payouts and the fee remainder) goes back to the buyer.
        uint256 rest = pi.maxAmount - captured - toSeller - share;
        if (rest > 0) {
            _void(pi);
            emit Refunded(id, t.buyer, rest);
        }
    }

    // Appeal

    /// @notice Anyone relays a party's signed appeal against a first-instance decision before appealBy. The bond
    ///         is pulled from the appellant (ERC-20 allowance to BONDS) and held until the appeal closes.
    function fileAppeal(H.Terms calldata t, H.Appeal calldata a) external {
        bytes32 id = H.commitmentId(t);
        Deal storage d = _deals[id];
        if (d.stage != Stage.Released && d.stage != Stage.Refunded) revert WrongStage(d.stage);
        if (d.appeal != AppealState.None) revert WrongAppealState(d.appeal);
        if (block.timestamp >= uint256(d.t1) + t.timing.appealWindowSec) revert DeadlinePassed();
        // Only the party the decision went against appeals (T-206 L-7): outcomes are binary, and one slot taken by
        // the favoured party would shut out the party with something to win.
        if (a.appellant != (d.stage == Stage.Released ? 0 : 1)) revert InvalidMessage();
        address appellant = a.appellant == 0 ? t.buyer : t.seller;
        _requireSigned(appellant, H.appealHash(id, appellant, H.tokenIdHash(t.token), a), a.signature);
        d.appeal = AppealState.Open;
        d.t2 = uint40(block.timestamp);
        BONDS.takeAppealBond(id, appellant, t.token, a.bond);
        emit AppealFiled(id, appellant, a.bond);
    }

    // Timeouts (TimeoutKind), anyone may call

    /// @notice expire_offer: after offerExpiresAt or fundBy nothing can fund the commitment; this records it.
    function expireOffer(H.Terms calldata t) external {
        bytes32 id = H.commitmentId(t);
        Deal storage d = _deals[id];
        if (d.stage != Stage.None) revert WrongStage(d.stage);
        if (block.timestamp < t.timing.offerExpiresAt && block.timestamp < t.timing.fundBy) revert TooEarly();
        d.stage = Stage.Expired;
        emit JobExpired(id);
    }

    /// @notice reclaim: nothing delivered on chain by deliverBy; price + fee back to the buyer.
    function reclaim(H.Terms calldata t) external {
        bytes32 id = H.commitmentId(t);
        Deal storage d = _deals[id];
        if (d.stage != Stage.Held) revert WrongStage(d.stage);
        if (block.timestamp < t.timing.deliverBy) revert TooEarly();
        _refundAll(id, t, d);
        emit JobExpired(id);
    }

    /// @notice fallback: the primary missed judgeBy; the fallback adjudicator takes over.
    function triggerFallback(H.Terms calldata t) external {
        bytes32 id = H.commitmentId(t);
        Deal storage d = _deals[id];
        if (d.stage != Stage.Delivered) revert WrongStage(d.stage);
        if (block.timestamp < t.timing.judgeBy) revert TooEarly();
        d.stage = Stage.FallbackJudging;
        d.t1 = uint40(block.timestamp);
        emit FallbackTriggered(id, BEACON.roundAt(t.timing.judgeBy));
    }

    /// @notice default and apply_default in one call: the fallback missed fallbackBy, or the
    ///         appeal adjudicator missed appealDecideBy after an escalation; price + fee back to the buyer. Seller
    ///         compensation from bonds is Phase 4.
    function triggerDefault(H.Terms calldata t) external {
        bytes32 id = H.commitmentId(t);
        Deal storage d = _deals[id];
        Stage s = d.stage;
        if (s == Stage.FallbackJudging) {
            if (block.timestamp < t.timing.fallbackBy) revert TooEarly();
        } else if (s == Stage.Escalated) {
            if (block.timestamp < uint256(d.t1) + t.timing.appealDecideSec) revert TooEarly();
        } else {
            revert WrongStage(s);
        }
        emit Defaulted(id, s);
        _refundAll(id, t, d);
    }

    /// @notice appeal_expiry: the appeal window closed with no appeal, or an open appeal went undecided (the bond
    ///         goes back to the appellant; the first decision stands). Releases the decider's bond.
    function expireAppeal(H.Terms calldata t) external {
        bytes32 id = H.commitmentId(t);
        Deal storage d = _deals[id];
        if (d.stage != Stage.Released && d.stage != Stage.Refunded) revert WrongStage(d.stage);
        uint256 appealBy = uint256(d.t1) + t.timing.appealWindowSec;
        AppealState a = d.appeal;
        if (a == AppealState.None) {
            if (block.timestamp < appealBy) revert TooEarly();
        } else if (a == AppealState.Open) {
            if (block.timestamp < appealBy + t.timing.appealDecideSec) revert TooEarly();
        } else {
            revert WrongAppealState(a);
        }
        uint8 flags = d.flags;
        d.appeal = AppealState.Expired;
        d.flags = flags & F_BY_FALLBACK;
        _releaseBonds(t, flags);
        if (a == AppealState.Open) BONDS.payAppealBond(id, t.token, address(0));
        emit AppealClosed(id, AppealState.Expired);
    }

    // Internals

    function _refundAll(bytes32 id, H.Terms calldata t, Deal storage d) internal {
        uint8 flags = d.flags;
        d.stage = Stage.Refunded;
        d.appeal = AppealState.Closed;
        d.flags = 0;
        _releaseBonds(t, flags);
        AuthCaptureEscrow.PaymentInfo memory pi = _paymentInfo(id, t);
        // From authorizationExpiry the buyer may have reclaimed on CPP already (ADR-0003's backstop). The deal still
        // closes here, so the bonds above are never stranded; there is just nothing left to void.
        if (block.timestamp >= pi.authorizationExpiry) {
            (, uint120 held,) = ESCROW.paymentState(ESCROW.getHash(pi));
            if (held == 0) return;
        }
        _void(pi);
        emit Refunded(id, t.buyer, pi.maxAmount);
    }

    /// @dev Verifies the seller-signed delivery for attempt 1 (core: maxSubmissions is 1 in Phases 1 and 2). Whichever
    ///      call lands it (deliver, or a decision or early accept that carries it), it must land before deliverBy, as
    ///      in SimChain; otherwise it races the reclaim.
    function _acceptDelivery(
        bytes32 id,
        H.Terms calldata t,
        Deal storage d,
        H.Delivery calldata dv,
        bytes calldata sellerSignature
    ) internal {
        if (block.timestamp >= t.timing.deliverBy) revert DeadlinePassed();
        if (dv.attempt != 1) revert InvalidMessage();
        bytes32 dh = H.deliveryHash(id, dv);
        _requireSigned(t.seller, dh, sellerSignature);
        d.attempt = dv.attempt;
        emit JobSubmitted(id, t.seller, dh);
    }

    function _requireKeyProof(address recipient, bytes32 keysHash, H.KeyProof calldata k) internal pure {
        if (k.index >= k.keyHashes.length || k.keyHashes[k.index] != H.encryptedKeyHash(recipient, k)) {
            revert BadKeyProof();
        }
        if (keccak256(abi.encodePacked(k.keyHashes)) != keysHash) revert BadKeyProof();
    }

    function _capture(AuthCaptureEscrow.PaymentInfo memory pi, uint256 amount, uint256 fee, address feeReceiver)
        internal
    {
        ESCROW.capture(pi, amount, fee, feeReceiver);
    }

    function _releaseKey(bytes32 id, address to, uint8 path, string calldata scheme, string calldata ciphertext)
        internal
    {
        emit KeyReleased(id, to, path, scheme, ciphertext);
    }

    function _void(AuthCaptureEscrow.PaymentInfo memory pi) internal {
        ESCROW.void(pi);
    }

    function _releaseBonds(H.Terms calldata t, uint8 flags) internal {
        if (flags & F_PRIMARY != 0) BONDS.release(t.adjudicator, t.token, t.price);
        if (flags & F_FALLBACK != 0) BONDS.release(t.fallbackAdjudicator, t.token, t.price);
    }

    function _requireSigned(address signer, bytes32 structHash, bytes calldata signature) internal view {
        if (!SignatureCheckerLib.isValidSignatureNowCalldata(signer, _hashTypedData(structHash), signature)) {
            revert BadSignature();
        }
    }

    function _domainNameAndVersion() internal pure override returns (string memory, string memory) {
        return ("Holdback", "0.6");
    }
}
