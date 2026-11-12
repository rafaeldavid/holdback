// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AuthCaptureEscrow} from "commerce-payments/AuthCaptureEscrow.sol";
import {MockERC3009Token} from "commerce-payments-test/mocks/MockERC3009Token.sol";
import {Vm} from "forge-std/Vm.sol";

import {HoldbackRules} from "../../src/HoldbackRules.sol";
import {HoldbackTypes as H} from "../../src/HoldbackTypes.sol";
import {Base} from "../unit/Base.sol";

/// @notice The party appeal of the deployed contracts (commit 64be1f1), which phase one cuts (ADR-0031 §8, SC-7).
///         Not part of the phase-one ABI: the handler calls it by selector so the side-by-side harness can drive
///         the old side's removed entry points and see the new side refuse them (T-346).
interface IDeployedAppeals {
    struct Appeal {
        uint8 appellant; // 0 = buyer, 1 = seller
        bytes32 groundsHash;
        uint256 bond;
        uint64 filedAt;
        bytes signature;
    }

    function fileAppeal(H.Terms calldata t, Appeal calldata a) external;
    function expireAppeal(H.Terms calldata t) external;
}

/// @notice The unfunded offer's on-chain expiry, which phase one cuts (ADR-0031 §7, SC-6). Not in the phase-one ABI:
///         the handler calls it by selector so the side-by-side harness can drive the parent's `expireOffer` and see
///         the new side refuse it (T-356).
interface IDeployedOffers {
    function expireOffer(H.Terms calldata t) external;
}

/// @notice The bond vault of the deployed contracts (64be1f1's HoldbackBonds), which phase one cuts. The pinned side
///         of the side-by-side harness funds it, and the harness reads it.
interface IDeployedVault {
    function deposit(address token, uint256 amount) external;
    function bondOf(address adjudicator, address token) external view returns (uint256);
    function encumberedOf(address adjudicator, address token) external view returns (uint256);
    function freeOf(address adjudicator, address token) external view returns (uint256);
    function appealBondOf(bytes32 id) external view returns (address appellant, uint96 amount);
}

