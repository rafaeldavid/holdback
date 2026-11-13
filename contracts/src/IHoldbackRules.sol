// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AuthCaptureEscrow} from "commerce-payments/AuthCaptureEscrow.sol";

import {IHoldbackBeacon} from "./IHoldbackBeacon.sol";
import {HoldbackTypes as H} from "./HoldbackTypes.sol";

/// @title IHoldbackRules
/// @notice The phase-one Holdback rules contract: an escrow with a neutral decider (ADR-0031). This file declares and
///         describes the contract's external surface: its types, events, errors, external functions and getters, with
///         no logic. `HoldbackRules.sol` holds the logic; `eip712Domain` (ERC-5267) comes from Solady's EIP712.
///
///         **Who may call.** Every function is open to any caller. Authority comes from the EIP-712 signatures a call
///         carries, never from `msg.sender`, so anyone may relay a signed message or trigger a timeout. There is no
///         owner, role, pause, upgrade, fallback or receive function.
///
///         **What is stored.** Nothing before funding. From `agreeAndFund` on, one word per commitment (`Deal`) and
///         the posted delivery's hash. Every call carries the deal's settlement view (`H.Terms`) in calldata; the
///         contract recomputes the commitment ID from it, so a call with altered terms names another commitment.
///
///         **The stages.** None → Held (funded) → Delivered (the delivery landed). From Delivered to
///         FallbackJudging when the primary misses `judgeBy`, and from Delivered or FallbackJudging to Escalated when
///         the primary or the fallback escalates. Every open stage closes into Released, Refunded or Settled. Held
///         closes directly by an early accept, a mutual settlement or a reclaim, and a decision that carries the
///         delivery moves a Held deal through Delivered in the same call. The closed stages are final: no call changes
///         a deal after it reaches one of them.
///
///         **The deciders.** The primary adjudicator decides in Delivered; the fallback adjudicator in FallbackJudging;
///         the appeal adjudicator, which in phase one hears escalations only, in Escalated. The first decision that
///         accepts or rejects is final. Phase one has no party appeal and no bond.
///
///         **The deadlines.** Each is a Unix time in seconds. A step needs `now < deadline`; the matching timeout,
///         where there is one, needs `now >= deadline`. The terms' five deadlines are strictly increasing, which
///         `agreeAndFund` requires:
///         - `offerExpiresAt` and `fundBy`: funding needs `now` before both (`agreeAndFund`).
///         - `deliverBy`: a delivery must land before it; from it, `reclaim` refunds an undelivered deal.
///         - `judgeBy`: the primary's deadline; from it, `triggerFallback`.
///         - `fallbackBy`: the fallback's deadline; from it, `triggerDefault`.
///         Two more follow from them:
///         - The escalation's deadline, `t1 + appealDecideSec`, where `t1` is the escalation's block time; from it,
///           `triggerDefault`. An escalation can come at any time before `judgeBy` or `fallbackBy`, so this deadline
///           is ordered only against the bound `fallbackBy + appealDecideSec`, before which every decision lands.
///         - The escrow's expiry, `fallbackBy + appealDecideSec + EXPIRY_MARGIN`. From it, the escrow refuses every
///           capture, so no call that pays the seller or an adjudicator can land; the escrow's voids still work, and
///           the buyer's payment address may also reclaim the hold on the escrow directly.
///
///         **Where the money moves.** The funds sit in Commerce Payments' AuthCaptureEscrow (CPP), with this contract
///         as the payment's operator. Each payment's payer is the buyer's payment address and its receiver the
///         seller's payout address (ADR-0033); the buyer and the seller sign, those two addresses hold the money.
///         - Funding: price + fee from the payment address into the escrow (ERC-3009 authorization).
///         - Accept (a decision): the price to the payout address, the fee to the deciding adjudicator.
///         - Reject (a decision): the fee to the deciding adjudicator, the price back to the payment address.
///         - Early accept: the price to the payout address, the fee back to the payment address.
///         - Mutual settlement: the seller's share to the payout address, the rest and the whole fee back to the
///           payment address.
///         - Reclaim and default: price + fee back to the payment address.
///         No address other than these two and the deciding adjudicator receives funds. The buyer's sealed content key
///         is emitted (`KeyReleased`) only with an accept or an early accept, which pay the seller, or in a mutual
///         settlement both parties signed with `releaseKey`.
interface IHoldbackRules {
    // Types

