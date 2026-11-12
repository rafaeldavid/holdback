// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AuthCaptureEscrow} from "commerce-payments/AuthCaptureEscrow.sol";
import {EIP712} from "solady/utils/EIP712.sol";
import {SignatureCheckerLib} from "solady/utils/SignatureCheckerLib.sol";

import {IHoldbackBeacon} from "./IHoldbackBeacon.sol";
import {IHoldbackRules} from "./IHoldbackRules.sol";
import {HoldbackTypes as H, Money} from "./HoldbackTypes.sol";

/// @title HoldbackRules
/// @notice The Holdback rules contract: the on-chain form of SimChain's escrow rules for
///         `guaranteed_on_decision`, operating Commerce Payments' AuthCaptureEscrow v1.1.0 (ADR-0003, option A).
///         Buyer funds sit in CPP's per-operator TokenStore; this contract moves them only on
///         (a) the deciding adjudicator's signed decision, (b) the buyer's signed early accept, (c) a settlement both
///         parties signed, or (d) a timeout anyone may trigger. Every entry point is permissionless: anyone relays.
///         `IHoldbackRules` describes every function, event, error and type, and gives the auditor's map: the stages,
///         the deadlines in order, and where the money moves.
/// @dev No owner, role, pause, upgrade, fallback or receive. The contract takes the settlement view (ADR-0024 §8)
///      in calldata, recomputes the commitment ID from it, and stores one word per commitment. Offer, adjudicator
///      acceptance and agreement are signatures checked at `agreeAndFund`; nothing is stored before funding.
contract HoldbackRules is EIP712, IHoldbackRules {
    // State

    // Key release paths (ADR-0012).
    /// @inheritdoc IHoldbackRules
    uint8 public constant KEY_DECISION = 0;
    /// @inheritdoc IHoldbackRules
    uint8 public constant KEY_EARLY_ACCEPT = 1;
    /// @inheritdoc IHoldbackRules
    uint8 public constant KEY_MUTUAL = 2;

    /// @inheritdoc IHoldbackRules
    /// @dev The rulebook's `adjudicatorFeeShareAfterDeliveryBps` is not on chain, so its default of 0 applies. No code
    ///      here reads the constant: `_payOut` returns the whole fee. `Postings.fuzz.t.sol` fails if it leaves 0.
    uint256 public constant MUTUAL_FEE_SHARE_BPS = 0;

    /// @dev 9999-12-31T23:59:59-23:59 in unix seconds: the last instant an RFC 3339 timestamp can state (a four-digit
    ///      year and the largest offset), so the last one core's terms can carry (T-380). Later is unrepresentable.
    uint256 internal constant LAST_TIMESTAMP = 253_402_387_139;

    /// @dev anvil's chain ID: the one chain where a beacon margin of 0 deploys (ADR-0032 §3.4), as for the sim beacon.
    uint256 internal constant LOCAL_CHAIN_ID = 31337;

    /// @dev The one delivery attempt phase one takes: the terms' `maxSubmissions` and every delivery's attempt number.
    uint8 internal constant ONLY_ATTEMPT = 1;

    /// @inheritdoc IHoldbackRules
    AuthCaptureEscrow public immutable ESCROW;
    /// @inheritdoc IHoldbackRules
    address public immutable ERC3009_COLLECTOR;
    /// @inheritdoc IHoldbackRules
    uint64 public immutable EXPIRY_MARGIN;
    /// @inheritdoc IHoldbackRules
    /// @dev It also computes the rounds (`roundAt`).
    IHoldbackBeacon public immutable BEACON;
    /// @inheritdoc IHoldbackRules
    /// @dev A second token needs a second deployment, and so another signing domain.
    address public immutable TOKEN;
    /// @inheritdoc IHoldbackRules
    uint64 public immutable BEACON_MARGIN;

    /// @dev Each funded deal's word (`Deal`), by commitment ID; `dealOf` reads it. Written only by the functions that
    ///      change a deal's stage.
    mapping(bytes32 commitmentId => Deal) internal _deals;
    /// @inheritdoc IHoldbackRules
    /// @dev Written once, by whichever call lands the delivery (`_acceptDelivery`).
    mapping(bytes32 commitmentId => bytes32) public deliveryHashOf;

    /// @notice Fixes the deployment's parameters; nothing can change them later.
    /// @dev Refuses with `ZeroAddress` when the escrow, the collector, the beacon or the token is the zero address,
    ///      and with `NoBeaconMargin` when the beacon margin is 0 on a chain other than the local one (chain ID 31337).
    ///      It takes any expiry margin, and any nonzero beacon margin on any chain: the deploy script holds the table
    ///      of margins per chain (ADR-0032 §3.4). It does not check that the addresses hold code.
    /// @param escrow The Commerce Payments AuthCaptureEscrow that holds every deal's funds.
    /// @param erc3009Collector CPP's ERC-3009 payment collector.
    /// @param expiryMargin Seconds from the last possible decision to the escrow's expiry.
    /// @param beacon The beacon that proves the fallback's and the appeal adjudicator's rounds.
    /// @param token The one settlement token.
    /// @param beaconMargin Seconds from the last moment of choice to the panel round's time.
    constructor(
        AuthCaptureEscrow escrow,
        address erc3009Collector,
        uint64 expiryMargin,
        IHoldbackBeacon beacon,
        address token,
        uint64 beaconMargin
    ) {
        if (
            address(escrow) == address(0) || erc3009Collector == address(0) || address(beacon) == address(0)
                || token == address(0)
        ) revert ZeroAddress();
        if (beaconMargin == 0 && block.chainid != LOCAL_CHAIN_ID) revert NoBeaconMargin();
        ESCROW = escrow;
        ERC3009_COLLECTOR = erc3009Collector;
        EXPIRY_MARGIN = expiryMargin;
        BEACON = beacon;
        TOKEN = token;
        BEACON_MARGIN = beaconMargin;
    }

    // Views

    /// @inheritdoc IHoldbackRules
    function dealOf(bytes32 id) external view returns (Deal memory) {
        return _deals[id];
    }

    /// @inheritdoc IHoldbackRules
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
        // fundBy is below fallbackBy, which agreeAndFund bounds at the year 9999, so it always fits 48 bits.
        if (hold > type(uint120).max || expiry > type(uint48).max) revert Unrepresentable();
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

    /// @inheritdoc IHoldbackRules
    /// @dev The deal's word is written before the one state-changing external call, the escrow's `authorize`.
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
                || tm.judgeBy >= tm.fallbackBy || tm.maxSubmissions != ONLY_ATTEMPT || tm.appealDecideSec == 0
                || tm.appealWindowSec != 0
        ) {
            revert InvalidMessage();
        }
        // Values core cannot represent, refused for that reason only (D31; T-380): a deadline after the last RFC 3339
        // instant (the deadlines are in order, so fallbackBy bounds them all) and an escalation window above 32 bits,
        // core's window type. With both, an escalation's `t1` and every decision's (block times before
        // fallbackBy + appealDecideSec) fit the word's 40 bits, and the escrow's expiry fits 48 bits whenever
        // EXPIRY_MARGIN does. `triggerFallback`'s `t1` has no upper bound in time (it may run long after fallbackBy) and
        // wraps only from 2^40 s, about the year 36,812; nothing reads it but `dealOf`. A hold above 120 bits is
        // refused in `_paymentInfo`, as before.
        if (tm.fallbackBy > LAST_TIMESTAMP || tm.appealDecideSec > type(uint32).max) revert Unrepresentable();
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

    /// @inheritdoc IHoldbackRules
    /// @dev Optional on the happy path, so a deal can settle in two transactions (D4).
    function deliver(H.Terms calldata t, H.Delivery calldata dv, bytes calldata sellerSignature) external {
        bytes32 id = H.commitmentId(t);
        Deal storage d = _deals[id];
        if (d.stage != Stage.Held) revert WrongStage(d.stage);
        _acceptDelivery(id, t, dv, sellerSignature);
        (d.stage, d.attempt) = (Stage.Delivered, dv.attempt);
    }

    // Decide

    /// @inheritdoc IHoldbackRules
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
                || !H.isValidOutcome(role, m.outcome)
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

    /// @dev Whose turn stage `s` is, until when, and which beacon round fixes the seed (ADR-0016, ADR-0018, ADR-0032):
    ///      the primary in Delivered, until judgeBy; the fallback in FallbackJudging, until fallbackBy, on the first
    ///      round after judgeBy − 1 + BEACON_MARGIN; the appeal adjudicator in Escalated, until the escalation's time t1
    ///      plus appealDecideSec, on the first round after t1 + BEACON_MARGIN. Any other stage has no turn.
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

    /// @inheritdoc IHoldbackRules
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

    /// @inheritdoc IHoldbackRules
    /// @dev D23's payouts to other addresses are deferred past phase one (ADR-0031 §4).
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

    /// @inheritdoc IHoldbackRules
    function reclaim(H.Terms calldata t) external {
        bytes32 id = H.commitmentId(t);
        Deal storage d = _deals[id];
        if (d.stage != Stage.Held) revert WrongStage(d.stage);
        if (block.timestamp < t.timing.deliverBy) revert TooEarly();
        _refundAll(id, t, d, Reason.Reclaimed);
        emit JobExpired(id);
    }

    /// @inheritdoc IHoldbackRules
    function triggerFallback(H.Terms calldata t) external {
        bytes32 id = H.commitmentId(t);
        Deal storage d = _deals[id];
        if (d.stage != Stage.Delivered) revert WrongStage(d.stage);
        if (block.timestamp < t.timing.judgeBy) revert TooEarly();
        d.stage = Stage.FallbackJudging;
        d.t1 = uint40(block.timestamp);
        emit FallbackTriggered(id, _fallbackRound(t));
    }

    /// @inheritdoc IHoldbackRules
    /// @dev SimChain's `default` and `apply_default` in one call.
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
    // overflows. `_roundAfter` adds 1 in 64 bits, which the beacon's arithmetic keeps in range.
    // The terms' own deadlines (offerExpiresAt, fundBy, deliverBy, judgeBy, fallbackBy) are read from `t.timing`.

    /// @dev The appeal adjudicator's deadline on an escalation made at `t1`: the decision needs `now` before it, and
    ///      `triggerDefault` needs `now` at or after it.
    function _escalationDecideBy(H.Terms calldata t, uint40 t1) internal pure returns (uint256) {
        return uint256(t1) + t.timing.appealDecideSec;
    }

    /// @dev The escrow's expiry, its `authorizationExpiry` and `refundExpiry`: every decision lands before
    ///      `fallbackBy + appealDecideSec` (a fallback's escalation just before fallbackBy gives the latest), and the
    ///      margin follows it (ADR-0003). From it the escrow refuses captures; voids still work, and the payment
    ///      address may reclaim the hold on the escrow itself.
    function _escrowExpiry(H.Terms calldata t) internal view returns (uint256) {
        return uint256(t.timing.fallbackBy) + t.timing.appealDecideSec + EXPIRY_MARGIN;
    }

    /// @dev ADR-0032 §3.1: the first beacon round published strictly after `lastChoice + BEACON_MARGIN`, where
    ///      `lastChoice` is the last block time at which a party can still make the choice the panel's seed would
    ///      inform. On drand it is published BEACON_MARGIN + 1 to BEACON_MARGIN + 3 seconds after `lastChoice`.
    function _roundAfter(uint256 lastChoice) internal view returns (uint64) {
        return BEACON.roundAt(lastChoice + BEACON_MARGIN) + 1;
    }

    /// @dev The beacon round that seeds the fallback's panel: the first at or after judgeBy, plus the margin. The
    ///      primary's decision must land before judgeBy, so judgeBy − 1 is the last second anyone can still choose
    ///      between it and the fallback. judgeBy is at least 3 for a funded deal (the deadlines are in strict order), so
    ///      the subtraction cannot underflow.
    function _fallbackRound(H.Terms calldata t) internal view returns (uint64) {
        return _roundAfter(uint256(t.timing.judgeBy) - 1);
    }

    /// @dev The beacon round that seeds the appeal adjudicator's panel on an escalation made at `t1`: the first round
    ///      after t1 plus the margin, whoever escalated.
    function _escalationRound(uint40 t1) internal view returns (uint64) {
        return _roundAfter(t1);
    }

    /// @dev Closes the deal as Refunded with `reason`, then voids the whole hold back to the buyer's payment address
    ///      and emits `Refunded`. From the escrow's expiry the payment address may have reclaimed the hold on the
    ///      escrow already; the deal then closes with nothing to void and no `Refunded`.
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
        if (dv.attempt != ONLY_ATTEMPT) revert InvalidMessage();
        dh = H.deliveryHash(id, dv);
        _requireSigned(t.seller, dh, sellerSignature);
        deliveryHashOf[id] = dh;
        emit JobSubmitted(id, t.seller, dh);
    }

    /// @dev Requires `k` to prove the recipient's envelope: the envelope's hash, addressed to `recipient`, sits at
    ///      `k.index` of `k.keyHashes`, and the packed list hashes to the delivery's `keysHash`. Reverts `BadKeyProof`.
    function _requireKeyProof(address recipient, bytes32 keysHash, H.KeyProof calldata k) internal pure {
        if (k.index >= k.keyHashes.length || k.keyHashes[k.index] != H.encryptedKeyHash(recipient, k)) {
            revert BadKeyProof();
        }
        if (keccak256(abi.encodePacked(k.keyHashes)) != keysHash) revert BadKeyProof();
    }

    /// @dev Captures `amount` of the hold: `fee` of it to `feeReceiver`, the rest to the payment's receiver, the
    ///      seller's payout address.
    function _capture(AuthCaptureEscrow.PaymentInfo memory pi, uint256 amount, uint256 fee, address feeReceiver)
        internal
    {
        ESCROW.capture(pi, amount, fee, feeReceiver);
    }

    /// @dev Emits the buyer's sealed key (`KeyReleased`); the caller has already moved the money it goes with.
    function _releaseKey(bytes32 id, address to, uint8 path, string calldata scheme, string calldata ciphertext)
        internal
    {
        emit KeyReleased(id, to, path, scheme, ciphertext);
    }

    /// @dev Voids what is left of the hold, back to the payment's payer, the buyer's payment address.
    function _void(AuthCaptureEscrow.PaymentInfo memory pi) internal {
        ESCROW.void(pi);
    }

    /// @dev Requires `signature` to be `signer`'s over `structHash` under this contract's EIP-712 domain: ECDSA for an
    ///      address without code, ERC-1271 for one with code. Reverts `BadSignature`.
    function _requireSigned(address signer, bytes32 structHash, bytes calldata signature) internal view {
        if (!SignatureCheckerLib.isValidSignatureNowCalldata(signer, _hashTypedData(structHash), signature)) {
            revert BadSignature();
        }
    }

    /// @dev The EIP-712 domain: name "Holdback", version "0.8".
    function _domainNameAndVersion() internal pure override returns (string memory, string memory) {
        return ("Holdback", "0.8");
    }
}
