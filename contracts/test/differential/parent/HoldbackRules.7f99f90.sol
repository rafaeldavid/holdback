// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AuthCaptureEscrow} from "commerce-payments/AuthCaptureEscrow.sol";
import {EIP712} from "solady/utils/EIP712.sol";
import {SignatureCheckerLib} from "solady/utils/SignatureCheckerLib.sol";

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
        Settled
    }

    /// @notice Why a deal closed (`docs/audit/state-model.md` section 9.2). `Open` exactly while the stage is None,
    ///         Held, Delivered, FallbackJudging or Escalated; written in the storage write that closes the deal, and
    ///         never changed after. `Decided` gives Released or Refunded, `AcceptedEarly` Released, `Settled` Settled,
    ///         `Reclaimed` and `Defaulted` Refunded.
    enum Reason {
        Open,
        Decided,
        AcceptedEarly,
        Settled,
        Reclaimed,
        Defaulted
    }

    /// @notice Which adjudicator's decision closed the deal and received its fee: not `None` exactly when the reason
    ///         is `Decided`.
    enum Decider {
        None,
        Primary,
        Fallback,
        Appeal
    }

    /// @notice One storage word per commitment. Phase one has no party appeal and no bond (ADR-0031 §8): the first
    ///         decision by the primary or the fallback, and an escalation's decision, are final when written.
    struct Deal {
        Stage stage;
        uint8 attempt; // delivery attempt seen on chain (0 until a delivery is verified)
        uint40 t1; // decidedAt, escalatedAt or fallbackSince
        uint144 seedTag; // H.seedTag(the primary's seedCommitment, the commitment ID) (L-4)
        Reason reason; // why the deal closed; Open while it is open (RF-4)
        Decider decider; // whose decision closed it; None unless the reason is Decided (RF-4)
    }

    // Key release paths (ADR-0012).
    uint8 public constant KEY_DECISION = 0;
    uint8 public constant KEY_EARLY_ACCEPT = 1;
    uint8 public constant KEY_MUTUAL = 2;

    /// @notice Mutual settlement fee share to the sitting adjudicator (rulebook `adjudicatorFeeShareAfterDeliveryBps`).
    ///         The rulebook is not on chain, so the default of 0 applies: `_payOut` returns the whole fee to the buyer.
    ///         No code here reads it; the getter stays in the ABI, and `Postings.fuzz.t.sol` fails if it leaves 0.
    uint256 public constant MUTUAL_FEE_SHARE_BPS = 0;

    AuthCaptureEscrow public immutable ESCROW;
    /// @notice CPP's ERC-3009 collector, the one way a phase-one deal funds (ADR-0031 §3, SC-2).
    address public immutable ERC3009_COLLECTOR;
    /// @notice Added after the last moment a capture can happen (fallbackBy + appealDecideSec) to get CPP's
    ///         authorizationExpiry, after which only the payment address's own reclaim on CPP remains (ADR-0003).
    uint64 public immutable EXPIRY_MARGIN;
    /// @notice The beacon that fixes fallback and escalation panel seeds (ADR-0018): the drand quicknet verifier
    ///         on shared chains, the sim beacon on anvil. Fixed at deploy; it also owns the round arithmetic.
    IHoldbackBeacon public immutable BEACON;
    /// @notice The one settlement token this deployment serves, fixed at deploy (ADR-0031 §2, SC-1). Terms that name
    ///         another token never fund here; a second token needs a second deployment, and so another signing domain.
    address public immutable TOKEN;

    mapping(bytes32 commitmentId => Deal) internal _deals;
    /// @notice The posted delivery's hash (the EIP-712 struct hash of the seller's Delivery, as `JobSubmitted` emits
    ///         it), written by whichever call lands the delivery. Every decision, early accept and mutual settlement
    ///         after it must name this hash (ADR-0029).
    mapping(bytes32 commitmentId => bytes32) public deliveryHashOf;

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
    event MutuallySettled(bytes32 indexed id, bool keyReleased);
    /// @notice Where this deal's money comes from and goes (ADR-0033): the escrow's payer and receiver. Every other
    ///         event names the parties (`buyer`, `seller`), which sign; these two addresses hold the money.
    event SettlementAddresses(
        bytes32 indexed id, address indexed buyerPaymentAddress, address indexed sellerPayoutAddress
    );

    // Errors

    error WrongStage(Stage current);
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
        uint64 expiryMargin,
        IHoldbackBeacon beacon,
        address token
    ) {
        ESCROW = escrow;
        ERC3009_COLLECTOR = erc3009Collector;
        EXPIRY_MARGIN = expiryMargin;
        BEACON = beacon;
        TOKEN = token;
    }

    // Views

    function dealOf(bytes32 id) external view returns (Deal memory) {
        return _deals[id];
    }

    /// @notice The EIP-712 digest a party signs for a struct hash under this contract's domain
    ///         ("Holdback", "0.8", chain ID, this address).
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
        uint256 expiry = _escrowExpiry(t);
        if (hold > type(uint120).max || expiry > type(uint48).max || t.timing.fundBy > type(uint48).max) {
            revert Unrepresentable();
        }
        pi = AuthCaptureEscrow.PaymentInfo({
            operator: address(this),
            payer: t.buyerPaymentAddress, // funds the hold; every void returns there (ADR-0033)
            receiver: t.sellerPayoutAddress, // every capture's amount net of the fee goes there (ADR-0033)
            token: TOKEN, // equal to t.token for every funded deal: agreeAndFund refuses any other
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
    ///         moves price + fee from the buyer's payment address into CPP's hold with that address's ERC-3009
    ///         signature for the collector (ADR-0033 §3).
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
        // Phase one has no bond (ADR-0031 §8, point 2): the acceptance must say that nothing is reserved. The terms
        // must name this deployment's token (§2, SC-1); every later step finds the deal by the ID that hashes it.
        if (acc.bondReserved != 0 || t.token != TOKEN) revert InvalidMessage();
        // Terms settlement cannot process (ADR-0031 §6, SC-5), refused as packages/core refuses them: the five deadlines
        // strictly in order, compared as timing.ts compares them (an equal pair would give a step a window of zero);
        // one delivery attempt, the only one this contract takes; an escalation window of at least one second; and an
        // appeal window of 0, because phase one has no party appeal (ADR-0033 §2b; core's APPEAL_WINDOW_PROBLEM).
        H.Timing calldata tm = t.timing;
        if (
            tm.offerExpiresAt >= tm.fundBy || tm.fundBy >= tm.deliverBy || tm.deliverBy >= tm.judgeBy
                || tm.judgeBy >= tm.fallbackBy || tm.maxSubmissions != 1 || tm.appealDecideSec == 0
                || tm.appealWindowSec != 0
        ) {
            revert InvalidMessage();
        }
        _requireSigned(t.seller, id, sellerSignature);
        _requireSigned(t.adjudicator, H.acceptanceHash(id, t, acc), acc.signature);
        _requireSigned(t.buyer, H.agreeHash(id, t.buyer, ag), ag.signature);
        AuthCaptureEscrow.PaymentInfo memory pi = _paymentInfo(id, t);

        d.stage = Stage.Held;
        d.seedTag = H.seedTag(acc.seedCommitment, id);
        emit JobCreated(id, t.buyer, t.seller, t.adjudicator, pi.authorizationExpiry);
        emit JobFunded(id, t.buyer, pi.maxAmount);
        emit SettlementAddresses(id, t.buyerPaymentAddress, t.sellerPayoutAddress);
        ESCROW.authorize(pi, pi.maxAmount, ERC3009_COLLECTOR, f.signature);
    }

    // Deliver

    /// @notice Anyone posts the seller-signed delivery before deliverBy, which stops a reclaim. Optional on the happy
    ///         path: a decision or early accept may carry the delivery instead, also before deliverBy (D4: two
    ///         transactions).
    function deliver(H.Terms calldata t, H.Delivery calldata dv, bytes calldata sellerSignature) external {
        bytes32 id = H.commitmentId(t);
        Deal storage d = _deals[id];
        if (d.stage != Stage.Held) revert WrongStage(d.stage);
        _acceptDelivery(id, t, dv, sellerSignature);
        (d.stage, d.attempt) = (Stage.Delivered, dv.attempt);
    }

    // Decide

    /// @notice Anyone relays the adjudicator's signed decision. In `Held`, the decision carries the delivery it
    ///         judged (`dv`, `sellerSignature`), which must land before deliverBy. Outside `Held` they are ignored.
    /// @dev RF-2 (T-375): the deal's word is read once, here, into `d`, and every path writes it once, in
    ///      `_firstInstance` or `_escalationDecision`, before any token moves. No helper reads or writes the word in
    ///      between: `_acceptDelivery` stores only the delivery's hash, and the attempt travels in `d`.
    function decide(H.Terms calldata t, H.Decision calldata m, H.Delivery calldata dv, bytes calldata sellerSignature)
        external
    {
        bytes32 id = H.commitmentId(t);
        Deal memory d = _deals[id];
        if (block.timestamp >= m.expiresAt) revert MessageExpired();
        if (d.stage == Stage.Held) {
            _acceptDelivery(id, t, dv, sellerSignature);
            (d.stage, d.attempt) = (Stage.Delivered, dv.attempt);
        }

        Stage s = d.stage;
        (uint8 role, uint256 deadline, uint256 round) = _turn(t, s, d.t1);
        // Every role judges the delivered attempt; panelSeed hashes it, so a free attempt would be a free seed. Every
        // role also names the posted delivery, so a decision about another seller-signed body never settles (ADR-0029).
        if (
            m.role != role || m.attempt != d.attempt || m.deliveryHash != deliveryHashOf[id]
                || m.outcome > (role == H.ROLE_APPEAL ? H.OUTCOME_REJECT : H.OUTCOME_ESCALATE)
        ) {
            revert InvalidMessage();
        }
        // ADR-0012 (formal model KeyOnlyWithPayment): the buyer's key travels only with an accept.
        if (bytes(m.keyCiphertext).length > 0 && m.outcome != H.OUTCOME_ACCEPT) revert InvalidMessage();
        if (block.timestamp >= deadline) revert DeadlinePassed();
        if (role == H.ROLE_PRIMARY) {
            // The primary reveals the preimage of its seedCommitment, checked through the deal's tag (L-4).
            if (H.seedTag(keccak256(abi.encodePacked(m.seed)), id) != d.seedTag) revert BadSeed();
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
        else _firstInstance(id, t, d, m, adjudicator);
    }

    /// @dev Whose turn stage `s` is, until when, and which beacon round fixes the seed (ADR-0016, ADR-0018): the
    ///      primary in Delivered, until judgeBy; the fallback in FallbackJudging, until fallbackBy, on judgeBy's round;
    ///      the appeal adjudicator in Escalated, until the escalation's time t1 plus appealDecideSec, on the first round
    ///      after t1. Any other stage has no turn.
    function _turn(H.Terms calldata t, Stage s, uint40 t1)
        internal
        view
        returns (uint8 role, uint256 deadline, uint256 round)
    {
        if (s == Stage.Delivered) {
            (role, deadline) = (H.ROLE_PRIMARY, t.timing.judgeBy);
        } else if (s == Stage.FallbackJudging) {
            (role, deadline, round) = (H.ROLE_FALLBACK, t.timing.fallbackBy, _fallbackRound(t));
        } else if (s == Stage.Escalated) {
            (role, deadline, round) = (H.ROLE_APPEAL, _escalationDecideBy(t, t1), _escalationRound(t1));
        } else {
            revert WrongStage(s);
        }
    }

    /// @dev The primary's or the fallback's decision. An accept or a reject is final when written (phase one has no
    ///      party appeal, ADR-0031 §8); an escalation hands the case to the appeal adjudicator and moves no money.
    function _firstInstance(bytes32 id, H.Terms calldata t, Deal memory d, H.Decision calldata m, address adjudicator)
        internal
    {
        if (m.appealGroundHash != H.EMPTY_HASH) revert InvalidMessage();
        if (m.outcome == H.OUTCOME_ESCALATE) {
            d.stage = Stage.Escalated;
            d.t1 = uint40(block.timestamp);
            _deals[id] = d;
            return;
        }
        d.stage = m.outcome == H.OUTCOME_ACCEPT ? Stage.Released : Stage.Refunded;
        d.t1 = uint40(block.timestamp);
        (d.reason, d.decider) = (Reason.Decided, m.role == H.ROLE_PRIMARY ? Decider.Primary : Decider.Fallback);
        _deals[id] = d;
        _settleDecision(id, t, adjudicator, m);
    }

    /// @dev The appeal adjudicator's decision on an escalated case, final when written.
    function _escalationDecision(bytes32 id, H.Terms calldata t, Deal memory d, H.Decision calldata m) internal {
        d.stage = m.outcome == H.OUTCOME_ACCEPT ? Stage.Released : Stage.Refunded;
        (d.reason, d.decider) = (Reason.Decided, Decider.Appeal);
        _deals[id] = d;
        _settleDecision(id, t, t.appealAdjudicator, m);
    }

    /// @dev guaranteed_on_decision: the money moves at the decision. Accept: price to the seller's payout address and
    ///      the fee to the decider. Reject: a fee-only capture to the decider, then void returns the price to the buyer's
    ///      payment address (ADR-0003, ADR-0033).
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

    // Early accept

    /// @notice Anyone relays the buyer's signed early accept: the price to the seller, the fee back to the buyer
    ///         (no adjudicator judged), and the buyer's envelope from the delivery the buyer named, in the same
    ///         transaction (ADR-0012, ADR-0029). In `Held` the call carries that delivery, seller-signed; after
    ///         `deliver` it carries the posted one, whose signature was checked when it landed.
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
        _requireSigned(t.buyer, H.earlyAcceptHash(id, t.buyer, m), m.signature);
        bytes32 dh = s == Stage.Held ? _acceptDelivery(id, t, dv, sellerSignature) : H.deliveryHash(id, dv);
        if (s == Stage.Held) d.attempt = dv.attempt;
        // The buyer names the delivery it opened; the carried delivery must be it and the posted one (ADR-0029).
        if (m.attempt != dv.attempt || m.deliveryHash != dh || dh != deliveryHashOf[id]) revert InvalidMessage();
        _requireKeyProof(t.buyer, dv.encryptedKeysHash, k);

        (d.stage, d.reason) = (Stage.Released, Reason.AcceptedEarly);
        AuthCaptureEscrow.PaymentInfo memory pi = _paymentInfo(id, t);
        if (t.price > 0) _capture(pi, t.price, 0, address(0));
        if (t.fee > 0) _void(pi);
        emit JobCompleted(id, t.buyer, bytes32(0));
        emit PaymentReleased(id, t.seller, t.price);
        if (t.fee > 0) emit Refunded(id, t.buyer, t.fee);
        _releaseKey(id, t.buyer, KEY_EARLY_ACCEPT, k.scheme, k.ciphertext);
    }

    // Mutual settlement

    /// @notice A settlement both parties signed closes a funded, undecided commitment (ADR-0019): the payouts split the
    ///         price between the buyer and the seller (D23's payouts to other addresses are deferred past phase one,
    ///         ADR-0031 §4); the fee goes back to the buyer (fee share 0 bps). With `releaseKey`, the buyer's
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
        // After a delivery, the settlement names the posted one, as core requires (ADR-0029).
        if (s != Stage.Held && m.deliveryHash != deliveryHashOf[id]) revert InvalidMessage();
        bytes32 tokenHash = H.tokenIdHash(t.token);
        bytes32 structHash = H.mutualHash(id, tokenHash, m);
        _requireSigned(t.buyer, structHash, m.buyerSignature);
        _requireSigned(t.seller, structHash, m.sellerSignature);
        if (m.releaseKey) {
            if (H.deliveryHash(id, dv) != m.deliveryHash) revert BadKeyProof();
            _requireKeyProof(t.buyer, dv.encryptedKeysHash, k);
        }

        (d.stage, d.reason) = (Stage.Settled, Reason.Settled);
        _payOut(id, t, m.payouts);
        emit MutuallySettled(id, m.releaseKey);
        if (m.releaseKey) _releaseKey(id, t.buyer, KEY_MUTUAL, k.scheme, k.ciphertext);
    }

    /// @dev Phase one pays a settlement to the parties' money addresses only (ADR-0031 §4, ADR-0033 §2): a payout names
    ///      the seller's payout address or the buyer's payment address, and any other address reverts, a signing address
    ///      that differs from them included. So a settlement makes at most one capture, to the payout address, and one
    ///      void, to the payment address. With the two equal, every payout counts as the seller's share.
    function _payOut(bytes32 id, H.Terms calldata t, H.Payout[] calldata payouts) internal {
        AuthCaptureEscrow.PaymentInfo memory pi = _paymentInfo(id, t);
        uint256 total;
        uint256 toSeller;
        for (uint256 i; i < payouts.length; ++i) {
            H.Payout calldata p = payouts[i];
            if (p.amount == 0 || (p.to != t.sellerPayoutAddress && p.to != t.buyerPaymentAddress)) revert InvalidMessage();
            total += p.amount;
            if (p.to == t.sellerPayoutAddress) toSeller += p.amount;
        }
        if (total != t.price) revert InvalidMessage();
        if (toSeller > 0) {
            _capture(pi, toSeller, 0, address(0));
            emit PaymentReleased(id, t.seller, toSeller);
        }
        // Everything still held (the buyer's payouts and the whole fee, MUTUAL_FEE_SHARE_BPS being 0) goes back to
        // the buyer's payment address.
        uint256 rest = pi.maxAmount - toSeller;
        if (rest > 0) {
            _void(pi);
            emit Refunded(id, t.buyer, rest);
        }
    }

    // Timeouts (TimeoutKind), anyone may call

    // No expire_offer on chain (ADR-0031 §7, SC-6): an unfunded offer stores nothing, and from offerExpiresAt (or
    // fundBy) agreeAndFund refuses it, so the operators mark it expired by their own clock and send nothing.

    /// @notice reclaim: nothing delivered on chain by deliverBy; price + fee back to the buyer.
    function reclaim(H.Terms calldata t) external {
        bytes32 id = H.commitmentId(t);
        Deal storage d = _deals[id];
        if (d.stage != Stage.Held) revert WrongStage(d.stage);
        if (block.timestamp < t.timing.deliverBy) revert TooEarly();
        _refundAll(id, t, d, Reason.Reclaimed);
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
        emit FallbackTriggered(id, _fallbackRound(t));
    }

    /// @notice default and apply_default in one call: the fallback missed fallbackBy, or the
    ///         appeal adjudicator missed appealDecideBy after an escalation; price + fee back to the buyer. Phase one
    ///         has no bond, so nothing compensates the seller (ADR-0031 §8).
    function triggerDefault(H.Terms calldata t) external {
        bytes32 id = H.commitmentId(t);
        Deal storage d = _deals[id];
        Stage s = d.stage;
        if (s == Stage.FallbackJudging) {
            if (block.timestamp < t.timing.fallbackBy) revert TooEarly();
        } else if (s == Stage.Escalated) {
            if (block.timestamp < _escalationDecideBy(t, d.t1)) revert TooEarly();
        } else {
            revert WrongStage(s);
        }
        emit Defaulted(id, s);
        _refundAll(id, t, d, Reason.Defaulted);
    }

    // Internals

    // Deadlines (RF-3, T-375): each one is written once, here, and read wherever it applies, so an opposing pair (the
    // step that needs `now < X` and the timeout that needs `now >= X`) always splits time at the same instant
    // (`docs/audit/state-model.md` section 6). Every deadline sum is in 256 bits over 64-bit and 40-bit terms, so none
    // overflows. The escalation's round adds 1 in 64 bits, which the beacon's arithmetic keeps in range.
    // The terms' own deadlines (offerExpiresAt, fundBy, deliverBy, judgeBy, fallbackBy) are read from `t.timing`.

    /// @dev The appeal adjudicator's deadline on an escalation made at `t1`: the decision needs `now` before it, and
    ///      `triggerDefault` needs `now` at or after it.
    function _escalationDecideBy(H.Terms calldata t, uint40 t1) internal pure returns (uint256) {
        return uint256(t1) + t.timing.appealDecideSec;
    }

    /// @dev The escrow's expiry, its `authorizationExpiry` and `refundExpiry`: the last decision can come at
    ///      `fallbackBy + appealDecideSec` (a fallback's escalation just before fallbackBy), and the margin follows it
    ///      (ADR-0003). From it only the payment address's own reclaim on the escrow remains.
    function _escrowExpiry(H.Terms calldata t) internal view returns (uint256) {
        return uint256(t.timing.fallbackBy) + t.timing.appealDecideSec + EXPIRY_MARGIN;
    }

    /// @dev The beacon round that seeds the fallback's panel: the round at judgeBy, fixed before anyone signs.
    function _fallbackRound(H.Terms calldata t) internal view returns (uint64) {
        return BEACON.roundAt(t.timing.judgeBy);
    }

    /// @dev The beacon round that seeds the appeal adjudicator's panel on an escalation made at `t1`: the first round
    ///      after it.
    function _escalationRound(uint40 t1) internal view returns (uint64) {
        return BEACON.roundAt(t1) + 1;
    }

    function _refundAll(bytes32 id, H.Terms calldata t, Deal storage d, Reason reason) internal {
        (d.stage, d.reason) = (Stage.Refunded, reason);
        AuthCaptureEscrow.PaymentInfo memory pi = _paymentInfo(id, t);
        // From authorizationExpiry the buyer's payment address may have reclaimed on CPP already (ADR-0003's backstop). The deal still
        // closes here; there is just nothing left to void.
        if (block.timestamp >= pi.authorizationExpiry) {
            (, uint120 held,) = ESCROW.paymentState(ESCROW.getHash(pi));
            if (held == 0) return;
        }
        _void(pi);
        emit Refunded(id, t.buyer, pi.maxAmount);
    }

    /// @dev Verifies the seller-signed delivery for attempt 1 (core allows one submission: maxSubmissions is 1). Whichever
    ///      call lands it (deliver, or a decision or early accept that carries it), it must land before deliverBy, as
    ///      in SimChain; otherwise it races the reclaim. Stores and returns its hash (ADR-0029). It does not touch the
    ///      deal's word: each caller sets the attempt in its own write (RF-2, T-375).
    function _acceptDelivery(bytes32 id, H.Terms calldata t, H.Delivery calldata dv, bytes calldata sellerSignature)
        internal
        returns (bytes32 dh)
    {
        if (block.timestamp >= t.timing.deliverBy) revert DeadlinePassed();
        if (dv.attempt != 1) revert InvalidMessage();
        dh = H.deliveryHash(id, dv);
        _requireSigned(t.seller, dh, sellerSignature);
        deliveryHashOf[id] = dh;
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

    function _requireSigned(address signer, bytes32 structHash, bytes calldata signature) internal view {
        if (!SignatureCheckerLib.isValidSignatureNowCalldata(signer, _hashTypedData(structHash), signature)) {
            revert BadSignature();
        }
    }

    function _domainNameAndVersion() internal pure override returns (string memory, string memory) {
        return ("Holdback", "0.8");
    }
}