    /// @notice Where a deal stands. Stages only move forward, in this order; a closed stage never changes.
    /// @dev `None`: not funded (nothing stored). `Held`: funded, nothing delivered on chain. `Delivered`: the
    ///      delivery landed; the primary's turn. `FallbackJudging`: the primary missed `judgeBy` and someone
    ///      triggered the fallback; the fallback's turn. `Escalated`: the primary or the fallback escalated; the appeal
    ///      adjudicator's turn. `Released`: closed, the seller paid. `Refunded`: closed, the price back to the
    ///      buyer's payment address, and the fee too on a reclaim or a default.
    ///      `Settled`: closed by a mutual settlement.
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
    ///         is `Decided`. `Appeal` is the appeal adjudicator, which in phase one hears escalations only.
    enum Decider {
        None,
        Primary,
        Fallback,
        Appeal
    }

    /// @notice A deal's stored state, one storage word per commitment. Phase one has no party appeal and no bond
    ///         (ADR-0031 §8): an accept or a reject is final when written, whether the primary, the fallback or, after
    ///         an escalation, the appeal adjudicator decides it.
    /// @dev `stage`: where the deal stands. `attempt`: the delivery attempt that landed, 0 before one did, then 1.
    ///      `t1`: the block time of the last of these to happen: `triggerFallback`, an escalation, or a primary's or
    ///      fallback's accept or reject; 0 before any of them. An appeal adjudicator's decision, an early accept, a
    ///      settlement, a reclaim and a default leave it as it was. `seedTag`: `H.seedTag` of the primary's seed
    ///      commitment and the commitment ID, written at funding (known issue L-4). `reason` and `decider`: why the
    ///      deal closed and whose decision closed it, written with the closing stage.
    struct Deal {
        Stage stage;
        uint8 attempt;
        uint40 t1;
        uint144 seedTag;
        Reason reason;
        Decider decider;
    }

    // Events. The `Job*`, `PaymentReleased` and `Refunded` events take ERC-8183's draft names; the job ID is the
    // commitment ID. Where an event names the buyer or the seller, it names the signing address; the money went to
    // the payment address or the payout address that `SettlementAddresses` names.

    /// @notice A deal was funded.
    /// @param jobId The commitment ID.
    /// @param client The buyer.
    /// @param provider The seller.
    /// @param evaluator The primary adjudicator.
    /// @param expiredAt The escrow's expiry (`authorizationExpiry`): `fallbackBy + appealDecideSec + EXPIRY_MARGIN`.
    event JobCreated(
        bytes32 indexed jobId, address indexed client, address indexed provider, address evaluator, uint256 expiredAt
    );

    /// @notice The hold was funded, in the same transaction as `JobCreated`.
    /// @param jobId The commitment ID.
    /// @param client The buyer.
    /// @param amount price + fee, in the token's base units.
    event JobFunded(bytes32 indexed jobId, address indexed client, uint256 amount);

    /// @notice The seller-signed delivery landed, by `deliver` or carried by a decision or an early accept.
    /// @param jobId The commitment ID.
    /// @param provider The seller.
    /// @param deliverable The delivery's EIP-712 struct hash, as `deliveryHashOf` stores it.
    event JobSubmitted(bytes32 indexed jobId, address indexed provider, bytes32 deliverable);

    /// @notice The work was accepted: by an adjudicator's decision, or by the buyer's early accept.
    /// @param jobId The commitment ID.
    /// @param evaluator The deciding adjudicator, or the buyer on an early accept.
    /// @param reason The decision's judgment record hash; zero on an early accept.
    event JobCompleted(bytes32 indexed jobId, address indexed evaluator, bytes32 reason);

    /// @notice The work was rejected by an adjudicator's decision.
    /// @param jobId The commitment ID.
    /// @param rejector The deciding adjudicator.
    /// @param reason The decision's judgment record hash.
    event JobRejected(bytes32 indexed jobId, address indexed rejector, bytes32 reason);

