// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AuthCaptureEscrow} from "commerce-payments/AuthCaptureEscrow.sol";

import {IHoldbackBeacon} from "./IHoldbackBeacon.sol";
import {HoldbackTypes as H} from "./HoldbackTypes.sol";

/// @title IHoldbackRules
/// @notice Every declaration of the phase-one rules contract, `HoldbackRules`: its types, events, errors and external
///         functions, with no logic (T-384).
interface IHoldbackRules {
    // Types

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
    /// @notice A margin of 0 on a chain other than the local one (ADR-0032 §3.4): a deploy-time check on the deployer.
    error NoBeaconMargin();
    /// @notice A constructor address of zero (T-380): every immutable is fixed for the deployment's life, and one at
    ///         the zero address would leave every deal unfundable or unsettleable. A deploy-time check on the deployer.
    error ZeroAddress();

    // Constants and deployment parameters

    function KEY_DECISION() external view returns (uint8);
    function KEY_EARLY_ACCEPT() external view returns (uint8);
    function KEY_MUTUAL() external view returns (uint8);
    function MUTUAL_FEE_SHARE_BPS() external view returns (uint256);
    function ESCROW() external view returns (AuthCaptureEscrow);
    function ERC3009_COLLECTOR() external view returns (address);
    function EXPIRY_MARGIN() external view returns (uint64);
    function BEACON() external view returns (IHoldbackBeacon);
    function TOKEN() external view returns (address);
    function BEACON_MARGIN() external view returns (uint64);

    // Views

    function deliveryHashOf(bytes32 commitmentId) external view returns (bytes32);
    function dealOf(bytes32 id) external view returns (Deal memory);
    function typedDataHash(bytes32 structHash) external view returns (bytes32);

    // Transactions

    function agreeAndFund(
        H.Terms calldata t,
        bytes calldata sellerSignature,
        H.Acceptance calldata acc,
        H.Agree calldata ag,
        H.Funding calldata f
    ) external returns (bytes32 id);
    function deliver(H.Terms calldata t, H.Delivery calldata dv, bytes calldata sellerSignature) external;
    function decide(H.Terms calldata t, H.Decision calldata m, H.Delivery calldata dv, bytes calldata sellerSignature)
        external;
    function earlyAccept(
        H.Terms calldata t,
        H.EarlyAccept calldata m,
        H.Delivery calldata dv,
        bytes calldata sellerSignature,
        H.KeyProof calldata k
    ) external;
    function mutualSettle(H.Terms calldata t, H.Mutual calldata m, H.Delivery calldata dv, H.KeyProof calldata k)
        external;
    function reclaim(H.Terms calldata t) external;
    function triggerFallback(H.Terms calldata t) external;
    function triggerDefault(H.Terms calldata t) external;
}
