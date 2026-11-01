// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AuthCaptureEscrow} from "commerce-payments/AuthCaptureEscrow.sol";

/// @title HoldbackRules (T-201 spike stub)
/// @notice Interface-only stub so the spike tests compile and fail before the implementation lands.
contract HoldbackRules {
    struct Terms {
        bytes32 commitmentId;
        address buyer;
        address seller;
        address adjudicator;
        address token;
        uint120 price;
        uint120 adjudicationFee;
        uint48 fundBy;
        uint48 decideBy;
        uint48 holdExpiry;
    }

    enum Stage {
        None,
        Held,
        Settled
    }

    error Unimplemented();
    error BadSignature();
    error WrongStage(Stage current);
    error TooEarly();
    error InvalidTerms();

    AuthCaptureEscrow public immutable ESCROW;
    address public immutable COLLECTOR;

    constructor(AuthCaptureEscrow escrow, address collector) {
        ESCROW = escrow;
        COLLECTOR = collector;
    }

    function stage(bytes32) external pure returns (Stage) {
        revert Unimplemented();
    }

    function hashTerms(Terms calldata) public pure returns (bytes32) {
        revert Unimplemented();
    }

    function paymentInfoFor(Terms calldata) public pure returns (AuthCaptureEscrow.PaymentInfo memory) {
        revert Unimplemented();
    }

    function decisionDigest(bytes32, bool) external pure returns (bytes32) {
        revert Unimplemented();
    }

    function earlyAcceptDigest(bytes32) external pure returns (bytes32) {
        revert Unimplemented();
    }

    function fund(Terms calldata, bytes calldata) external pure {
        revert Unimplemented();
    }

    function decide(Terms calldata, bool, bytes calldata) external pure {
        revert Unimplemented();
    }

    function earlyAccept(Terms calldata, bytes calldata) external pure {
        revert Unimplemented();
    }

    function timeout(Terms calldata) external pure {
        revert Unimplemented();
    }
}
