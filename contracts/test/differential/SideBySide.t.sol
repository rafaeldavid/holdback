// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {AuthCaptureEscrow} from "commerce-payments/AuthCaptureEscrow.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {HoldbackRules} from "../../src/HoldbackRules.sol";
import {HoldbackBonds} from "../../src/HoldbackBonds.sol";
import {RulesHandler} from "../handlers/RulesHandler.sol";

import {AllowList} from "./AllowList.sol";
import {Field, Fields, Obs} from "./Observation.sol";
import {NewSide, OldSide, PlantedSide} from "./Sides.sol";

/// @title The side-by-side harness (T-341, refinement gate VG-1)
/// @notice The old contracts (`old/`, the deployed commit 64be1f1) and the source under test (`contracts/src/`)
///         take the same random sequence of invariant-handler actions from the same starting state, at the same
///         addresses. After every step the harness compares every field of `Observation.sol`: the action's result,
///         every checked call's outcome, every event, every token balance, every hold, the vault, every deal's
///         stage and stored word, and the clock. A difference fails the run unless `AllowList.sol` names the change
///         that makes it. A sequence is a pure function of its seed: a failure prints the seed and the command that
///         replays it.
/// @dev How it runs. From one snapshot the harness creates the old side, runs the whole sequence and keeps each
///      step's observation in memory; it reverts to the snapshot, creates the new side (same addresses, since the
///      test contract's nonce is restored), runs the same sequence and compares step by step. Every action is one
///      of the 19 the invariant campaign targets, with four pseudo-random words as its arguments (an action reads
///      the ones it takes).
contract SideBySideTest is Test {
    uint256 internal constant DEPTH = 100;
    uint256 internal constant ACTIONS = 19;

    enum Kind {
        New,
        Planted
    }

    struct Result {
        bool differs;
        uint256 step;
        Field field;
        bytes4 action;
        uint256 allowed; // differences the allow-list allowed
        uint256 landed; // successful checked calls on the old side (the run is not vacuous)
        uint256 stagesSeen; // bit s set: some deal stood in stage s after some step
    }

    uint256 internal constant WEIGHTS = 32;
    uint256 internal constant WARM_UP = 12;

    bytes4[ACTIONS] internal _sel;
    string[ACTIONS] internal _name;
    uint8[WEIGHTS] internal _weight; // indices into _sel, each repeated by its weight

    function setUp() public {
        // offer 3, agreeAndFund 4, deliver 3, decide 3, fileAppeal 2, warp 2, decideAppeal 2, decideFallback 2, every
        // other action 1: 32 in all.
        _weight = [0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 5, 6, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 16, 17, 17, 18, 18];
        _sel = [
            RulesHandler.offer.selector,
            RulesHandler.agreeAndFund.selector,
            RulesHandler.deliver.selector,
            RulesHandler.decide.selector,
            RulesHandler.earlyAccept.selector,
            RulesHandler.mutualSettle.selector,
            RulesHandler.fileAppeal.selector,
            RulesHandler.expireOffer.selector,
            RulesHandler.reclaim.selector,
            RulesHandler.triggerFallback.selector,
            RulesHandler.triggerDefault.selector,
            RulesHandler.expireAppeal.selector,
            RulesHandler.bondDeposit.selector,
            RulesHandler.bondWithdraw.selector,
            RulesHandler.cppReclaim.selector,
            RulesHandler.stranger.selector,
            RulesHandler.warp.selector,
            RulesHandler.decideAppeal.selector,
            RulesHandler.decideFallback.selector
        ];
        _name = [
            string("offer"),
            "agreeAndFund",
            "deliver",
            "decide",
            "earlyAccept",
            "mutualSettle",
            "fileAppeal",
            "expireOffer",
            "reclaim",
            "triggerFallback",
            "triggerDefault",
            "expireAppeal",
            "bondDeposit",
            "bondWithdraw",
            "cppReclaim",
            "stranger",
            "warp",
            "decideAppeal",
            "decideFallback"
        ];
    }

    // ------------------------------------------------------------ the gate

    /// VG-1: the old and the new contracts behave the same on random sequences, apart from allowed differences.
    /// forge-config: default.fuzz.runs = 256
    function testFuzz_sideBySide(uint256 seed) public {
        _assertSame(seed);
    }

    /// Replays one sequence: `SIDE_BY_SIDE_SEED=<seed> forge test --mt test_sideBySide_replay -vv`.
    function test_sideBySide_replay() public {
        uint256 seed = vm.envOr("SIDE_BY_SIDE_SEED", uint256(0));
        console.log("side-by-side seed", seed);
        Result memory r = _assertSame(seed);
        console.log("checked calls that landed on the old side", r.landed);
        console.log("allowed differences", r.allowed);
    }

    /// The gate is not vacuous: over 16 fixed seeds the sequences fund, deliver and settle deals, and between them
    /// reach every stage but `None` after funding (Held, Delivered, FallbackJudging, Escalated, Released, Refunded,
    /// Settled, Expired).
    function test_sideBySide_reachesEveryStage() public {
        uint256 seen;
        uint256 landed;
        for (uint256 s = 1; s <= 16; s++) {
            Result memory r = _assertSame(s);
            seen |= r.stagesSeen;
            landed += r.landed;
            console.log("seed", s, "checked calls landed", r.landed);
        }
        assertEq(seen >> 1, uint256(0xff), "some stage was never reached");
        // 239 landed on 2026-11-11 (measured); the floor leaves room for changes to the handler's mix.
        assertGt(landed, 150, "too few checked calls landed");
    }

    /// The planted behaviour change fails the harness: a copy that stores no delivery hash (`planted/`) differs
    /// from the old side, with the real allow-list in force, on every one of these seeds. Each failure names the
    /// step, the action and the field.
    function test_planted_failsTheHarness() public {
        uint256 caught;
        for (uint256 s = 1; s <= 8; s++) {
            Result memory r = _compare(s, Kind.Planted);
            if (!r.differs) continue;
            caught++;
            console.log(_report(s, r));
        }
        assertEq(caught, 8, "the harness missed the planted change on some seed");
    }

    // ------------------------------------------------------------ the run

    function _assertSame(uint256 seed) internal returns (Result memory r) {
        r = _compare(seed, Kind.New);
        assertFalse(r.differs, _report(seed, r));
    }

    function _report(uint256 seed, Result memory r) internal view returns (string memory) {
        return string.concat(
            "side-by-side: step ",
            vm.toString(r.step),
            ", action ",
            _actionName(r.action),
            ", field ",
            Fields.name(r.field),
            " differs and no allow-list entry allows it; seed ",
            vm.toString(seed),
            ". Replay: SIDE_BY_SIDE_SEED=",
            vm.toString(seed),
            " forge test --mt test_sideBySide_replay -vv"
        );
    }

    function _actionName(bytes4 s) internal view returns (string memory) {
        for (uint256 i; i < ACTIONS; i++) {
            if (_sel[i] == s) return _name[i];
        }
        return "?";
    }

    /// Runs seed `seed` on the old side and on the `kind` side and compares them step by step. Gas metering is
    /// paused for the harness's own work (worlds, traces, reads, comparisons) and resumed only around each action
    /// (`_step`), so a sequence fits the test's gas limit. Memory is reused between steps and between calls, so
    /// several seeds fit in one test.
    function _compare(uint256 seed, Kind kind) internal returns (Result memory r) {
        uint256 fmp;
        assembly {
            fmp := mload(0x40)
        }
        vm.pauseGasMetering();
        r = _compareFrom(seed, kind);
        vm.resumeGasMetering();
        // Keep only the result: copy it to the start of the memory this call used, and free the rest.
        Result memory kept = r;
        assembly {
            mstore(0x40, fmp)
        }
        r = Result(kept.differs, kept.step, kept.field, kept.action, kept.allowed, kept.landed, kept.stagesSeen);
    }

    function _compareFrom(uint256 seed, Kind kind) internal returns (Result memory r) {
        uint256 base = vm.snapshotState();
        RulesHandler a = new OldSide();
        address[6] memory where = _where(a);
        _startRecording();
        Obs[] memory old = new Obs[](DEPTH);
        bytes32[][] memory oldDigest = new bytes32[][](DEPTH);
        for (uint256 i; i < DEPTH; i++) {
            old[i] = _step(a, seed, i);
            oldDigest[i] = _digests(old[i]);
            for (uint256 c; c < old[i].calls.length; c++) {
                (bool landed,) = abi.decode(old[i].calls[c], (bool, bytes));
                if (landed) r.landed++;
            }
        }
        vm.revertToState(base);

        RulesHandler b = kind == Kind.New ? RulesHandler(new NewSide()) : RulesHandler(new PlantedSide());
        address[6] memory there = _where(b);
        for (uint256 k; k < 6; k++) {
            // The sides must create the same contracts in the same order (`Sides.sol`, `PinnedSide.setUp`).
            assertEq(there[k], where[k], "the sides deployed at different addresses: align PinnedSide.setUp");
        }
        _startRecording();
        for (uint256 i; i < DEPTH; i++) {
            uint256 fmp;
            assembly {
                fmp := mload(0x40)
            }
            Obs memory n = _step(b, seed, i);
            r.stagesSeen |= _stageMask(n);
            bytes32[] memory nd = _digests(n);
            for (uint256 f; f < Fields.COUNT; f++) {
                if (oldDigest[i][f] == nd[f]) continue;
                Field field = Field(f);
                string memory change = AllowList.allowed(field, old[i], n);
                if (bytes(change).length == 0) {
                    (r.differs, r.step, r.field, r.action) = (true, i, field, n.action);
                    vm.revertToState(base);
                    return r;
                }
                r.allowed++;
                console.log(string.concat("allowed by ", change, ": step ", vm.toString(i), ", ", Fields.name(field)));
            }
            // This step's observation is no longer needed: reuse its memory.
            assembly {
                mstore(0x40, fmp)
            }
        }
        vm.revertToState(base);
    }

    function _digests(Obs memory o) internal pure returns (bytes32[] memory d) {
        d = new bytes32[](Fields.COUNT);
        for (uint256 f; f < Fields.COUNT; f++) {
            d[f] = Fields.digest(o, Field(f));
        }
    }

    function _startRecording() internal {
        vm.recordLogs();
        vm.getRecordedLogs();
    }

    function _where(RulesHandler h) internal view returns (address[6] memory w) {
        (HoldbackRules rules, HoldbackBonds bonds, AuthCaptureEscrow escrow) = h.system();
        address[2] memory tk = h.tokens();
        w = [address(h), address(rules), address(bonds), address(escrow), tk[0], tk[1]];
    }

    /// One step: the action is drawn from `_weight` (the deal flow's actions more often than the rest, so a
    /// sequence funds, delivers and settles deals), its four arguments are hashes of the seed and the step. Only the
    /// action is gas-metered; the trace and the reads around it are the harness's own cost.
    function _step(RulesHandler h, uint256 seed, uint256 i) internal returns (Obs memory o) {
        uint256 r = uint256(keccak256(abi.encode(seed, i)));
        // The first WARM_UP steps only offer and fund, before any warp, so most sequences hold several deals.
        o.action = i < WARM_UP ? _sel[r % 2] : _sel[_weight[r % WEIGHTS]];
        bool full = o.action == RulesHandler.offer.selector;
        bytes memory data =
            abi.encodeWithSelector(o.action, _arg(r, 1, full), _arg(r, 2, full), _arg(r, 3, full), _arg(r, 4, full));
        vm.resumeGasMetering();
        (o.ok, o.ret) = address(h).call(data);
        vm.pauseGasMetering();
        (o.calls, o.events) = h.takeTrace();
        _observe(h, o);
    }

    /// An action's k-th argument: a full pseudo-random word, or one time in four a small one (0 to 255), as the
    /// invariant fuzzer's dictionary often supplies. A small seed picks the authorised key at every signature, so
    /// more deals get funded and decided. `offer` always takes a full word: its seed is the terms.
    function _arg(uint256 r, uint256 k, bool full) internal pure returns (uint256 a) {
        a = uint256(keccak256(abi.encode(r, k)));
        if (!full && a % 4 == 0) a = (a >> 8) % 256;
    }

    /// Reads the world's state through the new source's ABI. Raw `dealOf` bytes, so a change to the deal's
    /// stored word shows even where the decoded stage does not.
    function _observe(RulesHandler h, Obs memory o) internal view {
        (HoldbackRules rules, HoldbackBonds bonds,) = h.system();
        address[] memory holders = h.holders();
        address[2] memory tk = h.tokens();
        address[7] memory actors = h.actors();
        uint256 n = h.dealCount();

        // Both tokens and ether, for every holder; plus the rules contract and the vault, which must hold no ether.
        uint256[] memory bal = new uint256[](3 * holders.length + 2);
        for (uint256 k; k < holders.length; k++) {
            bal[k] = IERC20(tk[0]).balanceOf(holders[k]);
            bal[holders.length + k] = IERC20(tk[1]).balanceOf(holders[k]);
            bal[2 * holders.length + k] = holders[k].balance;
        }
        bal[3 * holders.length] = address(rules).balance;
        bal[3 * holders.length + 1] = address(bonds).balance;
        o.balances = abi.encode(holders, bal);

        uint256[] memory vault = new uint256[](6 * actors.length + n);
        for (uint256 j; j < 2; j++) {
            for (uint256 k; k < actors.length; k++) {
                uint256 at = 3 * (j * actors.length + k);
                vault[at] = bonds.bondOf(actors[k], tk[j]);
                vault[at + 1] = bonds.encumberedOf(actors[k], tk[j]);
                vault[at + 2] = bonds.freeOf(actors[k], tk[j]);
            }
        }

        bytes32[] memory ids = new bytes32[](n);
        uint8[] memory stages = new uint8[](n);
        bytes[] memory words = new bytes[](n);
        bytes32[] memory delivered = new bytes32[](n);
        bytes[] memory holds = new bytes[](n);
        for (uint256 i; i < n; i++) {
            bytes32 id = h.dealId(i);
            ids[i] = id;
            stages[i] = uint8(rules.dealOf(id).stage);
            (, words[i]) = address(rules).staticcall(abi.encodeCall(HoldbackRules.dealOf, (id)));
            delivered[i] = rules.deliveryHashOf(id);
            (bool collected, uint120 capturable, uint120 refundable) = h.holdOf(i);
            holds[i] = abi.encode(collected, capturable, refundable);
            (address appellant, uint96 appealBond) = bonds.appealBondOf(id);
            vault[6 * actors.length + i] = (uint256(uint160(appellant)) << 96) | appealBond;
        }
        o.holds = abi.encode(holds);
        o.bonds = abi.encode(actors, vault);
        o.stages = abi.encode(ids, stages);
        o.words = abi.encode(words, delivered);
        o.clock = block.timestamp;
    }

    function _stageMask(Obs memory o) internal pure returns (uint256 mask) {
        (, uint8[] memory stages) = abi.decode(o.stages, (bytes32[], uint8[]));
        for (uint256 i; i < stages.length; i++) {
            mask |= 1 << stages[i];
        }
    }
}
