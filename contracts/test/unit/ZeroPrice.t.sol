// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {AuthCaptureEscrow} from "commerce-payments/AuthCaptureEscrow.sol";

import {HoldbackBonds} from "../../src/HoldbackBonds.sol";
import {HoldbackRules} from "../../src/HoldbackRules.sol";
import {HoldbackTypes as H} from "../../src/HoldbackTypes.sol";
import {Base} from "./Base.sol";

/// T-345 (contract refinement package R5b): a deal with price 0 and a fee above 0, through every outcome.
///
/// Rafa decided on 2026-11-11 that the contract keeps a price of 0: other terms, or a future oracle state, can give a
/// deal meaning without a token value. These tests prove what such a deal does today. Each one asserts:
/// - what the escrow holds before and after (`capturableAmount`, `refundableAmount`, the token store's balance);
/// - who receives the fee and how much, and that no other balance moves;
/// - the deal's stored word against its row in docs/audit/state-model.md, section 2 (L01 to L37);
/// - the full ordered list of events from the rules contract, the escrow and the bond vault, zero amounts included.
///   `_check` fails on an event the test did not list as well as on a missing one.
/// The last test shows that price 0 with fee 0 cannot be funded today: the escrow refuses to hold nothing.
contract ZeroPriceDealTest is Base {
    struct Ev {
        address emitter;
        bytes32[] topics;
        bytes data;
    }

    struct Bal {
        uint256 buyer;
        uint256 seller;
        uint256 primary;
        uint256 fb;
        uint256 ap;
        uint256 store;
    }

    bytes32 internal constant RECORD = keccak256("record"); // the judgment record hash `_decision` signs
    string internal constant ENVELOPE = "buyer-envelope"; // the buyer's envelope in `_buyerKey`

    // ------------------------------------------------------------ the deal

    function _zeroTerms() internal returns (H.Terms memory t) {
        t = _terms();
        t.price = 0; // the fee stays FEE: 500_000 base units
    }

    function _fundedZero() internal returns (H.Terms memory t, bytes32 id) {
        t = _zeroTerms();
        id = _fund(t);
    }

    function _ph(H.Terms memory t) internal view returns (bytes32) {
        return escrow.getHash(_pi(t));
    }

    function _store() internal view returns (address) {
        return escrow.getTokenStore(address(rules));
    }

    function _postedHash(bytes32 id) internal view returns (bytes32) {
        (H.Delivery memory dv,) = _delivery();
        return hx.delivery(id, dv);
    }

    function _escalate(H.Terms memory t, bytes32 id) internal returns (uint256 at) {
        rules.decide(t, _primary(t, id, H.OUTCOME_ESCALATE), _noDelivery(), "");
        at = block.timestamp;
    }

    function _mutualMsg(H.Terms memory t, bytes32 id, H.Payout[] memory payouts, bool releaseKey, bytes32 dh)
        internal
        view
        returns (H.Mutual memory m)
    {
        m.hasDelivery = dh != bytes32(0);
        m.deliveryHash = dh;
        m.payouts = payouts;
        m.releaseKey = releaseKey;
        m.nonce = keccak256("mutual");
        m.expiresAt = type(uint64).max;
        bytes32 h = hx.mutual(id, t.token, m);
        m.buyerSignature = _sign(BUYER_PK, h);
        m.sellerSignature = _sign(SELLER_PK, h);
    }

    // ------------------------------------------------------------ assertions

    /// The stored word and `deliveryHashOf` against a row of state-model.md section 2. `t2` is 0 in every row these
    /// tests reach (no party appeal), and `seedTag` is the primary's from funding on.
    function _word(
        bytes32 id,
        HoldbackRules.Stage stage,
        uint8 attempt,
        HoldbackRules.AppealState appeal,
        uint8 flags,
        uint256 t1
    ) internal view {
        HoldbackRules.Deal memory d = rules.dealOf(id);
        assertEq(uint8(d.stage), uint8(stage), "stage");
        assertEq(d.attempt, attempt, "attempt");
        assertEq(uint8(d.appeal), uint8(appeal), "appeal");
        assertEq(d.flags, flags, "flags");
        assertEq(d.t1, t1, "t1");
        assertEq(d.t2, 0, "t2");
        assertEq(d.seedTag, uint144(uint256(keccak256(abi.encodePacked(SEED)))), "seedTag");
        assertEq(rules.deliveryHashOf(id), attempt == 1 ? _postedHash(id) : bytes32(0), "dh");
    }

    /// The escrow's record for this deal, and the token store's balance (one deal per test).
    function _escrowHolds(H.Terms memory t, uint256 capturable, uint256 refundable) internal view {
        (bool collected, uint120 c, uint120 r) = escrow.paymentState(_ph(t));
        assertTrue(collected, "the escrow recorded the hold");
        assertEq(c, capturable, "escrow capturable");
        assertEq(r, refundable, "escrow refundable");
        assertEq(usdc.balanceOf(_store()), capturable, "the token store holds exactly what is capturable");
    }

    /// With price 0 every reservation is 0: no bond is encumbered, none is paid out.
    function _bondsUntouched() internal view {
        assertEq(bonds.encumberedOf(adjudicator, address(usdc)), 0, "primary encumbered");
        assertEq(bonds.encumberedOf(fallbackAdj, address(usdc)), 0, "fallback encumbered");
        assertEq(bonds.encumberedOf(appealAdj, address(usdc)), 0, "appeal encumbered");
        assertEq(bonds.bondOf(adjudicator, address(usdc)), BOND, "primary bond");
        assertEq(bonds.bondOf(fallbackAdj, address(usdc)), BOND, "fallback bond");
        assertEq(bonds.bondOf(appealAdj, address(usdc)), BOND, "appeal bond");
    }

    function _bal() internal view returns (Bal memory b) {
        b.buyer = usdc.balanceOf(buyer);
        b.seller = usdc.balanceOf(seller);
        b.primary = usdc.balanceOf(adjudicator);
        b.fb = usdc.balanceOf(fallbackAdj);
        b.ap = usdc.balanceOf(appealAdj);
        b.store = usdc.balanceOf(_store());
    }

    /// What each party gained since `b0`; the token store paid out exactly their sum.
    function _gained(Bal memory b0, uint256 toBuyer, uint256 toSeller, uint256 toPrimary, uint256 toFb, uint256 toAp)
        internal
        view
    {
        _gained(b0, toBuyer, toSeller, toPrimary, toFb, toAp, 0);
    }

    /// The same, with `toOther` paid to an address outside the five (checked by the caller).
    function _gained(
        Bal memory b0,
        uint256 toBuyer,
        uint256 toSeller,
        uint256 toPrimary,
        uint256 toFb,
        uint256 toAp,
        uint256 toOther
    ) internal view {
        Bal memory b1 = _bal();
        assertEq(b1.buyer - b0.buyer, toBuyer, "to the buyer");
        assertEq(b1.seller - b0.seller, toSeller, "to the seller");
        assertEq(b1.primary - b0.primary, toPrimary, "to the primary");
        assertEq(b1.fb - b0.fb, toFb, "to the fallback");
        assertEq(b1.ap - b0.ap, toAp, "to the appeal adjudicator");
        assertEq(
            b0.store - b1.store, toBuyer + toSeller + toPrimary + toFb + toAp + toOther, "out of the token store"
        );
    }

    // ------------------------------------------------------------ events

    function _start() internal {
        vm.recordLogs();
    }

    /// The logs since `_start` from the rules contract, the escrow and the vault, in order, must equal `want`.
    function _check(Ev[] memory want) internal {
        Vm.Log[] memory got = vm.getRecordedLogs();
        uint256 n;
        for (uint256 i; i < got.length; ++i) {
            address e = got[i].emitter;
            if (e != address(rules) && e != address(escrow) && e != address(bonds)) continue;
            assertLt(n, want.length, "an event the test did not expect");
            assertEq(e, want[n].emitter, "emitter");
            assertEq(got[i].topics.length, want[n].topics.length, "topic count");
            for (uint256 j; j < got[i].topics.length; ++j) {
                assertEq(got[i].topics[j], want[n].topics[j], "topic");
            }
            assertEq(got[i].data, want[n].data, "data");
            ++n;
        }
        assertEq(n, want.length, "an expected event is missing");
    }

    function _a(address x) internal pure returns (bytes32) {
        return bytes32(uint256(uint160(x)));
    }

    function _ev(address e, bytes32 sig, bytes32 a, bytes memory data) internal pure returns (Ev memory v) {
        v.emitter = e;
        v.topics = new bytes32[](2);
        v.topics[0] = sig;
        v.topics[1] = a;
        v.data = data;
    }

    function _ev(address e, bytes32 sig, bytes32 a, bytes32 b, bytes memory data) internal pure returns (Ev memory v) {
        v.emitter = e;
        v.topics = new bytes32[](3);
        v.topics[0] = sig;
        v.topics[1] = a;
        v.topics[2] = b;
        v.data = data;
    }

    function _ev(address e, bytes32 sig, bytes32 a, bytes32 b, bytes32 c, bytes memory data)
        internal
        pure
        returns (Ev memory v)
    {
        v.emitter = e;
        v.topics = new bytes32[](4);
        v.topics[0] = sig;
        v.topics[1] = a;
        v.topics[2] = b;
        v.topics[3] = c;
        v.data = data;
    }

    // Rules contract events.
    function _decided(bytes32 id, address who, uint8 role, uint8 outcome, bytes32 seed)
        internal
        view
        returns (Ev memory)
    {
        return _ev(
            address(rules), HoldbackRules.Decided.selector, id, _a(who), abi.encode(role, outcome, RECORD, seed)
        );
    }

    function _completed(bytes32 id, address who, bytes32 reason) internal view returns (Ev memory) {
        return _ev(address(rules), HoldbackRules.JobCompleted.selector, id, _a(who), abi.encode(reason));
    }

    function _rejected(bytes32 id, address who) internal view returns (Ev memory) {
        return _ev(address(rules), HoldbackRules.JobRejected.selector, id, _a(who), abi.encode(RECORD));
    }

    function _released(bytes32 id, uint256 amount) internal view returns (Ev memory) {
        return _ev(address(rules), HoldbackRules.PaymentReleased.selector, id, _a(seller), abi.encode(amount));
    }

    function _refunded(bytes32 id, uint256 amount) internal view returns (Ev memory) {
        return _ev(address(rules), HoldbackRules.Refunded.selector, id, _a(buyer), abi.encode(amount));
    }

    function _feePaid(bytes32 id, address who, uint256 amount) internal view returns (Ev memory) {
        return _ev(address(rules), HoldbackRules.FeePaid.selector, id, _a(who), abi.encode(amount));
    }

    function _key(bytes32 id, uint8 path, string memory ciphertext) internal view returns (Ev memory) {
        return _ev(
            address(rules), HoldbackRules.KeyReleased.selector, id, _a(buyer), abi.encode(path, KEY_SCHEME, ciphertext)
        );
    }

    function _jobExpired(bytes32 id) internal view returns (Ev memory v) {
        v.emitter = address(rules);
        v.topics = new bytes32[](2);
        v.topics[0] = HoldbackRules.JobExpired.selector;
        v.topics[1] = id;
    }

    function _defaulted(bytes32 id, HoldbackRules.Stage from) internal view returns (Ev memory v) {
        v.emitter = address(rules);
        v.topics = new bytes32[](2);
        v.topics[0] = HoldbackRules.Defaulted.selector;
        v.topics[1] = id;
        v.data = abi.encode(from);
    }

    function _settled(bytes32 id, bool keyReleased) internal view returns (Ev memory v) {
        v.emitter = address(rules);
        v.topics = new bytes32[](2);
        v.topics[0] = HoldbackRules.MutuallySettled.selector;
        v.topics[1] = id;
        v.data = abi.encode(keyReleased);
    }

    function _fallbackTriggered(bytes32 id, uint64 round) internal view returns (Ev memory v) {
        v.emitter = address(rules);
        v.topics = new bytes32[](2);
        v.topics[0] = HoldbackRules.FallbackTriggered.selector;
        v.topics[1] = id;
        v.data = abi.encode(round);
    }

    function _submitted(bytes32 id) internal view returns (Ev memory) {
        return _ev(address(rules), HoldbackRules.JobSubmitted.selector, id, _a(seller), abi.encode(_postedHash(id)));
    }

    // Escrow events.
    function _captured(H.Terms memory t, uint256 amount, uint256 fee, address to) internal view returns (Ev memory v) {
        v.emitter = address(escrow);
        v.topics = new bytes32[](2);
        v.topics[0] = AuthCaptureEscrow.PaymentCaptured.selector;
        v.topics[1] = _ph(t);
        v.data = abi.encode(amount, fee, to);
    }

    function _voided(H.Terms memory t, uint256 amount) internal view returns (Ev memory v) {
        v.emitter = address(escrow);
        v.topics = new bytes32[](2);
        v.topics[0] = AuthCaptureEscrow.PaymentVoided.selector;
        v.topics[1] = _ph(t);
        v.data = abi.encode(amount);
    }

    /// The escrow deploys the operator's token store on its first send out of it (`E:444-446`), so the first
    /// capture or void of each test emits this after `PaymentCaptured` or `PaymentVoided`.
    function _storeCreated() internal view returns (Ev memory v) {
        v.emitter = address(escrow);
        v.topics = new bytes32[](2);
        v.topics[0] = AuthCaptureEscrow.TokenStoreCreated.selector;
        v.topics[1] = _a(address(rules));
        v.data = abi.encode(_store());
    }

    // Vault events: with price 0 every encumbrance and release is of 0.
    function _encumbered(address who) internal view returns (Ev memory) {
        return _ev(
            address(bonds), HoldbackBonds.BondEncumbered.selector, _a(who), _a(address(usdc)), abi.encode(uint256(0))
        );
    }

    function _bondReleased(address who) internal view returns (Ev memory) {
        return _ev(
            address(bonds), HoldbackBonds.BondReleased.selector, _a(who), _a(address(usdc)), abi.encode(uint256(0))
        );
    }

    // ------------------------------------------------------------ funding (L03)

    /// The hold is the fee alone; the primary reserves a bond of 0 and signs `bondReserved` 0.
    function test_fund_holdsTheFeeOnly() public {
        H.Terms memory t = _zeroTerms();
        bytes32 id = hx.id(t);
        AuthCaptureEscrow.PaymentInfo memory pi = _pi(t);
        assertEq(pi.maxAmount, FEE, "the hold H = P + F is the fee");
        Bal memory b0 = _bal();

        _start();
        _fund(t);
        Ev[] memory w = new Ev[](4);
        w[0] = _encumbered(adjudicator);
        w[1] = _ev(
            address(rules),
            HoldbackRules.JobCreated.selector,
            id,
            _a(buyer),
            _a(seller),
            abi.encode(adjudicator, uint256(pi.authorizationExpiry))
        );
        w[2] = _ev(address(rules), HoldbackRules.JobFunded.selector, id, _a(buyer), abi.encode(FEE));
        w[3] = _ev(
            address(escrow),
            AuthCaptureEscrow.PaymentAuthorized.selector,
            _ph(t),
            abi.encode(pi, FEE, address(collector3009))
        );
        _check(w);

        assertEq(b0.buyer - usdc.balanceOf(buyer), FEE, "the buyer paid the fee only");
        _word(id, HoldbackRules.Stage.Held, 0, HoldbackRules.AppealState.None, 1, 0); // L03
        _escrowHolds(t, FEE, 0);
        _bondsUntouched();
    }

    /// Price 0 needs no bond: a primary with nothing deposited agrees, judges and collects the fee.
    function test_fund_anUnbondedPrimaryServesAndCollectsTheFee() public {
        address bare = vm.addr(OTHER_PK);
        assertEq(bonds.bondOf(bare, address(usdc)), 0);
        H.Terms memory t = _zeroTerms();
        t.adjudicator = bare;
        bytes32 id = hx.id(t);
        bytes memory sellerSig = _sellerSig(t, SELLER_PK);
        H.Acceptance memory acc = _acceptance(t, OTHER_PK);
        H.Agree memory ag = _agree(t, BUYER_PK);
        H.Funding memory f = _erc3009(t, BUYER_PK);

        _start();
        rules.agreeAndFund(t, sellerSig, acc, ag, f);
        Ev[] memory w = new Ev[](4);
        w[0] = _encumbered(bare); // a reservation of 0 passes against a bond of 0
        w[1] = _ev(
            address(rules),
            HoldbackRules.JobCreated.selector,
            id,
            _a(buyer),
            _a(seller),
            abi.encode(bare, uint256(_pi(t).authorizationExpiry))
        );
        w[2] = _ev(address(rules), HoldbackRules.JobFunded.selector, id, _a(buyer), abi.encode(FEE));
        w[3] = _ev(
            address(escrow),
            AuthCaptureEscrow.PaymentAuthorized.selector,
            _ph(t),
            abi.encode(_pi(t), FEE, address(collector3009))
        );
        _check(w);
        _word(id, HoldbackRules.Stage.Held, 0, HoldbackRules.AppealState.None, 1, 0); // L03

        _deliver(t, id);
        H.Decision memory m = _signDecision(t, id, _decision(H.ROLE_PRIMARY, H.OUTCOME_ACCEPT), bare, OTHER_PK);
        Bal memory b0 = _bal();
        _start();
        rules.decide(t, m, _noDelivery(), "");
        w = new Ev[](7);
        w[0] = _decided(id, bare, H.ROLE_PRIMARY, H.OUTCOME_ACCEPT, SEED);
        w[1] = _captured(t, FEE, FEE, bare);
        w[2] = _storeCreated();
        w[3] = _completed(id, bare, RECORD);
        w[4] = _released(id, 0);
        w[5] = _key(id, rules.KEY_DECISION(), KEY_CT);
        w[6] = _feePaid(id, bare, FEE);
        _check(w);

        assertEq(usdc.balanceOf(bare), FEE, "the unbonded primary took the fee");
        _gained(b0, 0, 0, 0, 0, 0, FEE); // the fee left the store for `bare`, none of the five parties
        _word(id, HoldbackRules.Stage.Released, 1, HoldbackRules.AppealState.None, 1, block.timestamp); // L07
        assertEq(bonds.encumberedOf(bare, address(usdc)), 0);
        _escrowHolds(t, 0, FEE);
        _bondsUntouched();
    }

    // ------------------------------------------------------------ the primary decides (L07, L08)

    /// Release: the whole hold is a fee-only capture to the primary; the seller is paid 0 and the event says 0.
    function test_release_primaryAccepts_feeToPrimary_zeroToSeller() public {
        (H.Terms memory t, bytes32 id) = _fundedZero();
        _deliver(t, id);
        H.Decision memory m = _primary(t, id, H.OUTCOME_ACCEPT);
        Bal memory b0 = _bal();

        _start();
        rules.decide(t, m, _noDelivery(), "");
        Ev[] memory w = new Ev[](7);
        w[0] = _decided(id, adjudicator, H.ROLE_PRIMARY, H.OUTCOME_ACCEPT, SEED);
        w[1] = _captured(t, FEE, FEE, adjudicator);
        w[2] = _storeCreated();
        w[3] = _completed(id, adjudicator, RECORD);
        w[4] = _released(id, 0);
        w[5] = _key(id, rules.KEY_DECISION(), KEY_CT);
        w[6] = _feePaid(id, adjudicator, FEE);
        _check(w);

        _gained(b0, 0, 0, FEE, 0, 0);
        _word(id, HoldbackRules.Stage.Released, 1, HoldbackRules.AppealState.None, 1, block.timestamp); // L07
        _escrowHolds(t, 0, FEE);
        _bondsUntouched();
    }

    /// Refund: a fee-only capture to the primary and no void (nothing is left); the buyer is refunded 0.
    function test_refund_primaryRejects_feeToPrimary_zeroToBuyer() public {
        (H.Terms memory t, bytes32 id) = _fundedZero();
        _deliver(t, id);
        H.Decision memory m = _primary(t, id, H.OUTCOME_REJECT);
        Bal memory b0 = _bal();

        _start();
        rules.decide(t, m, _noDelivery(), "");
        Ev[] memory w = new Ev[](6);
        w[0] = _decided(id, adjudicator, H.ROLE_PRIMARY, H.OUTCOME_REJECT, SEED);
        w[1] = _captured(t, FEE, FEE, adjudicator);
        w[2] = _storeCreated();
        w[3] = _rejected(id, adjudicator);
        w[4] = _refunded(id, 0);
        w[5] = _feePaid(id, adjudicator, FEE);
        _check(w);

        _gained(b0, 0, 0, FEE, 0, 0);
        _word(id, HoldbackRules.Stage.Refunded, 1, HoldbackRules.AppealState.None, 1, block.timestamp); // L08
        _escrowHolds(t, 0, FEE);
        _bondsUntouched();
    }

    // ------------------------------------------------------------ the fallback decides (L05, L09, L10)

    function _toFallback(H.Terms memory t, bytes32 id) internal {
        _deliver(t, id);
        vm.warp(t.timing.judgeBy);
        _start();
        rules.triggerFallback(t);
        Ev[] memory w = new Ev[](1);
        w[0] = _fallbackTriggered(id, uint64(t.timing.judgeBy));
        _check(w);
        _word(id, HoldbackRules.Stage.FallbackJudging, 1, HoldbackRules.AppealState.None, 1, t.timing.judgeBy); // L05
        _escrowHolds(t, FEE, 0);
    }

    function _fallbackDecision(H.Terms memory t, bytes32 id, uint8 outcome) internal view returns (H.Decision memory) {
        H.Decision memory m = _beaconDecision(id, H.ROLE_FALLBACK, outcome, uint64(t.timing.judgeBy));
        return _signDecision(t, id, m, fallbackAdj, FB_PK);
    }

    /// The fallback reserves a bond of 0 by deciding, and takes the whole hold as its fee.
    function test_release_fallbackAccepts_feeToFallback_zeroToSeller() public {
        (H.Terms memory t, bytes32 id) = _fundedZero();
        _toFallback(t, id);
        H.Decision memory m = _fallbackDecision(t, id, H.OUTCOME_ACCEPT);
        Bal memory b0 = _bal();

        _start();
        rules.decide(t, m, _noDelivery(), "");
        Ev[] memory w = new Ev[](9);
        w[0] = _decided(id, fallbackAdj, H.ROLE_FALLBACK, H.OUTCOME_ACCEPT, m.seed);
        w[1] = _bondReleased(adjudicator);
        w[2] = _encumbered(fallbackAdj);
        w[3] = _captured(t, FEE, FEE, fallbackAdj);
        w[4] = _storeCreated();
        w[5] = _completed(id, fallbackAdj, RECORD);
        w[6] = _released(id, 0);
        w[7] = _key(id, rules.KEY_DECISION(), KEY_CT);
        w[8] = _feePaid(id, fallbackAdj, FEE);
        _check(w);

        _gained(b0, 0, 0, 0, FEE, 0);
        _word(id, HoldbackRules.Stage.Released, 1, HoldbackRules.AppealState.None, 10, block.timestamp); // L09
        _escrowHolds(t, 0, FEE);
        _bondsUntouched();
    }

    function test_refund_fallbackRejects_feeToFallback_zeroToBuyer() public {
        (H.Terms memory t, bytes32 id) = _fundedZero();
        _toFallback(t, id);
        H.Decision memory m = _fallbackDecision(t, id, H.OUTCOME_REJECT);
        Bal memory b0 = _bal();

        _start();
        rules.decide(t, m, _noDelivery(), "");
        Ev[] memory w = new Ev[](8);
        w[0] = _decided(id, fallbackAdj, H.ROLE_FALLBACK, H.OUTCOME_REJECT, m.seed);
        w[1] = _bondReleased(adjudicator);
        w[2] = _encumbered(fallbackAdj);
        w[3] = _captured(t, FEE, FEE, fallbackAdj);
        w[4] = _storeCreated();
        w[5] = _rejected(id, fallbackAdj);
        w[6] = _refunded(id, 0);
        w[7] = _feePaid(id, fallbackAdj, FEE);
        _check(w);

        _gained(b0, 0, 0, 0, FEE, 0);
        _word(id, HoldbackRules.Stage.Refunded, 1, HoldbackRules.AppealState.None, 10, block.timestamp); // L10
        _escrowHolds(t, 0, FEE);
        _bondsUntouched();
    }

    // ------------------------------------------------------------ reclaim (L34)

    /// Nothing delivered by deliverBy: the void returns the fee, the whole hold, to the buyer.
    function test_reclaim_afterMissedDeliverBy_feeBackToBuyer() public {
        (H.Terms memory t, bytes32 id) = _fundedZero();
        vm.warp(t.timing.deliverBy);
        Bal memory b0 = _bal();

        _start();
        rules.reclaim(t);
        Ev[] memory w = new Ev[](5);
        w[0] = _bondReleased(adjudicator);
        w[1] = _voided(t, FEE);
        w[2] = _storeCreated();
        w[3] = _refunded(id, FEE);
        w[4] = _jobExpired(id);
        _check(w);

        _gained(b0, FEE, 0, 0, 0, 0);
        _word(id, HoldbackRules.Stage.Refunded, 0, HoldbackRules.AppealState.Closed, 0, 0); // L34
        _escrowHolds(t, 0, 0);
        _bondsUntouched();
    }

    // ------------------------------------------------------------ the default outcome (L32, after a default)

    /// The fallback missed fallbackBy: the void returns the fee to the buyer; no adjudicator is paid.
    function test_default_fallbackMissesFallbackBy_feeBackToBuyer() public {
        (H.Terms memory t, bytes32 id) = _fundedZero();
        _toFallback(t, id);
        vm.warp(t.timing.fallbackBy);
        Bal memory b0 = _bal();

        _start();
        rules.triggerDefault(t);
        Ev[] memory w = new Ev[](5);
        w[0] = _defaulted(id, HoldbackRules.Stage.FallbackJudging);
        w[1] = _bondReleased(adjudicator);
        w[2] = _voided(t, FEE);
        w[3] = _storeCreated();
        w[4] = _refunded(id, FEE);
        _check(w);

        _gained(b0, FEE, 0, 0, 0, 0);
        _word(id, HoldbackRules.Stage.Refunded, 1, HoldbackRules.AppealState.Closed, 0, t.timing.judgeBy); // L32
        _escrowHolds(t, 0, 0);
        _bondsUntouched();
    }

    /// An escalated case went undecided: the same refund of the fee; no bond is released, none was reserved.
    function test_default_escalationUndecided_feeBackToBuyer() public {
        (H.Terms memory t, bytes32 id) = _fundedZero();
        _deliver(t, id);
        uint256 at = _escalateChecked(t, id);
        vm.warp(at + t.timing.appealDecideSec);
        Bal memory b0 = _bal();

        _start();
        rules.triggerDefault(t);
        Ev[] memory w = new Ev[](4);
        w[0] = _defaulted(id, HoldbackRules.Stage.Escalated);
        w[1] = _voided(t, FEE);
        w[2] = _storeCreated();
        w[3] = _refunded(id, FEE);
        _check(w);

        _gained(b0, FEE, 0, 0, 0, 0);
        _word(id, HoldbackRules.Stage.Refunded, 1, HoldbackRules.AppealState.Closed, 0, at); // L32
        _escrowHolds(t, 0, 0);
        _bondsUntouched();
    }

    // ------------------------------------------------------------ escalation (L06, L31, L32)

    /// The primary escalates: no money moves; the primary's reservation of 0 is released.
    function _escalateChecked(H.Terms memory t, bytes32 id) internal returns (uint256 at) {
        _start();
        at = _escalate(t, id);
        Ev[] memory w = new Ev[](2);
        w[0] = _decided(id, adjudicator, H.ROLE_PRIMARY, H.OUTCOME_ESCALATE, SEED);
        w[1] = _bondReleased(adjudicator);
        _check(w);
        _word(id, HoldbackRules.Stage.Escalated, 1, HoldbackRules.AppealState.None, 0, at); // L06
        _escrowHolds(t, FEE, 0);
    }

    function _appealDecision(H.Terms memory t, bytes32 id, uint256 at, uint8 outcome)
        internal
        returns (H.Decision memory)
    {
        vm.warp(at + 1); // the escalation's round is the first one after it: wait for it
        H.Decision memory m = _beaconDecision(id, H.ROLE_APPEAL, outcome, uint64(at + 1));
        return _signDecision(t, id, m, appealAdj, AP_PK);
    }

    function test_escalation_accepted_feeToAppealAdjudicator_zeroToSeller() public {
        (H.Terms memory t, bytes32 id) = _fundedZero();
        _deliver(t, id);
        uint256 at = _escalateChecked(t, id);
        H.Decision memory m = _appealDecision(t, id, at, H.OUTCOME_ACCEPT);
        Bal memory b0 = _bal();

        _start();
        rules.decide(t, m, _noDelivery(), "");
        Ev[] memory w = new Ev[](7);
        w[0] = _decided(id, appealAdj, H.ROLE_APPEAL, H.OUTCOME_ACCEPT, m.seed);
        w[1] = _captured(t, FEE, FEE, appealAdj);
        w[2] = _storeCreated();
        w[3] = _completed(id, appealAdj, RECORD);
        w[4] = _released(id, 0);
        w[5] = _key(id, rules.KEY_DECISION(), KEY_CT);
        w[6] = _feePaid(id, appealAdj, FEE);
        _check(w);

        _gained(b0, 0, 0, 0, 0, FEE);
        _word(id, HoldbackRules.Stage.Released, 1, HoldbackRules.AppealState.Closed, 0, at); // L31
        _escrowHolds(t, 0, FEE);
        _bondsUntouched();
    }

    function test_escalation_rejected_feeToAppealAdjudicator_zeroToBuyer() public {
        (H.Terms memory t, bytes32 id) = _fundedZero();
        _deliver(t, id);
        uint256 at = _escalateChecked(t, id);
        H.Decision memory m = _appealDecision(t, id, at, H.OUTCOME_REJECT);
        Bal memory b0 = _bal();

        _start();
        rules.decide(t, m, _noDelivery(), "");
        Ev[] memory w = new Ev[](6);
        w[0] = _decided(id, appealAdj, H.ROLE_APPEAL, H.OUTCOME_REJECT, m.seed);
        w[1] = _captured(t, FEE, FEE, appealAdj);
        w[2] = _storeCreated();
        w[3] = _rejected(id, appealAdj);
        w[4] = _refunded(id, 0);
        w[5] = _feePaid(id, appealAdj, FEE);
        _check(w);

        _gained(b0, 0, 0, 0, 0, FEE);
        _word(id, HoldbackRules.Stage.Refunded, 1, HoldbackRules.AppealState.Closed, 0, at); // L32
        _escrowHolds(t, 0, FEE);
        _bondsUntouched();
    }

    // ------------------------------------------------------------ early accept (L33)

    /// No capture (the price is 0); the void returns the fee; the seller is paid 0 and the event says 0.
    function test_earlyAccept_carryingTheDelivery_feeBackToBuyer_zeroToSeller() public {
        (H.Terms memory t, bytes32 id) = _fundedZero();
        (H.Delivery memory dv, H.KeyProof memory k) = _delivery();
        H.EarlyAccept memory m = _early(t, id, BUYER_PK);
        bytes memory dsig = _deliverySig(id, dv, SELLER_PK);
        Bal memory b0 = _bal();

        _start();
        rules.earlyAccept(t, m, dv, dsig, k);
        Ev[] memory w = new Ev[](8);
        w[0] = _submitted(id);
        w[1] = _bondReleased(adjudicator);
        w[2] = _voided(t, FEE);
        w[3] = _storeCreated();
        w[4] = _completed(id, buyer, bytes32(0));
        w[5] = _released(id, 0);
        w[6] = _refunded(id, FEE);
        w[7] = _key(id, rules.KEY_EARLY_ACCEPT(), ENVELOPE);
        _check(w);

        _gained(b0, FEE, 0, 0, 0, 0);
        _word(id, HoldbackRules.Stage.Released, 1, HoldbackRules.AppealState.Closed, 0, 0); // L33
        _escrowHolds(t, 0, 0);
        _bondsUntouched();
    }

    /// The same after `deliver`: the call carries the posted delivery, so no `JobSubmitted`.
    function test_earlyAccept_afterDelivery_feeBackToBuyer_zeroToSeller() public {
        (H.Terms memory t, bytes32 id) = _fundedZero();
        (H.Delivery memory dv, H.KeyProof memory k) = _deliver(t, id);
        H.EarlyAccept memory m = _early(t, id, BUYER_PK);
        bytes memory dsig = _deliverySig(id, dv, SELLER_PK);
        Bal memory b0 = _bal();

        _start();
        rules.earlyAccept(t, m, dv, dsig, k);
        Ev[] memory w = new Ev[](7);
        w[0] = _bondReleased(adjudicator);
        w[1] = _voided(t, FEE);
        w[2] = _storeCreated();
        w[3] = _completed(id, buyer, bytes32(0));
        w[4] = _released(id, 0);
        w[5] = _refunded(id, FEE);
        w[6] = _key(id, rules.KEY_EARLY_ACCEPT(), ENVELOPE);
        _check(w);

        _gained(b0, FEE, 0, 0, 0, 0);
        _word(id, HoldbackRules.Stage.Released, 1, HoldbackRules.AppealState.Closed, 0, 0); // L33
        _escrowHolds(t, 0, 0);
        _bondsUntouched();
    }

    // ------------------------------------------------------------ the fallback escalates (L06, then L31)

    /// The fallback escalates: no money moves and nothing is reserved for it; the primary's reservation of 0 is
    /// released. The appeal adjudicator then takes the fee with an accept.
    function test_escalation_byTheFallback_thenAccepted_feeToAppealAdjudicator() public {
        (H.Terms memory t, bytes32 id) = _fundedZero();
        _toFallback(t, id);
        H.Decision memory e = _fallbackDecision(t, id, H.OUTCOME_ESCALATE);
        Bal memory b0 = _bal();

        _start();
        rules.decide(t, e, _noDelivery(), "");
        // `_toFallback` warped to judgeBy. A fixed value, because via-IR may re-read block.timestamp after a warp.
        uint256 at = t.timing.judgeBy;
        Ev[] memory w = new Ev[](2);
        w[0] = _decided(id, fallbackAdj, H.ROLE_FALLBACK, H.OUTCOME_ESCALATE, e.seed);
        w[1] = _bondReleased(adjudicator);
        _check(w);
        _gained(b0, 0, 0, 0, 0, 0);
        _word(id, HoldbackRules.Stage.Escalated, 1, HoldbackRules.AppealState.None, 0, at); // L06
        _escrowHolds(t, FEE, 0);

        H.Decision memory m = _appealDecision(t, id, at, H.OUTCOME_ACCEPT);
        _start();
        rules.decide(t, m, _noDelivery(), "");
        w = new Ev[](7);
        w[0] = _decided(id, appealAdj, H.ROLE_APPEAL, H.OUTCOME_ACCEPT, m.seed);
        w[1] = _captured(t, FEE, FEE, appealAdj);
        w[2] = _storeCreated();
        w[3] = _completed(id, appealAdj, RECORD);
        w[4] = _released(id, 0);
        w[5] = _key(id, rules.KEY_DECISION(), KEY_CT);
        w[6] = _feePaid(id, appealAdj, FEE);
        _check(w);

        _gained(b0, 0, 0, 0, 0, FEE);
        _word(id, HoldbackRules.Stage.Released, 1, HoldbackRules.AppealState.Closed, 0, at); // L31
        _escrowHolds(t, 0, FEE);
        _bondsUntouched();
    }

    // ------------------------------------------------------------ the buyer's own reclaim on the escrow (5.2)

    /// From the escrow's expiry the buyer takes the fee back on the escrow directly; the deal's word stays L05.
    /// `triggerDefault` then closes the deal, releases the reservation of 0, and skips the void and the `Refunded`
    /// event because nothing is held (`R:605-608`).
    function test_default_afterTheBuyersOwnEscrowReclaim_closesWithoutRefundEvent() public {
        (H.Terms memory t, bytes32 id) = _fundedZero();
        _toFallback(t, id);
        AuthCaptureEscrow.PaymentInfo memory pi = _pi(t);
        vm.warp(pi.authorizationExpiry);
        Bal memory b0 = _bal();

        _start();
        vm.prank(buyer);
        escrow.reclaim(pi);
        Ev[] memory w = new Ev[](2);
        w[0] = _ev(address(escrow), AuthCaptureEscrow.PaymentReclaimed.selector, _ph(t), abi.encode(FEE));
        w[1] = _storeCreated();
        _check(w);
        _gained(b0, FEE, 0, 0, 0, 0);
        _word(id, HoldbackRules.Stage.FallbackJudging, 1, HoldbackRules.AppealState.None, 1, t.timing.judgeBy); // L05
        _escrowHolds(t, 0, 0);

        _start();
        rules.triggerDefault(t);
        w = new Ev[](2);
        w[0] = _defaulted(id, HoldbackRules.Stage.FallbackJudging);
        w[1] = _bondReleased(adjudicator);
        _check(w);

        _gained(b0, FEE, 0, 0, 0, 0); // nothing more moved
        _word(id, HoldbackRules.Stage.Refunded, 1, HoldbackRules.AppealState.Closed, 0, t.timing.judgeBy); // L32
        _escrowHolds(t, 0, 0);
        _bondsUntouched();
    }

    // ------------------------------------------------------------ mutual settlement (L35, L36, L37)

    /// During the fallback's turn the primary's reservation of 0 is released; the fallback's fee share is 0 bps.
    function test_mutual_duringFallback_feeBackToBuyer() public {
        (H.Terms memory t, bytes32 id) = _fundedZero();
        _toFallback(t, id);
        H.Mutual memory m = _mutualMsg(t, id, new H.Payout[](0), false, _postedHash(id));
        H.KeyProof memory none;
        Bal memory b0 = _bal();

        _start();
        rules.mutualSettle(t, m, _noDelivery(), none);
        Ev[] memory w = new Ev[](5);
        w[0] = _bondReleased(adjudicator);
        w[1] = _voided(t, FEE);
        w[2] = _storeCreated();
        w[3] = _refunded(id, FEE);
        w[4] = _settled(id, false);
        _check(w);

        _gained(b0, FEE, 0, 0, 0, 0);
        _word(id, HoldbackRules.Stage.Settled, 1, HoldbackRules.AppealState.Closed, 0, t.timing.judgeBy); // L37
        _escrowHolds(t, 0, 0);
        _bondsUntouched();
    }


    /// The payouts must sum to the price, 0, and each must be above 0: only an empty list settles.
    function test_mutual_beforeDelivery_emptyPayouts_feeBackToBuyer() public {
        (H.Terms memory t, bytes32 id) = _fundedZero();
        H.Mutual memory m = _mutualMsg(t, id, new H.Payout[](0), false, bytes32(0));
        H.KeyProof memory none;
        Bal memory b0 = _bal();

        _start();
        rules.mutualSettle(t, m, _noDelivery(), none);
        Ev[] memory w = new Ev[](5);
        w[0] = _bondReleased(adjudicator);
        w[1] = _voided(t, FEE);
        w[2] = _storeCreated();
        w[3] = _refunded(id, FEE);
        w[4] = _settled(id, false);
        _check(w);

        _gained(b0, FEE, 0, 0, 0, 0);
        _word(id, HoldbackRules.Stage.Settled, 0, HoldbackRules.AppealState.Closed, 0, 0); // L35
        _escrowHolds(t, 0, 0);
        _bondsUntouched();
    }

    function test_mutual_afterDelivery_releasesTheKey_feeBackToBuyer() public {
        (H.Terms memory t, bytes32 id) = _fundedZero();
        (H.Delivery memory dv, H.KeyProof memory k) = _deliver(t, id);
        H.Mutual memory m = _mutualMsg(t, id, new H.Payout[](0), true, hx.delivery(id, dv));
        Bal memory b0 = _bal();

        _start();
        rules.mutualSettle(t, m, dv, k);
        Ev[] memory w = new Ev[](6);
        w[0] = _bondReleased(adjudicator);
        w[1] = _voided(t, FEE);
        w[2] = _storeCreated();
        w[3] = _refunded(id, FEE);
        w[4] = _settled(id, true);
        w[5] = _key(id, rules.KEY_MUTUAL(), ENVELOPE);
        _check(w);

        _gained(b0, FEE, 0, 0, 0, 0);
        _word(id, HoldbackRules.Stage.Settled, 1, HoldbackRules.AppealState.Closed, 0, 0); // L36
        _escrowHolds(t, 0, 0);
        _bondsUntouched();
    }

    /// During an escalation nothing is reserved, so no bond event; the appeal adjudicator's fee share is 0 bps.
    function test_mutual_duringEscalation_feeBackToBuyer() public {
        (H.Terms memory t, bytes32 id) = _fundedZero();
        (H.Delivery memory dv,) = _deliver(t, id);
        uint256 at = _escalateChecked(t, id);
        H.Mutual memory m = _mutualMsg(t, id, new H.Payout[](0), false, hx.delivery(id, dv));
        H.KeyProof memory none;
        Bal memory b0 = _bal();

        _start();
        rules.mutualSettle(t, m, _noDelivery(), none);
        Ev[] memory w = new Ev[](4);
        w[0] = _voided(t, FEE);
        w[1] = _storeCreated();
        w[2] = _refunded(id, FEE);
        w[3] = _settled(id, false);
        _check(w);

        _gained(b0, FEE, 0, 0, 0, 0);
        _word(id, HoldbackRules.Stage.Settled, 1, HoldbackRules.AppealState.Closed, 0, at); // L37
        _escrowHolds(t, 0, 0);
        _bondsUntouched();
    }

    /// No settlement of a zero-price deal pays anyone but the buyer: a payout above 0 breaks the sum, and a payout
    /// of 0 is refused on its own.
    function test_mutual_refusesAnyPayout() public {
        (H.Terms memory t, bytes32 id) = _fundedZero();
        H.KeyProof memory none;
        H.Payout[] memory one = new H.Payout[](1);
        one[0] = H.Payout(seller, 1);
        H.Mutual memory m = _mutualMsg(t, id, one, false, bytes32(0));
        vm.expectRevert(HoldbackRules.InvalidMessage.selector);
        rules.mutualSettle(t, m, _noDelivery(), none);

        one[0] = H.Payout(buyer, 1);
        m = _mutualMsg(t, id, one, false, bytes32(0));
        vm.expectRevert(HoldbackRules.InvalidMessage.selector);
        rules.mutualSettle(t, m, _noDelivery(), none);

        one[0] = H.Payout(address(0x9999), 1); // a third party
        m = _mutualMsg(t, id, one, false, bytes32(0));
        vm.expectRevert(HoldbackRules.InvalidMessage.selector);
        rules.mutualSettle(t, m, _noDelivery(), none);

        one[0] = H.Payout(seller, 0);
        m = _mutualMsg(t, id, one, false, bytes32(0));
        vm.expectRevert(HoldbackRules.InvalidMessage.selector);
        rules.mutualSettle(t, m, _noDelivery(), none);

        _word(id, HoldbackRules.Stage.Held, 0, HoldbackRules.AppealState.None, 1, 0); // still L03
        _escrowHolds(t, FEE, 0);
    }

    // ------------------------------------------------------------ price 0 and fee 0 (L01, L02)

    /// The hold would be 0, and the escrow refuses to authorize 0 (`E:179`): funding reverts with the escrow's
    /// `ZeroAmount()`, so nothing is stored, nothing is reserved and no token moves. Such an offer can only expire.
    /// Whether price 0 with fee 0 should be supported is Rafa's question; this test shows what happens today.
    function test_zeroPriceZeroFee_cannotFund_escrowRefusesZeroAmount() public {
        H.Terms memory t = _zeroTerms();
        t.fee = 0;
        bytes32 id = hx.id(t);
        bytes memory sellerSig = _sellerSig(t, SELLER_PK);
        H.Acceptance memory acc = _acceptance(t, ADJ_PK);
        H.Agree memory ag = _agree(t, BUYER_PK);
        H.Funding memory f = _erc3009(t, BUYER_PK);
        Bal memory b0 = _bal();

        // No `_check` here: Foundry's log recorder keeps the logs of a reverted call, so the proof is the state below.
        vm.expectRevert(AuthCaptureEscrow.ZeroAmount.selector);
        rules.agreeAndFund(t, sellerSig, acc, ag, f);

        HoldbackRules.Deal memory d = rules.dealOf(id);
        assertEq(uint8(d.stage), uint8(HoldbackRules.Stage.None), "still L01");
        assertEq(d.flags, 0);
        assertEq(d.seedTag, 0);
        (bool collected, uint120 c, uint120 r) = escrow.paymentState(_ph(t));
        assertFalse(collected, "the escrow recorded nothing");
        assertEq(c, 0);
        assertEq(r, 0);
        _gained(b0, 0, 0, 0, 0, 0);
        _bondsUntouched();

        // The Permit2 collector meets the same refusal: the check is the escrow's, before any collector runs.
        f = _permit2(t, BUYER_PK);
        vm.expectRevert(AuthCaptureEscrow.ZeroAmount.selector);
        rules.agreeAndFund(t, sellerSig, acc, ag, f);

        // The offer can only expire (L02).
        vm.warp(t.timing.fundBy);
        _start();
        rules.expireOffer(t);
        Ev[] memory w = new Ev[](1);
        w[0] = _jobExpired(id);
        _check(w);
        assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.Expired));
    }
}