    /// @notice `reclaim` closed an undelivered deal.
    /// @param jobId The commitment ID.
    event JobExpired(bytes32 indexed jobId);

    /// @notice An amount was paid to the seller's payout address (0 when the price is 0).
    /// @param jobId The commitment ID.
    /// @param provider The seller (its signing address; the money went to its payout address).
    /// @param amount The amount paid, in the token's base units: the price on an accept or an early accept, the
    ///        seller's share in a mutual settlement.
    event PaymentReleased(bytes32 indexed jobId, address indexed provider, uint256 amount);

    /// @notice An amount went back to the buyer's payment address (0 on a reject when the price is 0).
    /// @param jobId The commitment ID.
    /// @param client The buyer (its signing address; the money went to its payment address).
    /// @param amount The amount returned, in the token's base units: the price on a reject, the fee on an early
    ///        accept, the rest of the hold in a mutual settlement, price + fee on a reclaim or a default.
    event Refunded(bytes32 indexed jobId, address indexed client, uint256 amount);

    /// @notice The deciding adjudicator received the fee. Emitted only when the fee is above zero.
    /// @param id The commitment ID.
    /// @param adjudicator The deciding adjudicator.
    /// @param amount The fee, in the token's base units.
    event FeePaid(bytes32 indexed id, address indexed adjudicator, uint256 amount);

    /// @notice An adjudicator's signed decision was applied, before any money moves. Emitted for an escalation too.
    /// @param id The commitment ID.
    /// @param adjudicator The adjudicator whose turn it was and who signed.
    /// @param role `H.ROLE_PRIMARY`, `H.ROLE_FALLBACK` or `H.ROLE_APPEAL`.
    /// @param outcome `H.OUTCOME_ACCEPT`, `H.OUTCOME_REJECT` or `H.OUTCOME_ESCALATE`.
    /// @param judgmentRecordHash The hash of the adjudicator's judgment record, kept off chain.
    /// @param seed The panel seed: the preimage of the primary's seed commitment, or the beacon-derived seed of the
    ///        fallback or the appeal adjudicator.
    event Decided(
        bytes32 indexed id,
        address indexed adjudicator,
        uint8 role,
        uint8 outcome,
        bytes32 judgmentRecordHash,
        bytes32 seed
    );

    /// @notice The buyer's sealed content key, emitted in the same transaction as the payment it goes with
    ///         (ADR-0012).
    /// @param id The commitment ID.
    /// @param recipient The buyer.
    /// @param path `KEY_DECISION`, `KEY_EARLY_ACCEPT` or `KEY_MUTUAL`: which call released it.
    /// @param scheme The key's sealing scheme.
    /// @param ciphertext The key, sealed to the buyer's encryption key.
    event KeyReleased(bytes32 indexed id, address indexed recipient, uint8 path, string scheme, string ciphertext);

    /// @notice The fallback adjudicator took over after the primary missed `judgeBy`.
    /// @param id The commitment ID.
    /// @param beaconRound The beacon round that fixes the fallback's panel seed.
    event FallbackTriggered(bytes32 indexed id, uint64 beaconRound);

    /// @notice The deciding adjudicator missed its deadline and the deal defaulted to a refund. `Refunded` follows,
    ///         unless the buyer's payment address had already reclaimed the hold on the escrow.
    /// @param id The commitment ID.
    /// @param from The stage the deal defaulted from: FallbackJudging or Escalated.
    event Defaulted(bytes32 indexed id, Stage from);

    /// @notice A settlement both parties signed closed the deal.
    /// @param id The commitment ID.
    /// @param keyReleased Whether the settlement released the buyer's key (`KeyReleased` follows when true).
    event MutuallySettled(bytes32 indexed id, bool keyReleased);

    /// @notice Where this deal's money comes from and goes (ADR-0033): the escrow's payer and receiver. Where
    ///         another event names the buyer or the seller, it names the signing address; these two addresses hold
    ///         the money. Emitted once, at funding.
    /// @param id The commitment ID.
    /// @param buyerPaymentAddress Funds the hold and receives every refund.
    /// @param sellerPayoutAddress Receives every payment to the seller.
    event SettlementAddresses(
        bytes32 indexed id, address indexed buyerPaymentAddress, address indexed sellerPayoutAddress
    );

