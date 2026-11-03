// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AuthCaptureEscrow} from "commerce-payments/AuthCaptureEscrow.sol";
import {MockERC3009Token} from "commerce-payments-test/mocks/MockERC3009Token.sol";
import {Vm} from "forge-std/Vm.sol";

import {HoldbackRules} from "../../src/HoldbackRules.sol";
import {HoldbackBonds} from "../../src/HoldbackBonds.sol";
import {HoldbackTypes as H} from "../../src/HoldbackTypes.sol";
import {Base} from "../unit/Base.sol";

/// @title RulesHandler
/// @notice T-203: the stateful-fuzzing handler for HoldbackRules and HoldbackBonds. It reuses the unit fixture
///         (`Base`: CPP v1.1.0, both collectors, Permit2, mock ERC-3009 tokens) and drives random interleavings of
///         every external function and every TimeoutKind over a bounded world:
///         - seven actors: buyer, seller, three adjudicators, an operator and an unrelated address. Every call is
///           sent from one of them, and every signature is made by one of their keys;
///         - at most MAX_DEALS commitments over two tokens, with fuzzed price, fee, adjudicator roles (an address may
///           hold two roles) and timing (ordered, or any order: D31);
///         - forward time warps that land on, one second before or one second after every deadline.
///         Each call's outcome is checked against what the rules allow, and violations are counted in ghost
///         variables that `test/invariant/RulesInvariants.t.sol` reads. A call the rules refuse, with no violation
///         recorded, re-reverts with `Refused()` so the campaign's metrics count it as a revert (no state is lost:
///         the refused call changed nothing).
contract RulesHandler is Base {
    error Refused();

    uint256 internal constant OP_PK = 0x0BE7;
    uint256 internal constant N = 7;
    uint256 public constant MAX_DEALS = 8;
    uint256 internal constant I_OP = 5;
    uint256 internal constant I_OTHER = 6;

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
    mapping(bytes32 => uint64) internal _deliverBy;
    uint256 public reopened; // a closed commitment seen in an open stage again
    uint256 public unauthorisedSuccess; // a call carrying a signature from the wrong key succeeded
    uint256 public unexpectedMovement; // a call that must not move held money moved it
    uint256 public strangerSuccess; // a direct call to CPP or the bond vault's rules-only functions succeeded
    uint256 public timeoutMismatch; // a timeout succeeded before its deadline, or was refused when due
    uint256 public withdrawMismatch; // a bond withdrawal of free funds refused, or of encumbered funds allowed
    uint256 public keyWithoutPayment; // a KeyReleased on a deal that does not stand Released or Settled
    string public lastViolation;

    constructor() {
        setUp();
        tusd2 = new MockERC3009Token("Mock EURC", "mEURC", 6);
        _actor = [buyer, seller, adjudicator, fallbackAdj, appealAdj, vm.addr(OP_PK), vm.addr(OTHER_PK)];
        _pk = [BUYER_PK, SELLER_PK, ADJ_PK, FB_PK, AP_PK, OP_PK, OTHER_PK];
        tusd2.mint(buyer, 1_000_000_000);
        tusd2.mint(seller, 1_000_000_000);
        usdc.mint(_actor[I_OP], 100_000_000);
        tusd2.mint(_actor[I_OTHER], 100_000_000);
        // The second token's bonds are small, so funding and takeovers contend for them.
        for (uint256 i = 2; i <= 4; i++) {
            tusd2.mint(_actor[i], 80_000_000);
            vm.startPrank(_actor[i]);
            tusd2.approve(address(bonds), 80_000_000);
            bonds.deposit(address(tusd2), 80_000_000);
            vm.stopPrank();
        }
        // Every actor approves the bond vault (appeal bonds and deposits).
        for (uint256 i; i < N; i++) {
            vm.startPrank(_actor[i]);
            usdc.approve(address(bonds), type(uint256).max);
            tusd2.approve(address(bonds), type(uint256).max);
            vm.stopPrank();
        }
    }

    // ------------------------------------------------------------ views for the invariants

    function system() external view returns (HoldbackRules, HoldbackBonds, AuthCaptureEscrow) {
        return (rules, bonds, escrow);
    }

    function tokens() public view returns (address[2] memory) {
        return [address(usdc), address(tusd2)];
    }

    function actors() external view returns (address[N] memory) {
        return _actor;
    }

    /// Every address that can hold the tokens in this world. Conservation sums over exactly these.
    function holders() external view returns (address[] memory h) {
        h = new address[](N + 9);
        for (uint256 i; i < N; i++) {
            h[i] = _actor[i];
        }
        h[N] = address(escrow);
        h[N + 1] = escrow.getTokenStore(address(rules));
        h[N + 2] = address(bonds);
        h[N + 3] = address(rules);
        h[N + 4] = address(collector3009);
        h[N + 5] = address(collectorPermit2);
        h[N + 6] = permit2;
        h[N + 7] = address(this);
        h[N + 8] = relayer;
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
        if (!_isOpen(rules.dealOf(id).stage) || cppReclaimed[id]) return 0;
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

    /// What `adj` should have encumbered in `token`, from each commitment's reservation flags.
    function encumberedMirror(address adj, address token) external view returns (uint256 sum) {
        for (uint256 i; i < _ids.length; i++) {
            H.Terms memory t = _terms_[i];
            if (t.token != token) continue;
            uint8 f = rules.dealOf(_ids[i]).flags;
            if (f & 1 != 0 && t.adjudicator == adj) sum += t.price;
            if (f & 2 != 0 && t.fallbackAdjudicator == adj) sum += t.price;
        }
    }

    function appealBondsHeld(address token) external view returns (uint256 sum) {
        for (uint256 i; i < _ids.length; i++) {
            if (_terms_[i].token != token) continue;
            (, uint96 amount) = bonds.appealBondOf(_ids[i]);
            sum += amount;
        }
    }

    // ------------------------------------------------------------ helpers

    function _violations() internal view returns (uint256) {
        return reopened + unauthorisedSuccess + unexpectedMovement + strangerSuccess + timeoutMismatch
            + withdrawMismatch + keyWithoutPayment;
    }

    /// Re-reverts a refused call so the metrics count it, unless the refusal itself was a violation.
    function _end(bool ok, uint256 v0) internal view {
        if (!ok && _violations() == v0) revert Refused();
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

    /// Three times in four, the first commitment (from a random start) that `mask` matches; otherwise, or when
    /// none matches, a random commitment, so refusals in every stage stay covered.
    function _pickFor(uint256 seed, uint256 mask) internal view returns (uint256) {
        uint256 i = _pick(seed >> 2);
        if (seed % 4 == 0) return i;
        for (uint256 k; k < _ids.length; k++) {
            uint256 j = (i + k) % _ids.length;
            if (_matches(rules.dealOf(_ids[j]), mask)) return j;
        }
        return i;
    }

    /// Bits 0-8: the stage. A_NONE and A_OPEN: Released or Refunded with that appeal state.
    function _matches(HoldbackRules.Deal memory d, uint256 mask) internal pure returns (bool) {
        if (mask & (1 << uint8(d.stage)) != 0) return true;
        if (d.stage != HoldbackRules.Stage.Released && d.stage != HoldbackRules.Stage.Refunded) return false;
        if (d.appeal == HoldbackRules.AppealState.None) return mask & A_NONE != 0;
        return d.appeal == HoldbackRules.AppealState.Open && mask & A_OPEN != 0;
    }

    uint256 internal constant M_NONE = 1 << 0;
    uint256 internal constant M_HELD = 1 << 1;
    uint256 internal constant M_DELIVERED = 1 << 2;
    uint256 internal constant M_FALLBACK = 1 << 3;
    uint256 internal constant M_ESCALATED = 1 << 4;
    uint256 internal constant M_OPEN = M_HELD | M_DELIVERED | M_FALLBACK | M_ESCALATED;
    uint256 internal constant A_NONE = 1 << 9; // decided, appeal window open
    uint256 internal constant A_OPEN = 1 << 10; // decided, appeal filed

    function _authorised(string memory name, bool authorised) internal {
        if (!authorised) {
            unauthorisedSuccess++;
            lastViolation = string.concat(name, ": succeeded with a signature from the wrong key");
        }
    }

    function _track(bytes32 id, HoldbackRules.Stage before) internal {
        HoldbackRules.Stage s = rules.dealOf(id).stage;
        if (!_isClosed(before) && _isClosed(s)) {
            closings[id]++;
            everClosed[id] = true;
        }
        if (everClosed[id] && !_isClosed(s)) {
            reopened++;
            lastViolation = "a closed commitment reopened";
        }
        // A delivery lands only before deliverBy, whichever call carries it (T-206 M-2); reclaim and mutual
        // settlement leave the attempt at 0.
        if (before == HoldbackRules.Stage.Held && rules.dealOf(id).attempt != 0 && block.timestamp >= _deliverBy[id]) {
            timeoutMismatch++;
            lastViolation = "a delivery landed at or after deliverBy";
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
        if (target > block.timestamp) vm.warp(target);
    }

    function _off(uint256 seed, uint256 shift, uint256 lo, uint256 hi) internal pure returns (uint64) {
        return uint64(_bound((seed >> shift) & 0xffffffff, lo, hi));
    }

    // ------------------------------------------------------------ actions: commitments

    /// Writes new terms (no transaction: offers live off chain until agreeAndFund).
    function offer(uint256 seed) external {
        if (_ids.length >= MAX_DEALS) revert Refused();
        H.Terms memory t = _terms();
        t.token = seed & 1 == 0 ? address(usdc) : address(tusd2);
        t.price = _bound((seed >> 8) & 0xffffffff, 1, 60_000_000);
        t.fee = _bound((seed >> 40) & 0xffffffff, 0, 5_000_000);
        uint256[3] memory r;
        for (uint256 k; k < 3; k++) {
            r[k] = _pk[2 + ((seed >> (72 + 4 * k)) % 3)];
        }
        t.adjudicator = vm.addr(r[0]);
        t.fallbackAdjudicator = vm.addr(r[1]);
        t.appealAdjudicator = vm.addr(r[2]);
        uint64 now_ = uint64(block.timestamp);
        if ((seed >> 88) % 4 == 0) {
            // Any order (D31): the contract accepts any representable timing.
            t.timing.offerExpiresAt = now_ + _off(seed, 96, 1, 6 days);
            t.timing.fundBy = now_ + _off(seed, 128, 1, 6 days);
            t.timing.deliverBy = now_ + _off(seed, 160, 1, 6 days);
            t.timing.judgeBy = now_ + _off(seed, 192, 1, 6 days);
            t.timing.fallbackBy = now_ + _off(seed, 224, 1, 6 days);
        } else {
            t.timing.offerExpiresAt = now_ + _off(seed, 96, 1, 2 days);
            t.timing.fundBy = t.timing.offerExpiresAt + _off(seed, 128, 0, 1 days);
            t.timing.deliverBy = t.timing.fundBy + _off(seed, 160, 1, 2 days);
            t.timing.judgeBy = t.timing.deliverBy + _off(seed, 192, 1, 2 days);
            t.timing.fallbackBy = t.timing.judgeBy + _off(seed, 224, 1, 2 days);
        }
        t.timing.appealWindowSec = _off(seed, 112, 1, 2 days);
        t.timing.appealDecideSec = _off(seed, 144, 1, 2 days);
        bytes32 id = hx.id(t);
        _terms_.push(t);
        _ids.push(id);
        _deliverBy[id] = t.timing.deliverBy;
        _rolePk[id] = r;
    }

    function agreeAndFund(uint256 dealSeed, uint256 callerSeed, uint256 signerSeed) external {
        uint256 v0 = _violations();
        uint256 i = _pickFor(dealSeed, M_NONE);
        H.Terms memory t = _terms_[i];
        bytes32 id = _ids[i];
        uint256 good = _rolePk[id][0];
        uint256 sk = _signer(signerSeed, SELLER_PK);
        uint256 ak = _signer(signerSeed >> 8, good);
        uint256 bk = _signer(signerSeed >> 16, BUYER_PK);
        uint256 fk = _signer(signerSeed >> 24, BUYER_PK);
        bytes memory ss = _sellerSig(t, sk);
        H.Acceptance memory acc = _acceptance(t, ak);
        H.Agree memory ag = _agree(t, bk);
        H.Funding memory f = _erc3009(t, fk);
        HoldbackRules.Stage before = rules.dealOf(id).stage;
        bool ok;
        vm.prank(_caller(callerSeed));
        try rules.agreeAndFund(t, ss, acc, ag, f) {
            ok = true;
            _authorised("agreeAndFund", sk == SELLER_PK && ak == good && bk == BUYER_PK && fk == BUYER_PK);
        } catch {}
        _track(id, before);
        _end(ok, v0);
    }

    function deliver(uint256 dealSeed, uint256 callerSeed, uint256 signerSeed) external {
        uint256 v0 = _violations();
        uint256 i = _pickFor(dealSeed, M_HELD);
        H.Terms memory t = _terms_[i];
        bytes32 id = _ids[i];
        (H.Delivery memory d,) = _delivery();
        uint256 k = _signer(signerSeed, SELLER_PK);
        bytes memory sig = _deliverySig(id, d, k);
        HoldbackRules.Stage before = rules.dealOf(id).stage;
        uint256 c0 = capturable(i);
        bool ok;
        vm.prank(_caller(callerSeed));
        try rules.deliver(t, d, sig) {
            ok = true;
            _authorised("deliver", k == SELLER_PK);
        } catch {}
        _noMove("deliver", i, c0);
        _track(id, before);
        _end(ok, v0);
    }

    /// Relays a decision from whichever adjudicator's turn the stage says it is (sometimes with the wrong role, an
    /// expired message or another key). In Held it carries the delivery.
    function decide(uint256 dealSeed, uint256 callerSeed, uint256 signerSeed, uint256 outcomeSeed) external {
        uint256 v0 = _violations();
        uint256 i = _pickFor(dealSeed, M_OPEN | A_OPEN);
        H.Terms memory t = _terms_[i];
        bytes32 id = _ids[i];
        HoldbackRules.Deal memory d = rules.dealOf(id);
        uint8 role = H.ROLE_PRIMARY;
        uint64 round;
        if (d.stage == HoldbackRules.Stage.FallbackJudging) {
            role = H.ROLE_FALLBACK;
            round = rules.BEACON().roundAt(t.timing.judgeBy);
        } else if (d.stage == HoldbackRules.Stage.Escalated) {
            role = H.ROLE_APPEAL;
            round = rules.BEACON().roundAt(d.t1) + 1;
        } else if (d.stage == HoldbackRules.Stage.Released || d.stage == HoldbackRules.Stage.Refunded) {
            role = H.ROLE_APPEAL;
            round = rules.BEACON().roundAt(d.t2) + 1;
        }
        uint8 outcome = uint8(outcomeSeed % 3);
        H.Decision memory m =
            role == H.ROLE_PRIMARY ? _decision(role, outcome) : _beaconDecision(id, role, outcome, round);
        // Rare corruptions use the value 15, not 0: the fuzzer favours small values.
        if ((outcomeSeed >> 8) % 16 == 15) m.role = uint8((outcomeSeed >> 12) % 3);
        if ((outcomeSeed >> 16) % 16 == 15) m.expiresAt = uint64(block.timestamp);
        // An appeal over a refund carries no key (T-206 H-2), except rarely, so the refusal stays exercised.
        if (d.stage == HoldbackRules.Stage.Refunded && (outcomeSeed >> 20) % 16 != 15) {
            (m.keyScheme, m.keyCiphertext) = ("", "");
        }
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
        bool ok;
        vm.recordLogs();
        vm.prank(_caller(callerSeed));
        try rules.decide(t, m, dv, dsig) {
            ok = true;
            _authorised("decide", k == good && sk == SELLER_PK);
        } catch {}
        _keyOnlyWithPayment();
        _track(id, d.stage);
        _end(ok, v0);
    }

    /// Decides an open appeal with the right key and round, outcome and key presence independent, so the key rule
    /// (T-206 H-2) is reached on every outcome; `decide` rarely builds this sequence.
    function decideAppeal(uint256 dealSeed, uint256 callerSeed, uint256 outcomeSeed) external {
        uint256 v0 = _violations();
        uint256 i = _pickFor(dealSeed, A_OPEN);
        H.Terms memory t = _terms_[i];
        bytes32 id = _ids[i];
        HoldbackRules.Deal memory d = rules.dealOf(id);
        uint64 round = rules.BEACON().roundAt(d.t2) + 1;
        if (block.timestamp < round) vm.warp(round);
        H.Decision memory m = _beaconDecision(id, H.ROLE_APPEAL, uint8(outcomeSeed % 2), round);
        (m.keyScheme, m.keyCiphertext) = (outcomeSeed >> 1) % 2 == 0 ? (KEY_SCHEME, KEY_CT) : ("", "");
        uint256 pk = _rolePk[id][H.ROLE_APPEAL];
        m = _signDecision(t, id, m, vm.addr(pk), pk);
        bool ok;
        vm.recordLogs();
        vm.prank(_caller(callerSeed));
        try rules.decide(t, m, _noDelivery(), "") {
            ok = true;
        } catch {}
        _keyOnlyWithPayment();
        _track(id, d.stage);
        _end(ok, v0);
    }

    /// The formal model's KeyOnlyWithPayment: every KeyReleased the checked call emitted leaves its deal Released or
    /// Settled. Each action that can release a key records its own call (vm.recordLogs clears what came before).
    function _keyOnlyWithPayment() internal {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].emitter != address(rules) || logs[i].topics[0] != HoldbackRules.KeyReleased.selector) continue;
            HoldbackRules.Stage s = rules.dealOf(logs[i].topics[1]).stage;
            if (s != HoldbackRules.Stage.Released && s != HoldbackRules.Stage.Settled) {
                keyWithoutPayment++;
                lastViolation = "released the buyer's key on a deal that is not Released or Settled";
            }
        }
    }

    function earlyAccept(uint256 dealSeed, uint256 callerSeed, uint256 signerSeed) external {
        uint256 v0 = _violations();
        uint256 i = _pickFor(dealSeed, M_HELD | M_DELIVERED);
        H.Terms memory t = _terms_[i];
        bytes32 id = _ids[i];
        (H.Delivery memory dv, H.KeyProof memory kp) = _delivery();
        H.EarlyAccept memory m = H.EarlyAccept({attempt: 1, nonce: 0, expiresAt: type(uint64).max, signature: ""});
        uint256 bk = _signer(signerSeed, BUYER_PK);
        uint256 sk = _signer(signerSeed >> 8, SELLER_PK);
        m.signature = _sign(bk, hx.early(id, buyer, m));
        bytes memory dsig = _deliverySig(id, dv, sk);
        HoldbackRules.Stage before = rules.dealOf(id).stage;
        bool ok;
        vm.recordLogs();
        vm.prank(_caller(callerSeed));
        try rules.earlyAccept(t, m, dv, dsig, kp) {
            ok = true;
            _authorised("earlyAccept", bk == BUYER_PK && sk == SELLER_PK);
        } catch {}
        _keyOnlyWithPayment();
        _track(id, before);
        _end(ok, v0);
    }

    function mutualSettle(uint256 dealSeed, uint256 callerSeed, uint256 signerSeed, uint256 splitSeed) external {
        uint256 v0 = _violations();
        uint256 i = _pickFor(dealSeed, M_OPEN);
        H.Terms memory t = _terms_[i];
        bytes32 id = _ids[i];
        HoldbackRules.Stage before = rules.dealOf(id).stage;
        H.Mutual memory m = _mutual(t, id, before, splitSeed);
        (H.Delivery memory dv, H.KeyProof memory kp) = _delivery();
        bytes32 h = hx.mutual(id, t.token, m);
        uint256 bk = _signer(signerSeed, BUYER_PK);
        uint256 sk = _signer(signerSeed >> 8, SELLER_PK);
        m.buyerSignature = _sign(bk, h);
        m.sellerSignature = _sign(sk, h);
        H.KeyProof memory none;
        if (m.releaseKey) none = kp;
        bool ok;
        vm.recordLogs();
        vm.prank(_caller(callerSeed));
        try rules.mutualSettle(t, m, dv, none) {
            ok = true;
            _authorised("mutualSettle", bk == BUYER_PK && sk == SELLER_PK);
        } catch {}
        _keyOnlyWithPayment();
        _track(id, before);
        _end(ok, v0);
    }

    /// Splits the price between the seller, the buyer and a third party (the operator or the unrelated address);
    /// one time in sixteen the payouts overshoot the price by one unit.
    function _mutual(H.Terms memory t, bytes32 id, HoldbackRules.Stage s, uint256 seed)
        internal
        view
        returns (H.Mutual memory m)
    {
        uint256 a = (seed & 0xffffffffffff) % (t.price + 1);
        uint256 b = ((seed >> 48) & 0xffffffffffff) % (t.price - a + 1);
        uint256 c = t.price - a - b;
        if ((seed >> 200) % 16 == 15) c += 1;
        uint256 n = (a > 0 ? 1 : 0) + (b > 0 ? 1 : 0) + (c > 0 ? 1 : 0);
        m.payouts = new H.Payout[](n);
        uint256 j;
        if (a > 0) m.payouts[j++] = H.Payout(seller, a);
        if (b > 0) m.payouts[j++] = H.Payout(buyer, b);
        if (c > 0) m.payouts[j++] = H.Payout(_actor[(seed >> 100) & 1 == 0 ? I_OP : I_OTHER], c);
        m.hasDelivery = s != HoldbackRules.Stage.Held || (seed >> 130) & 1 == 1;
        m.releaseKey = m.hasDelivery && (seed >> 131) & 1 == 1;
        if (m.hasDelivery) {
            (H.Delivery memory dv,) = _delivery();
            m.deliveryHash = hx.delivery(id, dv);
        }
        m.expiresAt = type(uint64).max;
    }

    function fileAppeal(uint256 dealSeed, uint256 callerSeed, uint256 signerSeed, uint256 appealSeed) external {
        uint256 v0 = _violations();
        uint256 i = _pickFor(dealSeed, A_NONE);
        H.Terms memory t = _terms_[i];
        bytes32 id = _ids[i];
        uint8 who = uint8(appealSeed & 1);
        address appellant = who == 0 ? buyer : seller;
        uint256 good = who == 0 ? BUYER_PK : SELLER_PK;
        H.Appeal memory a = H.Appeal({
            appellant: who,
            groundsHash: keccak256("fails the agreed checks"),
            bond: _bound(appealSeed >> 8, 0, 5_000_000),
            filedAt: uint64(block.timestamp),
            signature: ""
        });
        uint256 k = _signer(signerSeed, good);
        a.signature = _sign(k, hx.appeal(id, appellant, t.token, a));
        HoldbackRules.Stage before = rules.dealOf(id).stage;
        uint256 c0 = capturable(i);
        bool ok;
        vm.prank(_caller(callerSeed));
        try rules.fileAppeal(t, a) {
            ok = true;
            _authorised("fileAppeal", k == good);
        } catch {}
        _noMove("fileAppeal", i, c0);
        _track(id, before);
        _end(ok, v0);
    }

    // ------------------------------------------------------------ actions: timeouts (TimeoutKind), any caller

    function expireOffer(uint256 dealSeed, uint256 callerSeed) external {
        uint256 v0 = _violations();
        uint256 i = _pickFor(dealSeed, M_NONE);
        H.Terms memory t = _terms_[i];
        bytes32 id = _ids[i];
        uint256 first = t.timing.offerExpiresAt < t.timing.fundBy ? t.timing.offerExpiresAt : t.timing.fundBy;
        _warpNear(first, callerSeed);
        HoldbackRules.Stage before = rules.dealOf(id).stage;
        bool due = before == HoldbackRules.Stage.None
            && (block.timestamp >= t.timing.offerExpiresAt || block.timestamp >= t.timing.fundBy);
        uint256 c0 = capturable(i);
        bool ok;
        vm.prank(_caller(callerSeed));
        try rules.expireOffer(t) {
            ok = true;
        } catch {}
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
        HoldbackRules.Stage before = rules.dealOf(id).stage;
        bool due = before == HoldbackRules.Stage.Held && block.timestamp >= t.timing.deliverBy;
        bool ok;
        vm.prank(_caller(callerSeed));
        try rules.reclaim(t) {
            ok = true;
        } catch {}
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
        HoldbackRules.Stage before = rules.dealOf(id).stage;
        bool due = before == HoldbackRules.Stage.Delivered && block.timestamp >= t.timing.judgeBy;
        uint256 c0 = capturable(i);
        bool ok;
        vm.prank(_caller(callerSeed));
        try rules.triggerFallback(t) {
            ok = true;
        } catch {}
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
        HoldbackRules.Deal memory d = rules.dealOf(id);
        _warpNear(
            d.stage == HoldbackRules.Stage.Escalated
                ? uint256(d.t1) + t.timing.appealDecideSec
                : uint256(t.timing.fallbackBy),
            callerSeed
        );
        bool due = (d.stage == HoldbackRules.Stage.FallbackJudging && block.timestamp >= t.timing.fallbackBy)
            || (d.stage == HoldbackRules.Stage.Escalated && block.timestamp >= uint256(d.t1) + t.timing.appealDecideSec);
        bool ok;
        vm.prank(_caller(callerSeed));
        try rules.triggerDefault(t) {
            ok = true;
        } catch {}
        _timeout("triggerDefault", due, ok);
        _track(id, d.stage);
        _end(ok, v0);
    }

    function expireAppeal(uint256 dealSeed, uint256 callerSeed) external {
        uint256 v0 = _violations();
        uint256 i = _pickFor(dealSeed, A_NONE | A_OPEN);
        H.Terms memory t = _terms_[i];
        bytes32 id = _ids[i];
        HoldbackRules.Deal memory d = rules.dealOf(id);
        uint256 appealBy = uint256(d.t1) + t.timing.appealWindowSec;
        _warpNear(
            d.appeal == HoldbackRules.AppealState.Open ? appealBy + t.timing.appealDecideSec : appealBy, callerSeed
        );
        bool due = (d.stage == HoldbackRules.Stage.Released || d.stage == HoldbackRules.Stage.Refunded)
            && (
                (d.appeal == HoldbackRules.AppealState.None && block.timestamp >= appealBy)
                    || (d.appeal == HoldbackRules.AppealState.Open && block.timestamp >= appealBy + t.timing.appealDecideSec)
            );
        uint256 c0 = capturable(i);
        bool ok;
        vm.prank(_caller(callerSeed));
        try rules.expireAppeal(t) {
            ok = true;
        } catch {}
        _timeout("expireAppeal", due, ok);
        _noMove("expireAppeal", i, c0);
        _track(id, d.stage);
        _end(ok, v0);
    }

    // ------------------------------------------------------------ actions: bonds

    function bondDeposit(uint256 actorSeed, uint256 tokenSeed, uint256 amount) external {
        address a = _actor[actorSeed % N];
        address token = tokens()[tokenSeed & 1];
        uint256 bal = MockERC3009Token(token).balanceOf(a);
        amount = _bound(amount, 0, bal < 50_000_000 ? bal : 50_000_000);
        vm.prank(a);
        bonds.deposit(token, amount);
    }

    /// A withdrawal must succeed exactly when it is within the caller's unencumbered bond.
    function bondWithdraw(uint256 actorSeed, uint256 tokenSeed, uint256 amount) external {
        uint256 v0 = _violations();
        address a = _actor[actorSeed % N];
        address token = tokens()[tokenSeed & 1];
        uint256 free = bonds.freeOf(a, token);
        amount = _bound(amount, 0, free + 2);
        bool ok;
        vm.prank(a);
        try bonds.withdraw(token, amount) {
            ok = true;
        } catch {}
        if (ok != (amount <= free)) {
            withdrawMismatch++;
            lastViolation = ok ? "withdraw: took encumbered bond" : "withdraw: refused free bond";
        }
        _end(ok, v0);
    }

    // ------------------------------------------------------------ actions: around the rules contract

    /// The buyer's own CPP reclaim, possible only after authorizationExpiry (ADR-0003).
    function cppReclaim(uint256 dealSeed) external {
        uint256 i = _pickFor(dealSeed, M_OPEN);
        AuthCaptureEscrow.PaymentInfo memory pi = _pi(_terms_[i]);
        vm.prank(buyer);
        escrow.reclaim(pi);
        cppReclaimed[_ids[i]] = true;
    }

    /// Any actor calling CPP's operator functions on a Holdback hold (capture, void, refund) or the bond vault's
    /// rules-only functions (encumber, release, takeAppealBond, payAppealBond) must fail.
    function stranger(uint256 callerSeed, uint256 which, uint256 amount) external {
        uint256 v0 = _violations();
        address caller = _caller(callerSeed);
        address adj = _actor[2 + (which >> 8) % 3];
        address token = tokens()[(which >> 16) & 1];
        bytes32 id;
        bytes memory data;
        address target = address(bonds);
        amount = _bound(amount, 0, 10_000_000);
        uint256 w = which % 7;
        if (w < 3) {
            uint256 i = _pick(which >> 24);
            id = _ids[i];
            AuthCaptureEscrow.PaymentInfo memory pi = _pi(_terms_[i]);
            target = address(escrow);
            if (w == 0) data = abi.encodeCall(AuthCaptureEscrow.capture, (pi, amount, 0, address(0)));
            else if (w == 1) data = abi.encodeCall(AuthCaptureEscrow.void, (pi));
            else data = abi.encodeCall(AuthCaptureEscrow.refund, (pi, amount, address(collector3009), ""));
        } else {
            if (_ids.length > 0) id = _ids[(which >> 24) % _ids.length];
            if (w == 3) data = abi.encodeCall(HoldbackBonds.encumber, (adj, token, amount));
            else if (w == 4) data = abi.encodeCall(HoldbackBonds.release, (adj, token, amount));
            else if (w == 5) data = abi.encodeCall(HoldbackBonds.takeAppealBond, (id, caller, token, amount));
            else data = abi.encodeCall(HoldbackBonds.payAppealBond, (id, token, caller));
        }
        vm.prank(caller);
        (bool ok,) = target.call(data);
        if (ok) {
            strangerSuccess++;
            lastViolation = "a stranger reached CPP's operator functions or the vault's rules-only functions";
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
            HoldbackRules.Deal memory d = rules.dealOf(_ids[i]);
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
        if (target <= block.timestamp) revert Refused();
        vm.warp(target);
    }
}
