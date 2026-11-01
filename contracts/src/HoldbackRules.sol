// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AuthCaptureEscrow} from "commerce-payments/AuthCaptureEscrow.sol";
import {EIP712} from "solady/utils/EIP712.sol";
import {SignatureCheckerLib} from "solady/utils/SignatureCheckerLib.sol";

/// @title HoldbackRules (T-201 spike)
/// @notice A minimal Holdback rules contract acting as the operator of Commerce Payments' AuthCaptureEscrow v1.1.0.
///         It moves held funds only on (a) the named adjudicator's signed decision, (b) the buyer's signed early
///         accept, or (c) a timeout anyone can trigger after `decideBy`. Every entry point is permissionless: anyone
///         may relay the signed messages. There is no owner, role, pause, upgrade path, fallback or receive, and the
///         contract never holds funds (custody stays in CPP's per-operator TokenStore).
/// @dev Spike scope (ADR-0003, T-201). Not the full rules contract (T-202): no appeal, fallback adjudicator, bonds,
///      settlement modes, key release, mutual settlement or ERC-8183 events.
contract HoldbackRules is EIP712 {
    /// @notice What buyer and seller agreed. Its EIP-712 struct hash is the CPP `salt`, so the buyer's ERC-3009
    ///         funding signature commits to every term below (and to this contract as operator).
    struct Terms {
        bytes32 commitmentId;
        address buyer;
        address seller;
        address adjudicator;
        address token;
        uint120 price; // base units
        uint120 adjudicationFee; // base units, paid to the adjudicator that decides, on accept and on reject
        uint48 fundBy; // CPP preApprovalExpiry: last moment funding can land
        uint48 decideBy; // from here anyone may trigger the default outcome (refund)
        uint48 holdExpiry; // CPP authorizationExpiry = refundExpiry: after it, only the buyer's reclaim remains
    }

    enum Stage {
        None,
        Held,
        Settled
    }

    bytes32 public constant TERMS_TYPEHASH = keccak256(
        "Terms(bytes32 commitmentId,address buyer,address seller,address adjudicator,address token,uint120 price,uint120 adjudicationFee,uint48 fundBy,uint48 decideBy,uint48 holdExpiry)"
    );
    bytes32 internal constant DECISION_TYPEHASH = keccak256("Decision(bytes32 terms,bool accept)");
    bytes32 internal constant EARLY_ACCEPT_TYPEHASH = keccak256("EarlyAccept(bytes32 terms)");
    uint16 internal constant ALL_BPS = 10_000;

    AuthCaptureEscrow public immutable ESCROW;
    /// @notice CPP's ERC-3009 payment collector (the buyer signs a ReceiveWithAuthorization to it).
    address public immutable COLLECTOR;

    mapping(bytes32 termsHash => Stage) internal _stage;

    event Funded(bytes32 indexed termsHash, bytes32 indexed commitmentId, uint256 price);
    event Settled(bytes32 indexed termsHash, uint8 outcome, uint256 toSeller, uint256 fee, uint256 toBuyer);

    error BadSignature();
    error WrongStage(Stage current);
    error TooEarly();
    error InvalidTerms();

    uint8 internal constant OUTCOME_ACCEPT = 1;
    uint8 internal constant OUTCOME_REJECT = 2;
    uint8 internal constant OUTCOME_EARLY_ACCEPT = 3;
    uint8 internal constant OUTCOME_TIMEOUT = 4;

    constructor(AuthCaptureEscrow escrow, address collector) {
        ESCROW = escrow;
        COLLECTOR = collector;
    }

    // ------------------------------------------------------------------ views

    function stage(bytes32 termsHash) external view returns (Stage) {
        return _stage[termsHash];
    }

    function hashTerms(Terms calldata t) public pure returns (bytes32) {
        return keccak256(abi.encode(TERMS_TYPEHASH, t));
    }

    /// @notice The CPP PaymentInfo for a deal. Everything in it is derived from the terms; nothing is chosen later.
    function paymentInfoFor(Terms calldata t) public view returns (AuthCaptureEscrow.PaymentInfo memory) {
        return AuthCaptureEscrow.PaymentInfo({
            operator: address(this),
            payer: t.buyer,
            receiver: t.seller,
            token: t.token,
            maxAmount: t.price,
            preApprovalExpiry: t.fundBy,
            authorizationExpiry: t.holdExpiry,
            refundExpiry: t.holdExpiry,
            minFeeBps: 0,
            maxFeeBps: ALL_BPS, // a reject captures the fee alone; this contract's code bounds the fee, not CPP
            feeReceiver: address(0), // the receiver is whichever adjudicator decided, chosen by this code
            salt: uint256(hashTerms(t))
        });
    }

    function decisionDigest(bytes32 termsHash, bool accept) external view returns (bytes32) {
        return _hashTypedData(keccak256(abi.encode(DECISION_TYPEHASH, termsHash, accept)));
    }

    function earlyAcceptDigest(bytes32 termsHash) external view returns (bytes32) {
        return _hashTypedData(keccak256(abi.encode(EARLY_ACCEPT_TYPEHASH, termsHash)));
    }

    // ------------------------------------------------------------------ state changes (all permissionless)

    /// @notice Anyone relays the buyer's ERC-3009 signature; funds move from the buyer into CPP's hold.
    function fund(Terms calldata t, bytes calldata buyerSignature) external {
        // Refuse only what settlement cannot process (D31): a fee above the price, or a decision window the
        // hold does not cover.
        if (t.adjudicationFee > t.price || t.decideBy > t.holdExpiry) revert InvalidTerms();
        bytes32 h = hashTerms(t);
        _requireStage(h, Stage.None);
        _stage[h] = Stage.Held;
        emit Funded(h, t.commitmentId, t.price);
        ESCROW.authorize(paymentInfoFor(t), t.price, COLLECTOR, buyerSignature);
    }

    /// @notice Anyone relays the named adjudicator's signed decision. Accept: price to the seller minus the fee to
    ///         the adjudicator. Reject: the fee alone to the adjudicator, the rest back to the buyer.
    function decide(Terms calldata t, bool accept, bytes calldata adjudicatorSignature) external {
        bytes32 h = hashTerms(t);
        bytes32 digest = _hashTypedData(keccak256(abi.encode(DECISION_TYPEHASH, h, accept)));
        if (!SignatureCheckerLib.isValidSignatureNowCalldata(t.adjudicator, digest, adjudicatorSignature)) {
            revert BadSignature();
        }
        _settleOnce(h);
        AuthCaptureEscrow.PaymentInfo memory pi = paymentInfoFor(t);
        uint256 fee = t.adjudicationFee;
        if (accept) {
            ESCROW.capture(pi, t.price, fee, fee == 0 ? address(0) : t.adjudicator);
            emit Settled(h, OUTCOME_ACCEPT, t.price - fee, fee, 0);
        } else {
            if (fee > 0) ESCROW.capture(pi, fee, fee, t.adjudicator); // fee-only capture: nothing to the seller
            if (t.price > fee) ESCROW.void(pi);
            emit Settled(h, OUTCOME_REJECT, 0, fee, t.price - fee);
        }
    }

    /// @notice Anyone relays the buyer's signed early accept: the full price to the seller, no adjudicator fee.
    function earlyAccept(Terms calldata t, bytes calldata buyerSignature) external {
        bytes32 h = hashTerms(t);
        bytes32 digest = _hashTypedData(keccak256(abi.encode(EARLY_ACCEPT_TYPEHASH, h)));
        if (!SignatureCheckerLib.isValidSignatureNowCalldata(t.buyer, digest, buyerSignature)) revert BadSignature();
        _settleOnce(h);
        ESCROW.capture(paymentInfoFor(t), t.price, 0, address(0));
        emit Settled(h, OUTCOME_EARLY_ACCEPT, t.price, 0, 0);
    }

    /// @notice Default outcome when no decision landed by `decideBy`: anyone may refund the buyer in full.
    /// @dev CPP's `void` has no deadline, so this works before and after `holdExpiry`.
    function timeout(Terms calldata t) external {
        if (block.timestamp < t.decideBy) revert TooEarly();
        bytes32 h = hashTerms(t);
        _settleOnce(h);
        ESCROW.void(paymentInfoFor(t));
        emit Settled(h, OUTCOME_TIMEOUT, 0, 0, t.price);
    }

    // ------------------------------------------------------------------ internals

    /// @dev Settle-once guard. CPP bounds the total captured by the hold but not the number or shape of captures
    ///      (with maxFeeBps = 10000 any capture can be all fee), so the rules contract enforces exactly one outcome.
    function _settleOnce(bytes32 h) internal {
        _requireStage(h, Stage.Held);
        _stage[h] = Stage.Settled;
    }

    function _requireStage(bytes32 h, Stage want) internal view {
        Stage s = _stage[h];
        if (s != want) revert WrongStage(s);
    }

    function _domainNameAndVersion() internal pure override returns (string memory, string memory) {
        return ("HoldbackRules", "0");
    }
}