    // Errors. The escrow's, the token's and the beacon's own errors also pass through unchanged.

    /// @notice The call does not apply to a deal in this stage.
    /// @param current The deal's stage.
    error WrongStage(Stage current);

    /// @notice A signature does not verify for its signer under this contract's EIP-712 domain: ECDSA for an address
    ///         without code, ERC-1271 for an address with code (Solady's SignatureCheckerLib).
    error BadSignature();

    /// @notice The step's deadline has passed: funding at or after `offerExpiresAt` or `fundBy`, a delivery at or
    ///         after `deliverBy`, or a decision at or after its role's deadline.
    error DeadlinePassed();

    /// @notice A timeout was called before its deadline.
    error TooEarly();

    /// @notice A signed message's own `expiresAt` has been reached.
    error MessageExpired();

    /// @notice The terms hold a value that settlement cannot represent: a `fallbackBy` after
    ///         9999-12-31T23:59:59-23:59 (the last instant an RFC 3339 timestamp can state; the deadlines are in order,
    ///         so it bounds them all), an `appealDecideSec` above 32 bits, price + fee above 120 bits, or an escrow
    ///         expiry above 48 bits. A price + fee that does not fit 256 bits reverts with the compiler's overflow
    ///         panic instead.
    error Unrepresentable();

    /// @notice A message is malformed, contradicts the terms, or names something other than the deal's state
    ///         (another delivery, attempt, role, outcome or payout address). Each function lists its cases.
    error InvalidMessage();

    /// @notice The buyer's key proof fails: the envelope is not the buyer's, is not in the delivery's list, or the
    ///         list does not hash to the delivery's `encryptedKeysHash`; or the carried delivery is not the one named.
    error BadKeyProof();

    /// @notice A decision's seed is wrong: the primary's does not open its seed commitment, or the fallback's or
    ///         the appeal adjudicator's names another round, another beacon value, or a seed the beacon value does
    ///         not give.
    error BadSeed();

    /// @notice A beacon margin of 0 on a chain other than the local one (chain ID 31337) (ADR-0032 §3.4): a
    ///         deploy-time check on the deployer.
    error NoBeaconMargin();

    /// @notice A constructor address of zero: the escrow, the collector, the beacon or the token. A deploy-time
    ///         check on the deployer.
    error ZeroAddress();

    // Constants and deployment parameters

    /// @notice `KeyReleased.path` for a key released with an adjudicator's accept: 0.
    function KEY_DECISION() external view returns (uint8);

    /// @notice `KeyReleased.path` for a key released with the buyer's early accept: 1.
    function KEY_EARLY_ACCEPT() external view returns (uint8);

    /// @notice `KeyReleased.path` for a key released with a mutual settlement: 2.
    function KEY_MUTUAL() external view returns (uint8);

    /// @notice The fee share, in basis points, a mutual settlement pays the sitting adjudicator: 0. A settlement
    ///         returns the whole fee to the buyer's payment address.
    function MUTUAL_FEE_SHARE_BPS() external view returns (uint256);

    /// @notice The Commerce Payments AuthCaptureEscrow that holds every deal's funds, with this contract as
    ///         operator. Fixed at deploy.
    function ESCROW() external view returns (AuthCaptureEscrow);

    /// @notice CPP's ERC-3009 payment collector, the one way a phase-one deal funds (ADR-0031 §3). Fixed at deploy.
    function ERC3009_COLLECTOR() external view returns (address);

    /// @notice Seconds added to the bound on every decision's time (`fallbackBy + appealDecideSec`) to give the
    ///         escrow's expiry, from which the escrow refuses captures and the buyer's payment address may reclaim the
    ///         hold on the escrow directly (ADR-0003). Fixed at deploy; the constructor takes any value.
    function EXPIRY_MARGIN() external view returns (uint64);

