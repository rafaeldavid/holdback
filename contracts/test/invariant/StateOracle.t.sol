// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";

import {HoldbackRules} from "../../src/HoldbackRules.sol";
import {HoldbackTypes as H} from "../../src/HoldbackTypes.sol";
import {RulesHandler} from "../handlers/RulesHandler.sol";
import {PlantedHandler} from "../differential/Sides.sol";
import {StateOracle} from "./StateOracle.sol";

/// T-341: the state oracle and the delivery liveness counter bite. Planted failures, kept as tests:
/// - illegal states written into the rules contract's storage fail the oracle that
///   `RulesInvariants.invariant_legalDealStates` runs after every step: three words that match no phase-one row,
///   and one word that matches row P04 but breaks the row's time bound;
/// - the "stores no delivery hash" mutant (`test/differential/planted/`, known issue G-5) trips the liveness counter
///   that `RulesInvariants.invariant_deliveryHashStored` asserts is zero, and fails the oracle too.
/// The legal paths stay legal: each scripted path of the handler lands on the row the table names for it.
/// T-346 (SC-7): the rows are the phase-one machine's (`docs/audit/state-model.md` section 9.3); the appeal rows and
/// the vault's illegal classes left with the cut.
contract StateOracleTest is Test {
    uint256 internal constant PICK = 1;
    // HandlerSmoke's ordered-timing offer (roles 2/3/4, a 16 s appealDecideSec).
    uint256 internal constant OFFER = (uint256(26_000_000) << 8) | (uint256(500_000) << 40) | (uint256(1) << 76)
        | (uint256(2) << 80) | (uint256(1) << 88) | (uint256(1) << 148);

    RulesHandler internal h;
    HoldbackRules internal rules;

    function setUp() public {
        h = new RulesHandler();
        (rules,,) = h.system();
    }

    /// The invariant's own check, callable so a test can expect it to fail.
    function assertAllLegal(RulesHandler handler) external view {
        for (uint256 i; i < handler.dealCount(); i++) {
            assertEq(StateOracle.checkDeal(handler, i), "", "illegal deal state");
        }
    }

    function _at(string memory row) internal view {
        assertEq(StateOracle.checkDeal(h, 0), "");
        assertEq(StateOracle.rowOf(StateOracle.read(h, 0)), row);
    }

    // ------------------------------------------------------------ legal paths land on their rows

    function test_legalPaths_primaryDecision() public {
        h.offer(OFFER);
        _at("P01");
        h.agreeAndFund(PICK, 0, 0);
        _at("P02");
        h.deliver(PICK, 5, 0);
        _at("P03");
        h.decide(PICK, 6, 0, H.OUTCOME_ACCEPT);
        _at("P06");

        setUp();
        h.offer(OFFER);
        h.agreeAndFund(PICK, 0, 0);
        h.decide(PICK, 0, 0, H.OUTCOME_REJECT);
        _at("P07");
    }

    function test_legalPaths_fallbackDecision() public {
        h.offer(OFFER);
        h.agreeAndFund(PICK, 0, 0);
        h.decideFallback(PICK, 0, H.OUTCOME_ACCEPT);
        _at("P08");

        setUp();
        h.offer(OFFER);
        h.agreeAndFund(PICK, 0, 0);
        h.decideFallback(PICK, 0, H.OUTCOME_REJECT);
        _at("P09");
    }

    function test_legalPaths_escalationAndEarlyAccept() public {
        h.offer(OFFER);
        h.agreeAndFund(PICK, 0, 0);
        h.deliver(PICK, 0, 0);
        h.decide(PICK, 0, 0, H.OUTCOME_ESCALATE);
        _at("P05");
        vm.warp(block.timestamp + 1);
        h.decide(PICK, 0, 0, H.OUTCOME_ACCEPT);
        _at("P10");

        setUp();
        h.offer(OFFER);
        h.agreeAndFund(PICK, 0, 0);
        h.deliver(PICK, 0, 0);
        h.decide(PICK, 0, 0, H.OUTCOME_ESCALATE);
        vm.warp(block.timestamp + 1);
        h.decide(PICK, 0, 0, H.OUTCOME_REJECT);
        _at("P11");

        setUp();
        h.offer(OFFER);
        h.agreeAndFund(PICK, 0, 0);
        h.earlyAccept(PICK, 3, 0);
        _at("P13");
    }

    function test_legalPaths_timeouts() public {
        h.offer(OFFER);
        h.agreeAndFund(PICK, 0, 0);
        vm.warp(h.termsOf(0).timing.deliverBy);
        h.reclaim(PICK, 6);
        _at("P14");

        setUp();
        h.offer(OFFER);
        h.agreeAndFund(PICK, 0, 0);
        h.deliver(PICK, 0, 0);
        vm.warp(h.termsOf(0).timing.judgeBy);
        h.triggerFallback(PICK, 6);
        _at("P04");
        vm.warp(h.termsOf(0).timing.fallbackBy);
        h.triggerDefault(PICK, 5);
        _at("P12");
    }

    function test_legalPaths_settlementAndExpiry() public {
        h.offer(OFFER);
        h.agreeAndFund(PICK, 0, 0);
        h.mutualSettle(PICK, 0, 0, 10 | (uint256(20) << 48) | (uint256(3) << 130));
        _at("P15");

        setUp();
        h.offer(OFFER);
        h.agreeAndFund(PICK, 0, 0);
        h.deliver(PICK, 0, 0);
        h.mutualSettle(PICK, 0, 0, 10 | (uint256(20) << 48));
        _at("P16");

        setUp();
        h.offer(OFFER);
        h.agreeAndFund(PICK, 0, 0);
        h.deliver(PICK, 0, 0);
        vm.warp(h.termsOf(0).timing.judgeBy);
        h.triggerFallback(PICK, 6);
        h.mutualSettle(PICK, 0, 0, 10 | (uint256(20) << 48));
        _at("P17");

        // SC-6 (T-356): no expiry is recorded on chain, so an unfunded offer past its expiry is still P01.
        setUp();
        h.offer(OFFER);
        vm.warp(h.termsOf(0).timing.offerExpiresAt);
        vm.expectRevert(RulesHandler.Refused.selector);
        h.expireOffer(PICK, 6);
        _at("P01");
    }

    // ------------------------------------------------------------ planted: illegal states

    /// The rules contract keeps `_deals` at storage slot 0 and `deliveryHashOf` at slot 1 (Solady's EIP712 keeps no
    /// storage); the phase-one word packs stage and attempt into its two low bytes, then t1 (5 bytes from bit 16),
    /// then the seed tag (18 bytes from bit 56), then the closing reason (byte 25) and the decider (byte 26; RF-4).
    function _slot(bytes32 id, uint256 base) internal pure returns (bytes32) {
        return keccak256(abi.encode(id, base));
    }

    function _plantFails(bytes32 slot, uint256 word, string memory why) internal {
        vm.store(address(rules), slot, bytes32(word));
        assertEq(StateOracle.checkDeal(h, 0), why);
        vm.expectRevert();
        this.assertAllLegal(h);
    }

    /// T-375 (RF-4): a stored closing reason or decider that is not how the deal closed fails the oracle, even when
    /// every other field matches the row: a reclaimed deal (P14) whose word says it defaulted, and a deal the primary
    /// decided (P06) whose word names the fallback.
    function test_planted_wrongStoredReasonOrDeciderFailsTheOracle() public {
        h.offer(OFFER);
        h.agreeAndFund(PICK, 0, 0);
        vm.warp(h.termsOf(0).timing.deliverBy);
        h.reclaim(PICK, 6);
        _at("P14");
        bytes32 slot = _slot(h.dealId(0), 0);
        uint256 word = uint256(vm.load(address(rules), slot));
        assertEq((word >> 200) & 0xff, uint8(HoldbackRules.Reason.Reclaimed), "byte 25 is not the closing reason");
        _plantFails(
            slot,
            (word & ~(uint256(0xff) << 200)) | (uint256(uint8(HoldbackRules.Reason.Defaulted)) << 200),
            "P14: the stored closing reason or decider is not how the deal closed"
        );

        setUp();
        h.offer(OFFER);
        h.agreeAndFund(PICK, 0, 0);
        h.deliver(PICK, 5, 0);
        h.decide(PICK, 6, 0, H.OUTCOME_ACCEPT);
        _at("P06");
        slot = _slot(h.dealId(0), 0);
        word = uint256(vm.load(address(rules), slot));
        assertEq((word >> 208) & 0xff, uint8(HoldbackRules.Decider.Primary), "byte 26 is not the decider");
        _plantFails(
            slot,
            (word & ~(uint256(0xff) << 208)) | (uint256(uint8(HoldbackRules.Decider.Fallback)) << 208),
            "P06: the stored closing reason or decider is not how the deal closed"
        );
    }

    function test_planted_illegalStatesFailTheOracle() public {
        h.offer(OFFER);
        h.agreeAndFund(PICK, 0, 0);
        bytes32 id = h.dealId(0);
        bytes32 slot = _slot(id, 0);
        uint256 word = uint256(vm.load(address(rules), slot));
        assertEq(uint8(word), uint8(HoldbackRules.Stage.Held), "slot 0 is not _deals");
        assertEq(h.word(id).seedTag, h.seedTag(), "the word's layout is not stage, attempt, t1, seedTag");
        this.assertAllLegal(h);
        uint256 low = ~uint256(0xffff);
        StateOracle.State memory s = StateOracle.read(h, 0);

        // 1. A held deal whose t1 is set (illegal class I13: no write sets t1 in Held).
        s.d.t1 = uint40(block.timestamp);
        _plantFails(
            slot,
            word | (uint256(block.timestamp) << 16),
            string.concat("no legal row (section 9): ", StateOracle.describe(s))
        );

        // 2. A delivered deal with no stored delivery hash (I04).
        uint256 delivered = (word & low) | uint256(uint8(HoldbackRules.Stage.Delivered)) | (uint256(1) << 8);
        s.d.stage = HoldbackRules.Stage.Delivered;
        s.d.attempt = 1;
        s.d.t1 = 0;
        _plantFails(slot, delivered, string.concat("no legal row (section 9): ", StateOracle.describe(s)));

        // 3. A Released deal that no action closed: the handler recorded no closing reason (a stage written behind
        //    every entry point's back), with its delivery hash and a decision time.
        vm.store(address(rules), _slot(id, 1), keccak256("a delivery"));
        assertEq(rules.deliveryHashOf(id), keccak256("a delivery"), "slot 1 is not deliveryHashOf");
        s.d.stage = HoldbackRules.Stage.Released;
        s.d.t1 = uint40(block.timestamp);
        s.deliveryHash = keccak256("a delivery");
        _plantFails(
            slot,
            (word & low) | uint256(uint8(HoldbackRules.Stage.Released)) | (uint256(1) << 8)
                | (uint256(block.timestamp) << 16),
            string.concat("no legal row (section 9): ", StateOracle.describe(s))
        );

        // 4. A word that matches row P04 (the fallback's turn) but whose t1 is before judgeBy: only the row's time
        //    bound catches it.
        uint256 p04 = (word & low) | uint256(uint8(HoldbackRules.Stage.FallbackJudging)) | (uint256(1) << 8)
            | (uint256(block.timestamp) << 16);
        assertLt(block.timestamp, h.termsOf(0).timing.judgeBy);
        _plantFails(slot, p04, "P04: t1 before judgeBy");
    }

    /// An escalated word whose terms put fallbackBy before judgeBy (D31 allows any order until SC-5): the primary
    /// may escalate in [fallbackBy, judgeBy), which is legal; an escalation at or after both deadlines is not.
    function _escalated(uint40 t1, uint64 judgeBy, uint64 fallbackBy)
        internal
        view
        returns (StateOracle.State memory s, H.Terms memory t)
    {
        t = h.termsOf(0);
        t.timing.judgeBy = judgeBy;
        t.timing.fallbackBy = fallbackBy;
        s.d = HoldbackRules.Deal({
            stage: HoldbackRules.Stage.Escalated,
            attempt: 1,
            t1: t1,
            seedTag: h.seedTag(),
            reason: HoldbackRules.Reason.Open,
            decider: HoldbackRules.Decider.None
        });
        s.deliveryHash = keccak256("a delivery");
        s.seedTag = h.seedTag();
        s.capturable = uint120(t.price + t.fee);
    }

    function test_escalationBound_isTheLaterDeadline() public {
        h.offer(OFFER);
        // fallbackBy 1000 < judgeBy 2000: a primary escalation at 1500 is legal.
        (StateOracle.State memory s, H.Terms memory t) = _escalated(1500, 2000, 1000);
        assertEq(StateOracle.check(s, t, StateOracle.rows()), "");
        // At 2000, after both deadlines, it is not.
        (s, t) = _escalated(2000, 2000, 1000);
        assertEq(StateOracle.check(s, t, StateOracle.rows()), "P05: escalated at or after both judgeBy and fallbackBy");
        // The usual order: at fallbackBy it is not legal either.
        (s, t) = _escalated(3000, 2000, 3000);
        assertEq(StateOracle.check(s, t, StateOracle.rows()), "P05: escalated at or after both judgeBy and fallbackBy");
        (s, t) = _escalated(2999, 2000, 3000);
        assertEq(StateOracle.check(s, t, StateOracle.rows()), "");
    }

    // ------------------------------------------------------------ planted: the "stores no delivery hash" mutant

    function test_planted_noDeliveryHashFailsTheLivenessInvariant() public {
        PlantedHandler p = new PlantedHandler();
        (HoldbackRules mutant,,) = p.system();
        p.offer(OFFER);
        p.agreeAndFund(PICK, 0, 0);
        p.deliver(PICK, 5, 0);
        bytes32 id = p.dealId(0);
        // What invariant_deliveryHashStored asserts, false on the mutant: the counter is not zero, and the stored
        // hash is not the posted delivery's.
        assertEq(p.deliveries(), 1);
        assertEq(p.deliveryHashLost(), 1, "the liveness counter missed the lost delivery hash");
        assertEq(mutant.deliveryHashOf(id), bytes32(0));
        assertTrue(p.postedHash(id) != bytes32(0));
        // The oracle sees it too: a Delivered word with no stored delivery hash matches no row.
        vm.expectRevert();
        this.assertAllLegal(p);
    }
}
