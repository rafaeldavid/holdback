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
///   `RulesInvariants.invariant_legalDealStates` runs after every step: three words that match no row of the state
///   model's table, and one word that matches row L05 but breaks the row's time bound;
/// - the "stores no delivery hash" mutant (`test/differential/planted/`, known issue G-5) trips the liveness counter
///   that `RulesInvariants.invariant_deliveryHashStored` asserts is zero, and fails the oracle too.
/// The legal paths stay legal: each scripted path of the handler lands on the row the table names for it.
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
        assertEq(StateOracle.rowOf(rules.dealOf(h.dealId(0)), rules.deliveryHashOf(h.dealId(0))), row);
    }

    // ------------------------------------------------------------ legal paths land on their rows

    function test_legalPaths_decisionAndAppeal() public {
        h.offer(OFFER);
        _at("L01");
        h.agreeAndFund(PICK, 0, 0);
        _at("L03");
        h.deliver(PICK, 5, 0);
        _at("L04");
        h.decide(PICK, 6, 0, H.OUTCOME_ACCEPT);
        _at("L07");
        h.fileAppeal(PICK, 1, 0, 0);
        _at("L11");
        vm.warp(block.timestamp + 1);
        h.decide(PICK, 6, 0, H.OUTCOME_REJECT);
        _at("L19");
    }

    function test_legalPaths_escalationAndEarlyAccept() public {
        h.offer(OFFER);
        h.agreeAndFund(PICK, 0, 0);
        h.deliver(PICK, 0, 0);
        h.decide(PICK, 0, 0, H.OUTCOME_ESCALATE);
        _at("L06");
        vm.warp(block.timestamp + 1);
        h.decide(PICK, 0, 0, H.OUTCOME_ACCEPT);
        _at("L31");

        setUp();
        h.offer(OFFER);
        h.agreeAndFund(PICK, 0, 0);
        h.earlyAccept(PICK, 3, 0);
        _at("L33");
    }

    function test_legalPaths_timeouts() public {
        h.offer(OFFER);
        h.agreeAndFund(PICK, 0, 0);
        vm.warp(h.termsOf(0).timing.deliverBy);
        h.reclaim(PICK, 6);
        _at("L34");

        setUp();
        h.offer(OFFER);
        h.agreeAndFund(PICK, 0, 0);
        h.deliver(PICK, 0, 0);
        vm.warp(h.termsOf(0).timing.judgeBy);
        h.triggerFallback(PICK, 6);
        _at("L05");
        vm.warp(h.termsOf(0).timing.fallbackBy);
        h.triggerDefault(PICK, 5);
        _at("L32");
    }

    function test_legalPaths_settlementAndExpiries() public {
        h.offer(OFFER);
        h.agreeAndFund(PICK, 0, 0);
        h.mutualSettle(PICK, 0, 0, 10 | (uint256(20) << 48) | (uint256(3) << 130));
        _at("L35");

        setUp();
        h.offer(OFFER);
        vm.warp(h.termsOf(0).timing.offerExpiresAt);
        h.expireOffer(PICK, 6);
        _at("L02");

        setUp();
        h.offer(OFFER);
        h.agreeAndFund(PICK, 0, 0);
        h.decide(PICK, 0, 0, H.OUTCOME_REJECT);
        _at("L08");
        vm.warp(rules.dealOf(h.dealId(0)).t1 + h.termsOf(0).timing.appealWindowSec);
        h.expireAppeal(PICK, 6);
        _at("L24");
    }

    // ------------------------------------------------------------ planted: illegal states

    /// The rules contract keeps `_deals` at storage slot 0 and `deliveryHashOf` at slot 1 (Solady's EIP712 keeps no
    /// storage); the word packs stage, attempt, appeal and flags into its four low bytes, then t1 (5 bytes).
    function _slot(bytes32 id, uint256 base) internal pure returns (bytes32) {
        return keccak256(abi.encode(id, base));
    }

    function _plantFails(bytes32 slot, uint256 word, string memory why) internal {
        vm.store(address(rules), slot, bytes32(word));
        assertEq(StateOracle.checkDeal(h, 0), why);
        vm.expectRevert();
        this.assertAllLegal(h);
    }

    function test_planted_illegalStatesFailTheOracle() public {
        h.offer(OFFER);
        h.agreeAndFund(PICK, 0, 0);
        bytes32 id = h.dealId(0);
        bytes32 slot = _slot(id, 0);
        uint256 word = uint256(vm.load(address(rules), slot));
        assertEq(uint8(word), uint8(HoldbackRules.Stage.Held), "slot 0 is not _deals");
        this.assertAllLegal(h);
        uint256 low = ~uint256(0xffffffff);
        StateOracle.State memory s;

        // 1. A held deal that reserves no bond (flags 0; illegal class I06).
        s = StateOracle.read(h, 0);
        s.d.flags = 0;
        _plantFails(slot, word & ~(uint256(0xff) << 24), string.concat("no legal row (section 2): ", StateOracle.describe(s)));

        // 2. A delivered deal with no stored delivery hash (I04).
        uint256 delivered = (word & low) | uint256(uint8(HoldbackRules.Stage.Delivered)) | (uint256(1) << 8)
            | (uint256(1) << 24);
        s.d.stage = HoldbackRules.Stage.Delivered;
        s.d.attempt = 1;
        s.d.flags = 1;
        _plantFails(slot, delivered, string.concat("no legal row (section 2): ", StateOracle.describe(s)));

        // 3. The same with its delivery hash, reserving both the primary's and the fallback's bond (flags 3; I05).
        vm.store(address(rules), _slot(id, 1), keccak256("a delivery"));
        assertEq(rules.deliveryHashOf(id), keccak256("a delivery"), "slot 1 is not deliveryHashOf");
        s.d.flags = 3;
        s.deliveryHash = keccak256("a delivery");
        _plantFails(
            slot,
            (delivered & ~(uint256(0xff) << 24)) | (uint256(3) << 24),
            string.concat("no legal row (section 2): ", StateOracle.describe(s))
        );

        // 4. A word that matches row L05 (the fallback's turn) but whose t1 is before judgeBy: only the row's time
        //    bound catches it.
        uint256 l05 = (word & low & ~(uint256(0xffffffffff) << 32)) | uint256(uint8(HoldbackRules.Stage.FallbackJudging))
            | (uint256(1) << 8) | (uint256(1) << 24) | (uint256(block.timestamp) << 32);
        assertLt(block.timestamp, h.termsOf(0).timing.judgeBy);
        _plantFails(slot, l05, "L05: t1 before judgeBy");
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