    /// @notice The beacon that proves the fallback's and the appeal adjudicator's panel rounds (ADR-0018): the drand
    ///         quicknet verifier on shared chains, a sim beacon on the local chain. Fixed at deploy.
    function BEACON() external view returns (IHoldbackBeacon);

    /// @notice The one settlement token this deployment serves (ADR-0031 §2). `agreeAndFund` refuses terms that name
    ///         another token. Fixed at deploy.
    function TOKEN() external view returns (address);

    /// @notice Seconds after the last moment a party can still make a choice, from which the fallback's and the
    ///         appeal adjudicator's panel rounds are taken (ADR-0032). Above 0 on every chain but the local one; 29 s
    ///         on Ethereum mainnet and Sepolia (ADR-0032 §4). Fixed at deploy.
    function BEACON_MARGIN() external view returns (uint64);

    // Views

    /// @notice The posted delivery's EIP-712 struct hash, or zero before a delivery landed. Every later decision,
    ///         early accept and mutual settlement must name it (ADR-0029).
    /// @param commitmentId The commitment ID.
    function deliveryHashOf(bytes32 commitmentId) external view returns (bytes32);

    /// @notice A deal's stored state; all fields zero (stage None) for a commitment that was never funded.
    /// @param id The commitment ID.
    function dealOf(bytes32 id) external view returns (Deal memory);

    /// @notice The EIP-712 digest a party signs for `structHash` under this contract's domain: name "Holdback",
    ///         version "0.8", the chain ID and this contract's address.
    /// @param structHash An EIP-712 struct hash.
    function typedDataHash(bytes32 structHash) external view returns (bytes32);

    // Transactions

    /// @notice Funds a commitment: checks the seller's offer, the primary adjudicator's acceptance and the buyer's
    ///         agreement, then moves price + fee from the buyer's payment address into the escrow. Stage None → Held.
    /// @dev Refuses with
    ///      - `WrongStage` when the commitment is already funded;
    ///      - `DeadlinePassed` at or after `offerExpiresAt` or `fundBy`;
    ///      - `MessageExpired` at or after the acceptance's or the agreement's `expiresAt`;
    ///      - `InvalidMessage` when the acceptance reserves a bond (`bondReserved` not 0), the terms name another
    ///        token than `TOKEN`, the five deadlines are not strictly increasing, `maxSubmissions` is not 1,
    ///        `appealDecideSec` is 0, or `appealWindowSec` is not 0;
    ///      - `BadSignature` when the seller's, the primary's or the buyer's signature fails;
    ///      - `Unrepresentable` when a value is unrepresentable (see the error);
    ///      - the escrow's `ZeroAmount` when price + fee is 0, and the escrow's and the collector's own errors when
    ///        the ERC-3009 authorization fails;
    ///      - the compiler's overflow panic when price + fee does not fit 256 bits.
    ///      Emits `JobCreated`, `JobFunded` and `SettlementAddresses`.
    /// @param t The deal's settlement view.
    /// @param sellerSignature The seller's signature over the commitment ID (the terms' struct hash).
    /// @param acc The primary adjudicator's signed acceptance, with its seed commitment.
    /// @param ag The buyer's signed agreement.
    /// @param f The payment address's ERC-3009 authorization for the collector, for price + fee.
    /// @return id The commitment ID.
    function agreeAndFund(
        H.Terms calldata t,
        bytes calldata sellerSignature,
        H.Acceptance calldata acc,
        H.Agree calldata ag,
        H.Funding calldata f
    ) external returns (bytes32 id);

    /// @notice Posts the seller-signed delivery, which stops a reclaim. Stage Held → Delivered. Optional: a decision or
    ///         an early accept may carry the delivery instead.
    /// @dev Refuses with `WrongStage` outside Held, `DeadlinePassed` at or after `deliverBy`, `InvalidMessage` when
    ///      the attempt is not 1, and `BadSignature` when the seller's signature fails. Emits `JobSubmitted`.
    /// @param t The deal's settlement view.
    /// @param dv The delivery's field encodings.
    /// @param sellerSignature The seller's signature over the delivery's struct hash.
    function deliver(H.Terms calldata t, H.Delivery calldata dv, bytes calldata sellerSignature) external;