/// @title RulesHandler
/// @notice T-203: the stateful-fuzzing handler for HoldbackRules. It reuses the unit fixture (`Base`: CPP v1.1.0,
///         both collectors, Permit2, mock ERC-3009 tokens) and drives random interleavings of every external function
///         and every TimeoutKind over a bounded world:
///         - seven actors: buyer, seller, three adjudicators, an operator and an unrelated address. Every call is
///           sent from one of them, and every signature is made by one of their keys;
///         - at most MAX_DEALS commitments over two tokens, with fuzzed price, fee, adjudicator roles (an address may
///           hold two roles) and timing (strictly ordered, or, one offer in 32, any order, which SC-5 refuses);
///         - forward time warps that land on, one second before or one second after every deadline.
///         Each call's outcome is checked against what the rules allow, and violations are counted in ghost
///         variables that `test/invariant/RulesInvariants.t.sol` reads. A call the rules refuse, with no violation
///         recorded, re-reverts with `Refused()` so the campaign's metrics count it as a revert (no state is lost:
///         the refused call changed nothing).
/// @dev T-346 (SC-7): phase one has no party appeal and no bond vault. The handler is written against the phase-one
///      ABI, and the side-by-side harness drives the deployed contracts (`test/differential/Sides.sol`) through the
///      same handler. Every choice an action makes (which deal, which key, which time) depends only on state both
///      builds share, so the two sides receive the same calls. Where the builds' ABIs differ, a virtual hook reads
///      the side's own form (`_dealOf`, `_deployedAppeal`, Base's `_bondReserved`), and the pinned side overrides it.
///      The three removed actions (`fileAppeal`, `expireAppeal`, `decideAppeal`) stay for the harness only: on the
///      phase-one contract they are always refused, so the invariant campaign does not target them.
contract RulesHandler is Base {
    error Refused();

    uint256 internal constant OP_PK = 0x0BE7;
    /// T-358 (ADR-0033): the buyer's payment address and the seller's payout address of a deal whose money addresses
    /// are apart from its signing addresses. The payment address signs only the funding; the payout address nothing.
    uint256 internal constant PAY_PK = 0xBA1D;
    uint256 internal constant N = 7;
    // T-341 raised it from 8 (refinement plan, gate VG-2): more deals contend for timeouts and picks at once.
    uint256 public constant MAX_DEALS = 16;
    uint256 internal constant I_OP = 5;
    uint256 internal constant I_OTHER = 6;

    // T-346: how a deal closed, recorded by the action that closed it, for the state oracle's phase-one rows
    // (`docs/audit/state-model.md` section 9.2). The word stores neither until refactor RF-4 adds the closing reason.
    uint8 public constant R_OPEN = 0;
    uint8 public constant R_DECIDED = 1;
    uint8 public constant R_ACCEPTED_EARLY = 2;
    uint8 public constant R_SETTLED = 3;
    uint8 public constant R_RECLAIMED = 4;
    uint8 public constant R_DEFAULTED = 5;
    uint8 public constant D_NONE = 0;
    uint8 public constant D_PRIMARY = 1;
    uint8 public constant D_FALLBACK = 2;
    uint8 public constant D_APPEAL = 3;

    MockERC3009Token public tusd2;
    address[N] internal _actor;
    uint256[N] internal _pk;

    H.Terms[] internal _terms_;
    bytes32[] internal _ids;
    mapping(bytes32 => uint256[3]) internal _rolePk; // primary, fallback, appeal

    // ------------------------------------------------------------ ghosts

    mapping(bytes32 => uint256) public closings; // open -> Released | Refunded | Settled transitions
    mapping(bytes32 => bool) public everClosed;
    mapping(bytes32 => bool) public cppReclaimed; // the buyer's own CPP reclaim after authorizationExpiry
    mapping(bytes32 => uint8) public closedBy; // R_*: the action that closed the deal
    mapping(bytes32 => uint8) public closedDecider; // D_*: the adjudicator whose decision closed it
    mapping(bytes32 => uint64) internal _deliverBy;
    uint8 internal _closing; // the closing reason of the action in progress, read by `_track`
    uint8 internal _decider;
    uint256 public reopened; // a closed commitment seen in an open stage again
    uint256 public unauthorisedSuccess; // a call carrying a signature from the wrong key succeeded
    uint256 public unexpectedMovement; // a call that must not move held money moved it
    uint256 public strangerSuccess; // a direct call to CPP's operator functions on a Holdback hold succeeded
    uint256 public timeoutMismatch; // a timeout succeeded before its deadline, or was refused when due
    uint256 public keyWithoutPayment; // a KeyReleased on a deal that does not stand Released or Settled
    // T-336 (known issue G-5): the liveness counter. Every delivery that lands, whichever call carries it, is counted
    // with the hash of the delivery the handler posted, so an invariant can check the chain stores exactly that hash.
    uint256 public deliveries; // deliveries that landed on chain (a deal's attempt went from 0 to 1 in Held)
    mapping(bytes32 => bytes32) public postedHash; // the hash of the delivery the handler posted, once it landed
    uint256 public deliveryHashLost; // a delivery landed but the chain does not store its hash (ADR-0029)
    uint256 public deliverRefused; // an authorised `deliver` on a Held deal before deliverBy was refused
    // T-375 (triage item 43): the liveness counter for decisions. A change that breaks the decision path and leaves
    // the stored delivery hash alone passed every invariant before it (T-336's Handoff).
    uint256 public decisions; // decisions that landed after a delivery (posted, or carried by the decision itself)
    uint256 public decideRefused; // a decision's outcome disagreed with `_timelyDecision` (refused, or landed untimely)
    string public lastViolation;

    // ------------------------------------------------------------ the trace (T-341)

    /// T-341: set only by the side-by-side harness's subclasses (`test/differential/Sides.sol`). In trace mode a
    /// refused call returns instead of re-reverting `Refused()`, so the trace below survives the call; both sides
    /// run in this mode, so they stay comparable. The invariant campaign never sets it.
    bool internal traceMode;
    bytes[] internal _calls; // every checked call's outcome, in order: abi.encode(ok, return or revert data)
    bytes[] internal _events; // every event emitted, in order: abi.encode(emitter, topics, data)
    /// T-356 (SC-1): the token of the terms the last `agreeAndFund` relayed, for the harness's allow-list.
    address public fundToken;
    /// T-356 (SC-6): offers whose expiry the parent's `expireOffer` recorded. The phase-one contract records none.
    mapping(bytes32 => bool) public offerExpired;
    /// T-356 (SC-3): whether the last `mutualSettle` relayed named a payee other than the buyer and the seller.
    bool public thirdPartyPayout;
    /// T-356 (SC-5): whether the terms the last `agreeAndFund` relayed had deadlines not in strict order.
    bool public fundOutOfOrder;
    /// T-358 (ADR-0033 §2b): whether the terms the last `agreeAndFund` relayed had an appeal window other than 0.
    bool public fundAppealWindow;

    // ------------------------------------------------------------ T-358: money addresses apart (ADR-0033)

    address public payAddr; // the payment address of the deals drawn apart
    address public payoutAddr; // their payout address
    /// A signing address (`buyer`, `seller`) changed balance in a call on a deal whose money addresses are apart.
    uint256 public signerMoved;
    uint256 internal _buyer0; // the signing addresses' balances when the action picked its deal
    uint256 internal _seller0;

    constructor() {
        setUp();
        tusd2 = new MockERC3009Token("Mock EURC", "mEURC", 6);
        _actor = [buyer, seller, adjudicator, fallbackAdj, appealAdj, vm.addr(OP_PK), vm.addr(OTHER_PK)];
        _pk = [BUYER_PK, SELLER_PK, ADJ_PK, FB_PK, AP_PK, OP_PK, OTHER_PK];
        tusd2.mint(buyer, 1_000_000_000);
        tusd2.mint(seller, 1_000_000_000);
        usdc.mint(_actor[I_OP], 100_000_000);
        tusd2.mint(_actor[I_OTHER], 100_000_000);
        payAddr = vm.addr(PAY_PK);
        payoutAddr = makeAddr("payout address");
        usdc.mint(payAddr, 1_000_000_000);
        // T-375: enough for one boundary deal whose hold is the largest uint120 (`_boundary`).
        usdc.mint(buyer, type(uint120).max);
        usdc.mint(payAddr, type(uint120).max);
        _afterSetUp();
    }

    /// The side's own world after the shared one: nothing on phase one. The pinned side funds the deployed
    /// contracts' bond vault here (`Sides.sol`).
    function _afterSetUp() internal virtual {}

    // ------------------------------------------------------------ the side's own reads (T-346)

    /// The deal's stored word in the phase-one shape. The pinned side decodes the deployed contracts' wider word.
    function _dealOf(bytes32 id) internal view virtual returns (HoldbackRules.Deal memory) {
        return rules.dealOf(id);
    }

    /// The deployed contracts' appeal fields of a deal: its appeal state, its bond flags and the appeal's filing
    /// time. Phase one has none, so all three are zero here; the pinned side reads them.
    function _deployedAppeal(bytes32) internal view virtual returns (uint8 appeal, uint8 flags, uint40 t2) {}

    // ------------------------------------------------------------ views for the invariants

    /// The rules contract, the address where the deployed contracts keep their bond vault, and the escrow. The
    /// deployed rules contract creates its vault as its first CREATE, at nonce 1; on phase one nothing is there.
    function system() external view returns (HoldbackRules, address, AuthCaptureEscrow) {
        return (rules, vault(), escrow);
    }

    function vault() public view returns (address) {
        return vm.computeCreateAddress(address(rules), 1);
    }

    /// The deal's stored word, in the phase-one shape, whichever side this is.
    function word(bytes32 id) external view returns (HoldbackRules.Deal memory) {
        return _dealOf(id);
    }

    function tokens() public view returns (address[2] memory) {
        return [address(usdc), address(tusd2)];
    }

    function actors() external view returns (address[N] memory) {
        return _actor;
    }

    /// Every address that can hold the tokens in this world. Conservation sums over exactly these. The vault's
    /// address is listed on both sides, so the two sides list the same holders.
    function holders() external view returns (address[] memory h) {
        h = new address[](N + 11);
        for (uint256 i; i < N; i++) {
            h[i] = _actor[i];
        }
        h[N] = address(escrow);
        h[N + 1] = escrow.getTokenStore(address(rules));
        h[N + 2] = vault();
        h[N + 3] = address(rules);
        h[N + 4] = address(collector3009);
        h[N + 5] = address(collectorPermit2);
        h[N + 6] = permit2;
        h[N + 7] = address(this);
        h[N + 8] = relayer;
        h[N + 9] = payAddr;
        h[N + 10] = payoutAddr;
    }

    /// T-358: whether this side's rules contract pays the terms' money addresses (ADR-0033). The pinned parent pays
    /// the signing addresses, so its sides (`Sides.sol`) draw no deal with them apart.
    function _paysMoneyAddresses() internal view virtual returns (bool) {
        return true;
    }

    /// T-358: whether deal `i`'s money addresses are apart from its signing addresses.
    function apart(uint256 i) public view returns (bool) {
        return _terms_[i].buyerPaymentAddress != _terms_[i].buyer;
    }

    /// The key that signs deal `t`'s funding: its payment address's (ADR-0033 §3).
    function _payPk(H.Terms memory t) internal view returns (uint256) {
        return t.buyerPaymentAddress == buyer ? BUYER_PK : PAY_PK;
    }

    function dealCount() external view returns (uint256) {
        return _ids.length;
    }

    function dealId(uint256 i) external view returns (bytes32) {
        return _ids[i];
    }

    function termsOf(uint256 i) external view returns (H.Terms memory) {
        return _terms_[i];
    }

    function _isOpen(HoldbackRules.Stage s) internal pure returns (bool) {
        return s == HoldbackRules.Stage.Held || s == HoldbackRules.Stage.Delivered
            || s == HoldbackRules.Stage.FallbackJudging || s == HoldbackRules.Stage.Escalated;
    }

    function _isClosed(HoldbackRules.Stage s) internal pure returns (bool) {
        return
            s == HoldbackRules.Stage.Released || s == HoldbackRules.Stage.Refunded || s == HoldbackRules.Stage.Settled;
    }

    /// What the rules state says CPP must hold for commitment i: price + fee while open, else nothing.
    function heldMirror(uint256 i) public view returns (uint256) {
        bytes32 id = _ids[i];
        if (!_isOpen(_dealOf(id).stage) || cppReclaimed[id]) return 0;
        return _terms_[i].price + _terms_[i].fee;
    }

    function capturable(uint256 i) public view returns (uint256 c) {
        (, c,) = escrow.paymentState(escrow.getHash(_pi(_terms_[i])));
    }

    /// The sum of open holds in `token`, from the rules state.
    function openHolds(address token) external view returns (uint256 sum) {
        for (uint256 i; i < _ids.length; i++) {
            if (_terms_[i].token == token) sum += heldMirror(i);
        }
    }

    /// The seed tag every funded deal stores: the low 144 bits of the primary's seed commitment, which every
    /// acceptance this handler signs carries (`Base._acceptance`). The state oracle checks it (T-341).
    function seedTag() external pure returns (uint144) {
        return uint144(uint256(keccak256(abi.encodePacked(SEED))));
    }

    /// CPP's whole payment state for commitment i (T-341: the side-by-side harness compares it).
    function holdOf(uint256 i) external view returns (bool collected, uint120 capturable_, uint120 refundable) {
        return escrow.paymentState(escrow.getHash(_pi(_terms_[i])));
    }

    /// T-341: returns the trace since the last call and clears it. The events still in the log recorder are
    /// drained first, so the trace ends with the last event of the last action.
    function takeTrace() external returns (bytes[] memory calls, bytes[] memory events) {
        _drainLogs();
        calls = _calls;
        events = _events;
        delete _calls;
        delete _events;
    }

    // ------------------------------------------------------------ helpers

    function _violations() internal view returns (uint256) {
        return reopened + unauthorisedSuccess + unexpectedMovement + strangerSuccess + timeoutMismatch
            + keyWithoutPayment + deliveryHashLost + deliverRefused + signerMoved + decideRefused;
    }

    /// Re-reverts a refused call so the metrics count it, unless the refusal itself was a violation. In trace mode
    /// it returns: the side-by-side harness reads the refusal from the trace.
    function _end(bool ok, uint256 v0) internal view {
        if (!ok && _violations() == v0 && !traceMode) revert Refused();
    }

    /// T-341: records a checked call's outcome in trace mode: abi.encode(ok, data), where data is the revert data,
    /// or on success the return data where the call site has it (`_relay`, `stranger`) and "" where it does not.
    function _note(bool ok, bytes memory data) internal {
        if (traceMode) _calls.push(abi.encode(ok, data));
    }

    /// Returns the events recorded since the last drain (and clears the recorder); in trace mode it also appends
    /// them to the trace.
    function _drainLogs() internal returns (Vm.Log[] memory logs) {
        logs = vm.getRecordedLogs();
        if (!traceMode) return logs;
        for (uint256 i; i < logs.length; i++) {
            _events.push(abi.encode(logs[i].emitter, logs[i].topics, logs[i].data));
        }
    }

    /// Starts a fresh recording for the checked call; the events recorded before it are drained into the trace
    /// first, so none is lost when `vm.recordLogs` clears them.
    function _recordLogs() internal {
        _drainLogs();
        vm.recordLogs();
    }

    function _caller(uint256 seed) internal view returns (address) {
        return _actor[seed % N];
    }

    /// The authorised key seven times in eight, otherwise any actor's key (which may be the authorised one).
    function _signer(uint256 seed, uint256 good) internal view returns (uint256) {
        return seed % 8 < 7 ? good : _pk[(seed >> 3) % N];
    }

    function _pick(uint256 seed) internal view returns (uint256) {
        if (_ids.length == 0) revert Refused();
        return seed % _ids.length;
    }

    /// Three times in four, the first commitment (from a random start) whose stage `mask` matches; otherwise, or
    /// when none matches, a random commitment, so refusals in every stage stay covered.
    function _pickFor(uint256 seed, uint256 mask) internal returns (uint256) {
        (_buyer0, _seller0) = (usdc.balanceOf(buyer), usdc.balanceOf(seller));
        uint256 i = _pick(seed >> 2);
        if (seed % 4 == 0) return i;
        for (uint256 k; k < _ids.length; k++) {
            uint256 j = (i + k) % _ids.length;
            if (mask & (1 << uint8(_dealOf(_ids[j]).stage)) != 0) return j;
        }
        return i;
    }

    uint256 internal constant M_NONE = 1 << 0;
    uint256 internal constant M_HELD = 1 << 1;
    uint256 internal constant M_DELIVERED = 1 << 2;
    uint256 internal constant M_FALLBACK = 1 << 3;
    uint256 internal constant M_ESCALATED = 1 << 4;
    uint256 internal constant M_RELEASED = 1 << 5;
    uint256 internal constant M_REFUNDED = 1 << 6;
    uint256 internal constant M_OPEN = M_HELD | M_DELIVERED | M_FALLBACK | M_ESCALATED;
    uint256 internal constant M_DECIDED = M_RELEASED | M_REFUNDED;

    function _authorised(string memory name, bool authorised) internal {
        if (!authorised) {
            unauthorisedSuccess++;
            lastViolation = string.concat(name, ": succeeded with a signature from the wrong key");
        }
    }

    /// The adjudicator whose turn a stage is: the primary in Held and Delivered, the fallback in FallbackJudging,
    /// the appeal adjudicator in Escalated.
    function _turn(HoldbackRules.Stage s) internal pure returns (uint8) {
        if (s == HoldbackRules.Stage.FallbackJudging) return D_FALLBACK;
        if (s == HoldbackRules.Stage.Escalated) return D_APPEAL;
        return D_PRIMARY;
    }

    /// Names the closing reason (and the decider) of the action in progress, for `_track`.
    function _closingAs(uint8 reason, uint8 decider) internal {
        (_closing, _decider) = (reason, decider);
    }

    function _track(bytes32 id, HoldbackRules.Stage before) internal {
        HoldbackRules.Deal memory d = _dealOf(id);
        // T-358 (ADR-0033): a deal whose money addresses are apart never moves its signing addresses' money.
        if (_terms_.length > 0 && _terms_[_indexOf(id)].buyerPaymentAddress != buyer) {
            if (usdc.balanceOf(buyer) != _buyer0 || usdc.balanceOf(seller) != _seller0) {
                signerMoved++;
                lastViolation = "a deal with its money addresses apart moved a signing address's balance";
            }
        }
        HoldbackRules.Stage s = d.stage;
        if (!_isClosed(before) && _isClosed(s)) {
            closings[id]++;
            everClosed[id] = true;
            (closedBy[id], closedDecider[id]) = (_closing, _closing == R_DECIDED ? _decider : D_NONE);
        }
        (_closing, _decider) = (R_OPEN, D_NONE);
        if (everClosed[id] && !_isClosed(s)) {
            reopened++;
            lastViolation = "a closed commitment reopened";
        }
        // A delivery lands only before deliverBy, whichever call carries it (T-206 M-2); reclaim and mutual
        // settlement leave the attempt at 0.
        if (before == HoldbackRules.Stage.Held && d.attempt != 0 && block.timestamp >= _deliverBy[id]) {
            timeoutMismatch++;
            lastViolation = "a delivery landed at or after deliverBy";
        }
        // T-336: a delivery landed (deliver, or a decision or early accept that carried it). Every handler path posts
        // the fixture's delivery, so its hash is known; the chain must store exactly it (ADR-0029).
        if (before == HoldbackRules.Stage.Held && d.attempt != 0 && postedHash[id] == bytes32(0)) {
            (H.Delivery memory dv,) = _delivery();
            postedHash[id] = hx.delivery(id, dv);
            deliveries++;
            if (rules.deliveryHashOf(id) != postedHash[id]) {
                deliveryHashLost++;
                lastViolation = "a delivery landed but the chain does not store its hash";
            }
        }
    }

    function _indexOf(bytes32 id) internal view returns (uint256 i) {
        for (; i < _ids.length; i++) {
            if (_ids[i] == id) return i;
        }
    }

    function _noMove(string memory name, uint256 i, uint256 c0) internal {
        if (capturable(i) != c0) {
            unexpectedMovement++;
            lastViolation = string.concat(name, ": moved held money");
        }
    }

    function _timeout(string memory name, bool due, bool ok) internal {
        if (ok != due) {
            timeoutMismatch++;
            lastViolation = string.concat(name, ok ? ": succeeded before it was due" : ": refused when due");
        }
    }

    /// Three times in eight, first moves time (forward only) to one second before, exactly at, or one second after
    /// the timeout's own deadline, so every boundary is tried with the call right after it.
    function _warpNear(uint256 deadline, uint256 seed) internal {
        uint256 mode = (seed >> 8) % 8;
        if (mode == 0 || mode > 3) return;
        uint256 target = deadline + mode - 2;
        if (target > block.timestamp && target < CLOCK_CAP) vm.warp(target);
    }

    /// T-375: the clock stays below 2^40 s (about the year 36,812). The word stores times in 40 bits (`t1`), and the
    /// bound on them is a fix of package R8, not yet on the lane; the boundary offers' far deadlines (`_boundary`)
    /// would otherwise carry the clock past it. R8 removes this cap when it adds that bound.
    uint256 internal constant CLOCK_CAP = 1 << 40;

    function _off(uint256 seed, uint256 shift, uint256 lo, uint256 hi) internal pure returns (uint64) {
        return uint64(_bound((seed >> shift) & 0xffffffff, lo, hi));
    }

    // ------------------------------------------------------------ actions: commitments

    /// Writes new terms (no transaction: offers live off chain until agreeAndFund).
    function offer(uint256 seed) external {
        if (_ids.length >= MAX_DEALS) revert Refused();
        H.Terms memory t = _terms();
        // T-356 (SC-1): a deployment serves one token, `usdc`. One offer in 64 names the second token, which the
        // contract refuses at funding, so the refusal stays exercised without diverging most harness seeds.
        t.token = uint256(keccak256(abi.encode("other token", seed))) % 64 == 0 ? address(tusd2) : address(usdc);
        t.price = _bound((seed >> 8) & 0xffffffff, 1, 60_000_000);
        // T-341: one offer in eight has price 0, which phase one keeps legal (Rafa, 2026-11-11: a deal may carry no
        // token value). With a fee above 0 it funds; with fee 0 the escrow refuses to hold nothing, on both sides.
        if (uint256(keccak256(abi.encode("zero price", seed))) % 8 == 0) t.price = 0;
        t.fee = _bound((seed >> 40) & 0xffffffff, 0, 5_000_000);
        uint256[3] memory r;
        for (uint256 k; k < 3; k++) {
            r[k] = _pk[2 + ((seed >> (72 + 4 * k)) % 3)];
        }
        t.adjudicator = vm.addr(r[0]);
        t.fallbackAdjudicator = vm.addr(r[1]);
        t.appealAdjudicator = vm.addr(r[2]);
        uint64 now_ = uint64(block.timestamp);
        // T-356 (SC-5): the contract refuses deadlines not in strict order, as core does. One offer in 32 still draws them
        // in any order (it was one in four), so the refusal stays exercised; the ordered ones are strictly ordered.
        if (uint256(keccak256(abi.encode("any order", seed))) % 32 == 0) {
            // Any order, equal pairs included: refused at funding since SC-5.
            t.timing.offerExpiresAt = now_ + _off(seed, 96, 1, 6 days);
            t.timing.fundBy = now_ + _off(seed, 128, 1, 6 days);
            t.timing.deliverBy = now_ + _off(seed, 160, 1, 6 days);
            t.timing.judgeBy = now_ + _off(seed, 192, 1, 6 days);
            t.timing.fallbackBy = now_ + _off(seed, 224, 1, 6 days);
        } else {
            t.timing.offerExpiresAt = now_ + _off(seed, 96, 1, 2 days);
            t.timing.fundBy = t.timing.offerExpiresAt + _off(seed, 128, 1, 1 days);
            t.timing.deliverBy = t.timing.fundBy + _off(seed, 160, 1, 2 days);
            t.timing.judgeBy = t.timing.deliverBy + _off(seed, 192, 1, 2 days);
            t.timing.fallbackBy = t.timing.judgeBy + _off(seed, 224, 1, 2 days);
        }
        // T-358 (ADR-0033 §2b): phase one requires an appeal window of 0. One offer in 32 states another window, which
        // the contract refuses at funding, so the refusal stays exercised without diverging most harness seeds.
        t.timing.appealWindowSec =
            uint256(keccak256(abi.encode("appeal window", seed))) % 32 == 0 ? _off(seed, 112, 1, 2 days) : 0;
        t.timing.appealDecideSec = _off(seed, 144, 1, 2 days);
        // T-375 (triage item 46): one offer in 16 sits on a bound the contract checks (`_boundary`), so a change of
        // behaviour at that bound shows in the side-by-side harness. The draw is independent, under its own hash label.
        uint256 b = uint256(keccak256(abi.encode("boundary", seed)));
        if (b % 16 == 0) _boundary(t, b >> 8);
        // T-358 (ADR-0033): one deal in four has its payment and payout addresses apart from its signing addresses. Since
        // T-375 the side-by-side harness draws them too: its old side, the lane after T-358, pays the money addresses.
        if (_paysMoneyAddresses() && uint256(keccak256(abi.encode("apart", seed))) % 4 == 0) {
            (t.buyerPaymentAddress, t.sellerPayoutAddress) = (payAddr, payoutAddr);
        }
        bytes32 id = hx.id(t);
        _terms_.push(t);
        _ids.push(id);
        _deliverBy[id] = t.timing.deliverBy;
        _rolePk[id] = r;
    }

    /// T-375 (triage item 46): moves offer `t` onto one bound the rules contract checks today, or one past it:
    /// 0, 1: the hold (price + fee) at the largest `uint120`, the escrow's `maxAmount` type, and one above it
    ///       (`Unrepresentable`). The buyer and the payment address hold enough to fund the first such deal;
    /// 2, 3: the escrow's expiry (`fallbackBy + appealDecideSec + EXPIRY_MARGIN`) at the largest `uint48`, its
    ///       `authorizationExpiry` type, and one above it (`Unrepresentable`), through the escalation window;
    /// 4, 5: every deadline one second after the one before, the smallest gap SC-5 allows, and an escalation window
    ///       of one second, the smallest SC-5 allows (4), or of two seconds, the smallest the sim beacon can decide
    ///       (5). With one second the escalation's round (`t1 + 1`) is public only at the deadline, so that deal
    ///       always defaults: known finding F-2 (`docs/audit/state-model.md` section 6.3).
    /// R8 adds the bounds it introduces to this list (the refinement plan, section 7d).
    function _boundary(H.Terms memory t, uint256 r) internal view {
        uint256 k = r % 6;
        if (k <= 1) {
            t.price = uint256(type(uint120).max) - t.fee + k;
        } else if (k <= 3) {
            t.timing.appealDecideSec = uint64(uint256(type(uint48).max) - t.timing.fallbackBy - MARGIN + k - 2);
        } else {
            uint64 now_ = uint64(block.timestamp);
            (t.timing.offerExpiresAt, t.timing.fundBy, t.timing.deliverBy) = (now_ + 1, now_ + 2, now_ + 3);
            (t.timing.judgeBy, t.timing.fallbackBy, t.timing.appealDecideSec) = (now_ + 4, now_ + 5, uint64(k - 3));
        }
    }

    function agreeAndFund(uint256 dealSeed, uint256 callerSeed, uint256 signerSeed) external {
        uint256 v0 = _violations();
        uint256 i = _pickFor(dealSeed, M_NONE);
        H.Terms memory t = _terms_[i];
        fundToken = t.token;
        H.Timing memory tm = t.timing;
        fundOutOfOrder = tm.offerExpiresAt >= tm.fundBy || tm.fundBy >= tm.deliverBy || tm.deliverBy >= tm.judgeBy
            || tm.judgeBy >= tm.fallbackBy;
        fundAppealWindow = tm.appealWindowSec != 0;
        bytes32 id = _ids[i];
        uint256 good = _rolePk[id][0];
        uint256 sk = _signer(signerSeed, SELLER_PK);
        uint256 ak = _signer(signerSeed >> 8, good);
        uint256 bk = _signer(signerSeed >> 16, BUYER_PK);
        uint256 fk = _signer(signerSeed >> 24, _payPk(t));
        bytes memory ss = _sellerSig(t, sk);
        H.Acceptance memory acc = _acceptance(t, ak);
        H.Agree memory ag = _agree(t, bk);
        H.Funding memory f = _erc3009(t, fk);
        HoldbackRules.Stage before = _dealOf(id).stage;
        bool ok = _relay(_caller(callerSeed), _agreeAndFundCall(t, ss, acc, ag, f));
        if (ok) _authorised("agreeAndFund", sk == SELLER_PK && ak == good && bk == BUYER_PK && fk == _payPk(t));
        _track(id, before);
        _end(ok, v0);
    }

    /// `agreeAndFund`'s calldata in this side's ABI. T-356 (SC-2): phase one's `Funding` has no `method`; the pinned
    /// parent's still does, and its side encodes the same ERC-3009 signature with `method` 0 (`Sides.sol`).
    function _agreeAndFundCall(
        H.Terms memory t,
        bytes memory ss,
        H.Acceptance memory acc,
        H.Agree memory ag,
        H.Funding memory f
    ) internal pure virtual returns (bytes memory) {
        return abi.encodeCall(HoldbackRules.agreeAndFund, (t, ss, acc, ag, f));
    }

    function deliver(uint256 dealSeed, uint256 callerSeed, uint256 signerSeed) external {
        uint256 v0 = _violations();
        uint256 i = _pickFor(dealSeed, M_HELD);
        H.Terms memory t = _terms_[i];
        bytes32 id = _ids[i];
        (H.Delivery memory d,) = _delivery();
        uint256 k = _signer(signerSeed, SELLER_PK);
        bytes memory sig = _deliverySig(id, d, k);
        HoldbackRules.Stage before = _dealOf(id).stage;
        uint256 c0 = capturable(i);
        bool ok;
        vm.prank(_caller(callerSeed));
        try rules.deliver(t, d, sig) {
            ok = true;
            _note(true, "");
            _authorised("deliver", k == SELLER_PK);
        } catch (bytes memory e) {
            _note(false, e);
        }
        // T-336: the seller's own delivery on a Held deal before deliverBy always lands, from any relayer.
        if (!ok && k == SELLER_PK && before == HoldbackRules.Stage.Held && block.timestamp < _deliverBy[id]) {
            deliverRefused++;
            lastViolation = "deliver: the seller's delivery before deliverBy was refused";
        }
        _noMove("deliver", i, c0);
        _track(id, before);
        _end(ok, v0);
    }

    /// Relays a decision from whichever adjudicator's turn the stage says it is (sometimes with the wrong role, an
    /// expired message or another key). In Held it carries the delivery. On a decided deal it relays the primary's
    /// decision, which phase one refuses: a decision is final when written.
    function decide(uint256 dealSeed, uint256 callerSeed, uint256 signerSeed, uint256 outcomeSeed) external {
        uint256 v0 = _violations();
        uint256 i = _pickFor(dealSeed, M_OPEN);
        H.Terms memory t = _terms_[i];
        bytes32 id = _ids[i];
        HoldbackRules.Deal memory d = _dealOf(id);
        uint8 role = H.ROLE_PRIMARY;
        uint64 round;
        if (d.stage == HoldbackRules.Stage.FallbackJudging) {
            role = H.ROLE_FALLBACK;
            round = rules.BEACON().roundAt(t.timing.judgeBy);
        } else if (d.stage == HoldbackRules.Stage.Escalated) {
            role = H.ROLE_APPEAL;
            round = rules.BEACON().roundAt(d.t1) + 1;
        }
        uint8 outcome = uint8(outcomeSeed % 3);
        H.Decision memory m =
            role == H.ROLE_PRIMARY ? _decision(role, outcome) : _beaconDecision(id, role, outcome, round);
        // Rare corruptions use the value 15, not 0: the fuzzer favours small values.
        if ((outcomeSeed >> 8) % 16 == 15) m.role = uint8((outcomeSeed >> 12) % 3);
        if ((outcomeSeed >> 16) % 16 == 15) m.expiresAt = uint64(block.timestamp);
        // Rarely a decision about another seller-signed body (ADR-0029); otherwise the posted or carried delivery.
        if ((outcomeSeed >> 24) % 16 == 15) m.deliveryHash = keccak256("another body");
        uint256 good = _rolePk[id][role];
        uint256 k = _signer(signerSeed, good);
        m = _signDecision(t, id, m, vm.addr(good), k);

        H.Delivery memory dv;
        bytes memory dsig;
        uint256 sk = SELLER_PK;
        if (d.stage == HoldbackRules.Stage.Held) {
            (dv,) = _delivery();
            sk = _signer(signerSeed >> 8, SELLER_PK);
            dsig = _deliverySig(id, dv, sk);
        }
        bool timely = k == good && _timelyDecision(t, d, m, role, sk == SELLER_PK, _expectedDelivery(id, d.stage, dv));
        _recordLogs();
        _closingAs(R_DECIDED, _turn(d.stage));
        bool ok = _relayDecide(_caller(callerSeed), t, m, dv, dsig);
        if (ok) _authorised("decide", k == good && sk == SELLER_PK && m.deliveryHash == rules.deliveryHashOf(id));
        _decisionLiveness("decide", ok, timely);
        _keyOnlyWithPayment();
        _track(id, d.stage);
        _end(ok, v0);
    }

    /// Removed in phase one (SC-7), kept for the side-by-side harness: relays the appeal adjudicator's decision on
    /// a decided deal, as the deployed contracts take it while a party appeal is open (round: the first after the
    /// filing). Phase one refuses it with `WrongStage`. No time warp: the round comes from the old side's own
    /// state, and a warp would make the two sides' clocks differ.
    function decideAppeal(uint256 dealSeed, uint256 callerSeed, uint256 outcomeSeed) external {
        uint256 v0 = _violations();
        uint256 i = _pickFor(dealSeed, M_DECIDED);
        H.Terms memory t = _terms_[i];
        bytes32 id = _ids[i];
        HoldbackRules.Stage before = _dealOf(id).stage;
        (,, uint40 t2) = _deployedAppeal(id);
        uint64 round = t2 == 0 ? 0 : rules.BEACON().roundAt(t2) + 1;
        H.Decision memory m = _beaconDecision(id, H.ROLE_APPEAL, uint8(outcomeSeed % 2), round);
        (m.keyScheme, m.keyCiphertext) = (outcomeSeed >> 1) % 2 == 0 ? (KEY_SCHEME, KEY_CT) : ("", "");
        uint256 pk = _rolePk[id][H.ROLE_APPEAL];
        m = _signDecision(t, id, m, vm.addr(pk), pk);
        uint256 c0 = capturable(i);
        _recordLogs();
        bool ok = _relayDecide(_caller(callerSeed), t, m, _noDelivery(), "");
        _drainLogs();
        _noMove("decideAppeal", i, c0);
        _track(id, before);
        _end(ok, v0);
    }

    /// Drives a funded deal to the fallback (posting the delivery and triggering the takeover if needed) and has the
    /// fallback decide with its key and the judgeBy round, any outcome; the separate actions rarely line up inside
    /// the fallback's window.
    function decideFallback(uint256 dealSeed, uint256 callerSeed, uint256 outcomeSeed) external {
        uint256 v0 = _violations();
        uint256 i = _pickFor(dealSeed, M_HELD | M_DELIVERED | M_FALLBACK);
        H.Terms memory t = _terms_[i];
        bytes32 id = _ids[i];
        HoldbackRules.Stage before = _dealOf(id).stage;
        if (before == HoldbackRules.Stage.Held) {
            (H.Delivery memory dv,) = _delivery();
            try rules.deliver(t, dv, _deliverySig(id, dv, SELLER_PK)) {
                _note(true, "");
            } catch (bytes memory e) {
                _note(false, e);
            }
            _track(id, before); // the delivery's own deadline check, before the warp below
            before = _dealOf(id).stage;
        }
        if (_dealOf(id).stage == HoldbackRules.Stage.Delivered) {
            if (block.timestamp < t.timing.judgeBy) vm.warp(t.timing.judgeBy);
            try rules.triggerFallback(t) {
                _note(true, "");
            } catch (bytes memory e) {
                _note(false, e);
            }
        }
        H.Decision memory m = _beaconDecision(id, H.ROLE_FALLBACK, uint8(outcomeSeed % 3), t.timing.judgeBy);
        uint256 pk = _rolePk[id][H.ROLE_FALLBACK];
        m = _signDecision(t, id, m, vm.addr(pk), pk);
        HoldbackRules.Deal memory d = _dealOf(id);
        bool timely = d.stage == HoldbackRules.Stage.FallbackJudging
            && _timelyDecision(t, d, m, H.ROLE_FALLBACK, true, postedHash[id]);
        _recordLogs();
        _closingAs(R_DECIDED, D_FALLBACK);
        bool ok = _relayDecide(_caller(callerSeed), t, m, _noDelivery(), "");
        _decisionLiveness("decideFallback", ok, timely);
        _keyOnlyWithPayment();
        _track(id, before);
        _end(ok, v0);
    }

    /// Sends `data` to the rules contract from `caller`, as a `try` would, and notes the outcome in trace mode
    /// (T-341). The wide entry points go through here, which keeps their actions' stacks shallow.
    function _relay(address caller, bytes memory data) internal returns (bool ok) {
        bytes memory ret;
        vm.prank(caller);
        (ok, ret) = address(rules).call(data);
        _note(ok, ret);
    }

    /// Relays a decision from `caller`; in trace mode it notes the outcome (T-341). One helper for the decide paths
    /// keeps their stack shallow.
    function _relayDecide(
        address caller,
        H.Terms memory t,
        H.Decision memory m,
        H.Delivery memory dv,
        bytes memory dsig
    ) internal returns (bool ok) {
        vm.prank(caller);
        try rules.decide(t, m, dv, dsig) {
            ok = true;
            _note(true, "");
        } catch (bytes memory e) {
            _note(false, e);
        }
    }

    /// The formal model's KeyOnlyWithPayment: every KeyReleased the checked call emitted leaves its deal Released or
    /// Settled. Each action that can release a key records its own call (vm.recordLogs clears what came before).
    function _keyOnlyWithPayment() internal {
        Vm.Log[] memory logs = _drainLogs();
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].emitter != address(rules) || logs[i].topics[0] != HoldbackRules.KeyReleased.selector) continue;
            HoldbackRules.Stage s = _dealOf(logs[i].topics[1]).stage;
            if (s != HoldbackRules.Stage.Released && s != HoldbackRules.Stage.Settled) {
                keyWithoutPayment++;
                lastViolation = "released the buyer's key on a deal that is not Released or Settled";
            }
        }
    }

    /// T-375: the delivery a decision must name, from the handler's own record: the one it carries in Held, else the
    /// one the handler posted (`postedHash`). Not the chain's stored hash, so a mutant that loses it cannot hide here.
    function _expectedDelivery(bytes32 id, HoldbackRules.Stage s, H.Delivery memory carried)
        internal
        view
        returns (bytes32)
    {
        return s == HoldbackRules.Stage.Held ? hx.delivery(id, carried) : postedHash[id];
    }

    /// T-375 (triage item 43): whether the phase-one rules must take decision `m` on deal word `d` now, given that its
    /// signer's key is the role's (the caller checks that). The conditions are read from the terms, the clock, the
    /// message and the handler's record of the posted delivery. The stage and `t1` come from the stored word `d`;
    /// the state oracle checks those against the state model's rows and their time bounds:
    /// - the stage is open and the message names the role whose turn it is (`_turn`), attempt 1, and the delivery
    ///   the handler carries or posted; it has not expired;
    /// - in Held, the carried delivery is the seller's and lands before deliverBy;
    /// - the outcome is one the role may give (the appeal adjudicator cannot escalate);
    /// - the role's deadline is still open: judgeBy for the primary, fallbackBy for the fallback, the escalation's
    ///   time plus appealDecideSec for the appeal adjudicator;
    /// - the beacon round is public: the sim beacon publishes round r at time r, so the escalation's round
    ///   (`t1 + 1`) from `t1 + 1`; the fallback's round (`judgeBy`) is public in FallbackJudging, which starts at
    ///   judgeBy at the earliest.
    /// No deadline of a funded deal reaches the escrow's expiry (`fallbackBy + appealDecideSec + MARGIN`), so the
    /// capture or void that follows cannot fail for time.
    function _timelyDecision(
        H.Terms memory t,
        HoldbackRules.Deal memory d,
        H.Decision memory m,
        uint8 role,
        bool sellerSigned,
        bytes32 expected
    ) internal view returns (bool) {
        HoldbackRules.Stage s = d.stage;
        if (!_isOpen(s) || m.role != role || m.attempt != 1 || m.deliveryHash != expected) return false;
        if (block.timestamp >= m.expiresAt) return false;
        if (s == HoldbackRules.Stage.Held && (!sellerSigned || block.timestamp >= t.timing.deliverBy)) return false;
        if (role == H.ROLE_APPEAL) {
            return m.outcome <= H.OUTCOME_REJECT && block.timestamp >= uint256(d.t1) + 1
                && block.timestamp < uint256(d.t1) + t.timing.appealDecideSec;
        }
        return m.outcome <= H.OUTCOME_ESCALATE
            && block.timestamp < (role == H.ROLE_FALLBACK ? t.timing.fallbackBy : t.timing.judgeBy);
    }

    /// T-375: counts a decision that landed. The predicate must match the rules exactly for the messages this handler
    /// builds, so both directions are violations: a timely decision refused, and a decision that landed although the
    /// predicate calls it untimely. The second keeps the predicate honest: a predicate that drifted to `false` on
    /// every path would otherwise silence the gate.
    function _decisionLiveness(string memory name, bool ok, bool timely) internal {
        if (ok) decisions++;
        if (ok == timely) return;
        decideRefused++;
        lastViolation = string.concat(
            name, ok ? ": a decision landed that is not authorised and timely" : ": an authorised, timely decision was refused"
        );
    }

    function earlyAccept(uint256 dealSeed, uint256 callerSeed, uint256 signerSeed) external {
        uint256 v0 = _violations();
        uint256 i = _pickFor(dealSeed, M_HELD | M_DELIVERED);
        H.Terms memory t = _terms_[i];
        bytes32 id = _ids[i];
        (H.Delivery memory dv, H.KeyProof memory kp) = _delivery();
        // The buyer names the delivery it opened: the one carried in Held, the posted one after (ADR-0029). Rarely
        // another body, so the refusal stays exercised.
        bytes32 named = (signerSeed >> 16) % 16 == 15 ? keccak256("another body") : hx.delivery(id, dv);
        H.EarlyAccept memory m =
            H.EarlyAccept({attempt: 1, deliveryHash: named, nonce: 0, expiresAt: type(uint64).max, signature: ""});
        uint256 bk = _signer(signerSeed, BUYER_PK);
        uint256 sk = _signer(signerSeed >> 8, SELLER_PK);
        m.signature = _sign(bk, hx.early(id, buyer, m));
        bytes memory dsig = _deliverySig(id, dv, sk);
        HoldbackRules.Stage before = _dealOf(id).stage;
        bool ok;
        _recordLogs();
        _closingAs(R_ACCEPTED_EARLY, D_NONE);
        ok = _relay(_caller(callerSeed), abi.encodeCall(HoldbackRules.earlyAccept, (t, m, dv, dsig, kp)));
        if (ok) {
            // After `deliver` the carried signature is not read: the posted delivery was verified when it landed.
            bool sellerSigned = sk == SELLER_PK || before == HoldbackRules.Stage.Delivered;
            _authorised("earlyAccept", bk == BUYER_PK && sellerSigned && named == rules.deliveryHashOf(id));
        }
        _keyOnlyWithPayment();
        _track(id, before);
        _end(ok, v0);
    }

    function mutualSettle(uint256 dealSeed, uint256 callerSeed, uint256 signerSeed, uint256 splitSeed) external {
        uint256 v0 = _violations();
        uint256 i = _pickFor(dealSeed, M_OPEN);
        H.Terms memory t = _terms_[i];
        bytes32 id = _ids[i];
        HoldbackRules.Stage before = _dealOf(id).stage;
        H.Mutual memory m = _mutual(t, id, before, splitSeed);
        thirdPartyPayout = false;
        for (uint256 k; k < m.payouts.length; k++) {
            if (m.payouts[k].to != t.buyerPaymentAddress && m.payouts[k].to != t.sellerPayoutAddress) thirdPartyPayout = true;
        }
        (H.Delivery memory dv, H.KeyProof memory kp) = _delivery();
        bytes32 h = hx.mutual(id, t.token, m);
        uint256 bk = _signer(signerSeed, BUYER_PK);
        uint256 sk = _signer(signerSeed >> 8, SELLER_PK);
        m.buyerSignature = _sign(bk, h);
        m.sellerSignature = _sign(sk, h);
        H.KeyProof memory none;
        if (m.releaseKey) none = kp;
        bool ok;
        _recordLogs();
        _closingAs(R_SETTLED, D_NONE);
        ok = _relay(_caller(callerSeed), abi.encodeCall(HoldbackRules.mutualSettle, (t, m, dv, none)));
        if (ok) _authorised("mutualSettle", bk == BUYER_PK && sk == SELLER_PK);
        _keyOnlyWithPayment();
        _track(id, before);
        _end(ok, v0);
    }

    /// Splits the price between the seller, the buyer and a third party (the operator or the unrelated address);
    /// one time in sixteen the payouts overshoot the price by one unit. T-356 (SC-3): phase one pays the parties only,
    /// so one settlement in 32 names a third party (refused there); otherwise the third share goes to the buyer.
    function _mutual(H.Terms memory t, bytes32 id, HoldbackRules.Stage s, uint256 seed)
        internal
        view
        returns (H.Mutual memory m)
    {
        uint256 a = (seed & 0xffffffffffff) % (t.price + 1);
        uint256 b = ((seed >> 48) & 0xffffffffffff) % (t.price - a + 1);
        uint256 c = t.price - a - b;
        if ((seed >> 200) % 16 == 15) c += 1;
        if (uint256(keccak256(abi.encode("third party", seed))) % 32 != 0) (b, c) = (b + c, 0);
        uint256 n = (a > 0 ? 1 : 0) + (b > 0 ? 1 : 0) + (c > 0 ? 1 : 0);
        m.payouts = new H.Payout[](n);
        uint256 j;
        // T-358 (ADR-0033): the parties' shares go to the payout and payment addresses. On a deal whose addresses are
        // apart, the third share names a signing address half the time, a payee phase one refuses as any other.
        address third = _actor[(seed >> 100) & 1 == 0 ? I_OP : I_OTHER];
        if (t.buyerPaymentAddress != t.buyer && (seed >> 101) & 1 == 1) third = (seed >> 102) & 1 == 0 ? t.buyer : t.seller;
        if (a > 0) m.payouts[j++] = H.Payout(t.sellerPayoutAddress, a);
        if (b > 0) m.payouts[j++] = H.Payout(t.buyerPaymentAddress, b);
        if (c > 0) m.payouts[j++] = H.Payout(third, c);
        m.hasDelivery = s != HoldbackRules.Stage.Held || (seed >> 130) & 1 == 1;
        m.releaseKey = m.hasDelivery && (seed >> 131) & 1 == 1;
        if (m.hasDelivery) {
            (H.Delivery memory dv,) = _delivery();
            m.deliveryHash = hx.delivery(id, dv);
        }
        m.expiresAt = type(uint64).max;
    }

    /// Removed in phase one (SC-7), kept for the side-by-side harness: files a party's signed appeal, with a bond of
    /// 0 so no party's balance moves on the old side, through the deployed contracts' selector. Phase one has no
    /// such function, so the call reverts with empty data.
    function fileAppeal(uint256 dealSeed, uint256 callerSeed, uint256 signerSeed, uint256 appealSeed) external {
        uint256 v0 = _violations();
        uint256 i = _pickFor(dealSeed, M_DECIDED);
        H.Terms memory t = _terms_[i];
        bytes32 id = _ids[i];
        uint8 who = uint8(appealSeed & 1);
        IDeployedAppeals.Appeal memory a = IDeployedAppeals.Appeal({
            appellant: who,
            groundsHash: keccak256("fails the agreed checks"),
            bond: 0,
            filedAt: uint64(block.timestamp),
            signature: ""
        });
        a.signature = _sign(_signer(signerSeed, who == 0 ? BUYER_PK : SELLER_PK), _appealHash(id, t, a));
        HoldbackRules.Stage before = _dealOf(id).stage;
        uint256 c0 = capturable(i);
        bool ok = _relay(_caller(callerSeed), abi.encodeCall(IDeployedAppeals.fileAppeal, (t, a)));
        _noMove("fileAppeal", i, c0);
        _track(id, before);
        _end(ok, v0);
    }

    /// The deployed contracts' EIP-712 struct hash of an appeal (64be1f1's `HoldbackTypes.appealHash`).
    function _appealHash(bytes32 id, H.Terms memory t, IDeployedAppeals.Appeal memory a)
        internal
        view
        returns (bytes32)
    {
        bytes32 typeHash = keccak256(
            "Appeal(bytes32 commitmentId,string appellant,address appellantAddress,string grounds,TokenAmount bond,uint64 filedAt)TokenAmount(string token,uint256 amount)"
        );
        address appellant = a.appellant == 0 ? buyer : seller;
        bytes32 who = a.appellant == 0 ? keccak256("buyer") : keccak256("seller");
        bytes32 bond = H.tokenAmountHash(H.tokenIdHash(t.token), a.bond);
        return keccak256(abi.encode(typeHash, id, who, appellant, a.groundsHash, bond, a.filedAt));
    }

    // ------------------------------------------------------------ actions: timeouts (TimeoutKind), any caller

    /// Removed in phase one (SC-6), kept for the side-by-side harness: the parent's `expireOffer`, through its
    /// selector. Phase one has no such function, so the call reverts with empty data and is never due there. The
    /// parent records the expiry once (`offerExpired`), after which its own `WrongStage(Expired)` answers.
    function expireOffer(uint256 dealSeed, uint256 callerSeed) external {
        uint256 v0 = _violations();
        uint256 i = _pickFor(dealSeed, M_NONE);
        H.Terms memory t = _terms_[i];
        bytes32 id = _ids[i];
        uint256 first = t.timing.offerExpiresAt < t.timing.fundBy ? t.timing.offerExpiresAt : t.timing.fundBy;
        _warpNear(first, callerSeed);
        HoldbackRules.Stage before = _dealOf(id).stage;
        bool due = _hasExpireOffer() && !offerExpired[id] && before == HoldbackRules.Stage.None
            && (block.timestamp >= t.timing.offerExpiresAt || block.timestamp >= t.timing.fundBy);
        uint256 c0 = capturable(i);
        bool ok = _relay(_caller(callerSeed), abi.encodeCall(IDeployedOffers.expireOffer, (t)));
        if (ok) offerExpired[id] = true;
        _timeout("expireOffer", due, ok);
        _noMove("expireOffer", i, c0);
        _track(id, before);
        _end(ok, v0);
    }

    function reclaim(uint256 dealSeed, uint256 callerSeed) external {
        uint256 v0 = _violations();
        uint256 i = _pickFor(dealSeed, M_HELD);
        H.Terms memory t = _terms_[i];
        bytes32 id = _ids[i];
        _warpNear(t.timing.deliverBy, callerSeed);
        HoldbackRules.Stage before = _dealOf(id).stage;
        bool due = before == HoldbackRules.Stage.Held && block.timestamp >= t.timing.deliverBy;
        bool ok;
        _closingAs(R_RECLAIMED, D_NONE);
        vm.prank(_caller(callerSeed));
        try rules.reclaim(t) {
            ok = true;
            _note(true, "");
        } catch (bytes memory e) {
            _note(false, e);
        }
        _timeout("reclaim", due, ok);
        _track(id, before);
        _end(ok, v0);
    }

    function triggerFallback(uint256 dealSeed, uint256 callerSeed) external {
        uint256 v0 = _violations();
        uint256 i = _pickFor(dealSeed, M_DELIVERED);
        H.Terms memory t = _terms_[i];
        bytes32 id = _ids[i];
        _warpNear(t.timing.judgeBy, callerSeed);
        HoldbackRules.Stage before = _dealOf(id).stage;
        bool due = before == HoldbackRules.Stage.Delivered && block.timestamp >= t.timing.judgeBy;
        uint256 c0 = capturable(i);
        bool ok;
        vm.prank(_caller(callerSeed));
        try rules.triggerFallback(t) {
            ok = true;
            _note(true, "");
        } catch (bytes memory e) {
            _note(false, e);
        }
        _timeout("triggerFallback", due, ok);
        _noMove("triggerFallback", i, c0);
        _track(id, before);
        _end(ok, v0);
    }

    function triggerDefault(uint256 dealSeed, uint256 callerSeed) external {
        uint256 v0 = _violations();
        uint256 i = _pickFor(dealSeed, M_FALLBACK | M_ESCALATED);
        H.Terms memory t = _terms_[i];
        bytes32 id = _ids[i];
        HoldbackRules.Deal memory d = _dealOf(id);
        _warpNear(
            d.stage == HoldbackRules.Stage.Escalated
                ? uint256(d.t1) + t.timing.appealDecideSec
                : uint256(t.timing.fallbackBy),
            callerSeed
        );
        bool due = (d.stage == HoldbackRules.Stage.FallbackJudging && block.timestamp >= t.timing.fallbackBy)
            || (d.stage == HoldbackRules.Stage.Escalated && block.timestamp >= uint256(d.t1) + t.timing.appealDecideSec);
        bool ok;
        _closingAs(R_DEFAULTED, D_NONE);
        vm.prank(_caller(callerSeed));
        try rules.triggerDefault(t) {
            ok = true;
            _note(true, "");
        } catch (bytes memory e) {
            _note(false, e);
        }
        _timeout("triggerDefault", due, ok);
        _track(id, d.stage);
        _end(ok, v0);
    }

    /// Removed in phase one (SC-7), kept for the side-by-side harness: the deployed contracts' appeal expiry, through
    /// their selector. Phase one has no such function, so the call reverts with empty data and is never due. The
    /// warp target is drawn from shared state only (the decision's time and the terms), so both sides warp alike.
    function expireAppeal(uint256 dealSeed, uint256 callerSeed) external {
        uint256 v0 = _violations();
        uint256 i = _pickFor(dealSeed, M_DECIDED);
        H.Terms memory t = _terms_[i];
        bytes32 id = _ids[i];
        HoldbackRules.Deal memory d = _dealOf(id);
        uint256 appealBy = uint256(d.t1) + t.timing.appealWindowSec;
        _warpNear((callerSeed >> 16) & 1 == 0 ? appealBy : appealBy + t.timing.appealDecideSec, callerSeed);
        (uint8 appeal,,) = _deployedAppeal(id);
        // The deployed contracts' rule: AppealState None (0) is due from appealBy, Open (1) from appealBy plus the
        // decision window. Phase one has no appeal state, so nothing is ever due there.
        bool decided = d.stage == HoldbackRules.Stage.Released || d.stage == HoldbackRules.Stage.Refunded;
        bool due = _hasDeployedAppeals() && decided
            && ((appeal == 0 && block.timestamp >= appealBy) || (appeal == 1 && block.timestamp >= appealBy + t.timing.appealDecideSec));
        uint256 c0 = capturable(i);
        bool ok = _relay(_caller(callerSeed), abi.encodeCall(IDeployedAppeals.expireAppeal, (t)));
        _timeout("expireAppeal", due, ok);
        _noMove("expireAppeal", i, c0);
        _track(id, d.stage);
        _end(ok, v0);
    }

    /// Whether this side's rules contract is the deployed one, with party appeals. Phase one: no.
    function _hasDeployedAppeals() internal view virtual returns (bool) {
        return false;
    }

    /// Whether this side's rules contract records an unfunded offer's expiry (`expireOffer`). Phase one: no (SC-6).
    function _hasExpireOffer() internal view virtual returns (bool) {
        return false;
    }

    // ------------------------------------------------------------ actions: around the rules contract

    /// The payment address's own CPP reclaim, possible only after authorizationExpiry (ADR-0003, ADR-0033).
    function cppReclaim(uint256 dealSeed) external {
        uint256 i = _pickFor(dealSeed, M_OPEN);
        AuthCaptureEscrow.PaymentInfo memory pi = _pi(_terms_[i]);
        vm.prank(_terms_[i].buyerPaymentAddress);
        escrow.reclaim(pi);
        cppReclaimed[_ids[i]] = true;
    }

    /// Any actor calling CPP's operator functions on a Holdback hold (capture, void, refund) must fail. Phase one
    /// has no bond vault, so its rules-only functions are no longer a target (SC-7).
    function stranger(uint256 callerSeed, uint256 which, uint256 amount) external {
        uint256 v0 = _violations();
        address caller = _caller(callerSeed);
        amount = _bound(amount, 0, 10_000_000);
        uint256 w = which % 3;
        uint256 i = _pick(which >> 24);
        AuthCaptureEscrow.PaymentInfo memory pi = _pi(_terms_[i]);
        bytes memory data;
        if (w == 0) data = abi.encodeCall(AuthCaptureEscrow.capture, (pi, amount, 0, address(0)));
        else if (w == 1) data = abi.encodeCall(AuthCaptureEscrow.void, (pi));
        else data = abi.encodeCall(AuthCaptureEscrow.refund, (pi, amount, address(collector3009), ""));
        vm.prank(caller);
        (bool ok, bytes memory ret) = address(escrow).call(data);
        _note(ok, ret);
        if (ok) {
            strangerSuccess++;
            lastViolation = "a stranger reached CPP's operator functions";
        }
        _end(ok, v0);
    }

    // ------------------------------------------------------------ time

    /// Moves time forward: a random step, or onto, one second before or one second after a deadline of a random
    /// commitment (every TimeoutKind's deadline and CPP's authorizationExpiry).
    function warp(uint256 seed) external {
        uint256 target;
        if (seed % 4 == 0 || _ids.length == 0) {
            target = block.timestamp + _bound(seed >> 8, 1, 12 hours);
        } else {
            uint256 i = (seed >> 8) % _ids.length;
            H.Terms memory t = _terms_[i];
            HoldbackRules.Deal memory d = _dealOf(_ids[i]);
            uint256 w = t.timing.appealWindowSec;
            uint256 dec = t.timing.appealDecideSec;
            uint256[9] memory deadlines = [
                uint256(t.timing.offerExpiresAt),
                t.timing.fundBy,
                t.timing.deliverBy,
                t.timing.judgeBy,
                t.timing.fallbackBy,
                uint256(d.t1) + w,
                uint256(d.t1) + w + dec,
                uint256(d.t1) + dec,
                uint256(t.timing.fallbackBy) + dec + MARGIN
            ];
            target = deadlines[(seed >> 16) % 9] + ((seed >> 24) % 3) - 1;
        }
        if (target <= block.timestamp || target >= CLOCK_CAP) revert Refused();
        vm.warp(target);
    }
}