    /// @notice Applies the signed decision of the adjudicator whose turn it is: the primary in Delivered before
    ///         `judgeBy`, the fallback in FallbackJudging before `fallbackBy`, the appeal adjudicator in Escalated
    ///         before the escalation's deadline. An accept pays the price to the seller's payout address and the fee
    ///         to the decider, and releases the buyer's key; a reject pays the fee to the decider and returns the
    ///         price to the buyer's payment address; both are final. An escalation (primary or fallback only) moves no
    ///         money and gives the case to the appeal adjudicator: stage → Escalated, `t1` the block time.
    /// @dev In Held the call must carry the delivery the decision judged, seller-signed, before `deliverBy`; the
    ///      deal moves to Delivered first. Outside Held `dv` and `sellerSignature` are ignored. The fallback's seed
    ///      comes from the first beacon round published after `judgeBy − 1 + BEACON_MARGIN`; the appeal
    ///      adjudicator's from the first published after `t1 + BEACON_MARGIN`.
    ///      Refuses with
    ///      - `MessageExpired` at or after the decision's `expiresAt`;
    ///      - in Held, the checks `deliver` makes on the delivery (`DeadlinePassed`, `InvalidMessage`, `BadSignature`);
    ///      - `WrongStage` in None or a closed stage, where no adjudicator has a turn;
    ///      - `InvalidMessage` when the role is not the one whose turn it is, the attempt or the delivery hash is not
    ///        the posted one's, the outcome is not one the role may decide (the appeal adjudicator cannot escalate), a
    ///        key travels with an outcome other than accept, an accept carries no key, or a primary's or fallback's
    ///        decision names an appeal ground;
    ///      - `DeadlinePassed` at or after the role's deadline;
    ///      - `BadSeed` when the seed is wrong (see the error), and the beacon's own error when its proof fails;
    ///      - `BadSignature` when the adjudicator's signature fails.
    ///      Emits `JobSubmitted` (in Held) and `Decided`; then, on an accept, `JobCompleted`, `PaymentReleased` and
    ///      `KeyReleased`; on a reject, `JobRejected` and `Refunded`; on either, `FeePaid` when the fee is above zero.
    /// @param t The deal's settlement view.
    /// @param m The signed decision.
    /// @param dv The delivery judged, when the deal is in Held; ignored otherwise.
    /// @param sellerSignature The seller's signature over `dv`, when the deal is in Held; ignored otherwise.
    function decide(H.Terms calldata t, H.Decision calldata m, H.Delivery calldata dv, bytes calldata sellerSignature)
        external;

    /// @notice Applies the buyer's signed early accept: the price to the seller's payout address, the fee back to the
    ///         buyer's payment address (no adjudicator judged), and the buyer's envelope from the delivery the buyer
    ///         named, in one transaction (ADR-0012, ADR-0029). Stage Held or Delivered → Released.
    /// @dev In Held the call carries the delivery, seller-signed, before `deliverBy`; in Delivered it carries the
    ///      posted one, whose signature was checked when it landed. Refuses with
    ///      - `WrongStage` outside Held and Delivered;
    ///      - `MessageExpired` at or after the message's `expiresAt`;
    ///      - `BadSignature` when the buyer's signature fails;
    ///      - in Held, the checks `deliver` makes on the delivery (`DeadlinePassed`, `InvalidMessage`, `BadSignature`);
    ///      - `InvalidMessage` when the message's attempt or delivery hash is not the carried delivery's, or the
    ///        carried delivery is not the posted one;
    ///      - `BadKeyProof` when the key proof fails;
    ///      - the escrow's `AfterAuthorizationExpiry` from the escrow's expiry when the price is above 0: the call has
    ///        no deadline of its own, but the escrow refuses the capture;
    ///      - the escrow's `ZeroAuthorization` when the price is 0, the fee is above 0 and the payment address has
    ///        already reclaimed the hold after the escrow's expiry: the escrow refuses the void of the fee.
    ///      Emits `JobSubmitted` (in Held), `JobCompleted`, `PaymentReleased`, `Refunded` (when the fee is above zero)
    ///      and `KeyReleased`.
    /// @param t The deal's settlement view.
    /// @param m The buyer's signed early accept.
    /// @param dv The delivery the buyer opened.
    /// @param sellerSignature The seller's signature over `dv`, when the deal is in Held; ignored otherwise.
    /// @param k The buyer's envelope and the delivery's list of envelope hashes.
    function earlyAccept(
        H.Terms calldata t,
        H.EarlyAccept calldata m,
        H.Delivery calldata dv,
        bytes calldata sellerSignature,
        H.KeyProof calldata k
    ) external;

    /// @notice Applies a settlement both parties signed to a funded deal that has not closed (ADR-0019): the payouts
    ///         split the price between the seller's payout address and the buyer's payment address, and the whole fee
    ///         goes back to the payment address. With `releaseKey`, the buyer's envelope from the named delivery is
    ///         released in the same transaction. Stage Held, Delivered, FallbackJudging or Escalated → Settled.
    /// @dev A payout names the payout address or the payment address only. When the two are the same address, every
    ///      payout counts as the seller's share. Refuses with
    ///      - `WrongStage` in None or a closed stage;
    ///      - `MessageExpired` at or after the settlement's `expiresAt`;
    ///      - `InvalidMessage` when a settlement without a delivery releases the key, names a delivery hash or comes
    ///        after a delivery; when, after a delivery, it names another delivery than the posted one; when a payout
    ///        is zero or names another address; or when the payouts do not add up to the price;
    ///      - `BadSignature` when the buyer's or the seller's signature fails;
    ///      - `BadKeyProof`, with `releaseKey`, when `dv` is not the named delivery or the key proof fails;
    ///      - the escrow's `AfterAuthorizationExpiry` from the escrow's expiry when the seller's share is above 0, and
    ///        its `ZeroAuthorization` when the payment address has already reclaimed the hold: the call has no
    ///        deadline of its own.
    ///      Emits `PaymentReleased` (when the seller's share is above zero), `Refunded` (when anything is returned),
    ///      `MutuallySettled`, and `KeyReleased` with `releaseKey`.
    /// @param t The deal's settlement view.
    /// @param m The settlement, signed by the buyer and the seller.
    /// @param dv The named delivery, read only with `releaseKey`.
    /// @param k The buyer's envelope and the delivery's list of envelope hashes, read only with `releaseKey`.
    function mutualSettle(H.Terms calldata t, H.Mutual calldata m, H.Delivery calldata dv, H.KeyProof calldata k)
        external;

    /// @notice Timeout: nothing was delivered on chain by `deliverBy`; price + fee go back to the buyer's payment
    ///         address. Stage Held → Refunded.
    /// @dev Refuses with `WrongStage` outside Held and `TooEarly` before `deliverBy`. Emits `Refunded` (unless the
    ///      payment address had already reclaimed the hold on the escrow after its expiry), then `JobExpired`.
    /// @param t The deal's settlement view.
    function reclaim(H.Terms calldata t) external;

    /// @notice Timeout: the primary missed `judgeBy`; the fallback adjudicator takes over. Stage Delivered →
    ///         FallbackJudging, `t1` the block time. Moves no money.
    /// @dev Refuses with `WrongStage` outside Delivered and `TooEarly` before `judgeBy`. Emits `FallbackTriggered`
    ///      with the round that fixes the fallback's seed: the first round published after
    ///      `judgeBy − 1 + BEACON_MARGIN`.
    /// @param t The deal's settlement view.
    function triggerFallback(H.Terms calldata t) external;

    /// @notice Timeout: the fallback missed `fallbackBy`, or the appeal adjudicator missed the escalation's deadline;
    ///         price + fee go back to the buyer's payment address. Stage FallbackJudging or Escalated → Refunded.
    ///         Phase one has no bond, so nothing compensates the seller.
    /// @dev Refuses with `WrongStage` outside FallbackJudging and Escalated, and `TooEarly` before the deadline.
    ///      Emits `Defaulted`, then `Refunded` unless the payment address had already reclaimed the hold on the
    ///      escrow after its expiry.
    /// @param t The deal's settlement view.
    function triggerDefault(H.Terms calldata t) external;
}
