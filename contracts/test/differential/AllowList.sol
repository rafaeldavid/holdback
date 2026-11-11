// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {HoldbackRules} from "../../src/HoldbackRules.sol";
import {RulesHandler} from "../handlers/RulesHandler.sol";
import {Field, Obs} from "./Observation.sol";

/// @title The side-by-side harness's allow-list (T-341, refinement gate VG-1)
/// @notice The differences between the old contracts (`old/`, commit 64be1f1) and the source under test that a
///         change is allowed to make. A refactor's list stays empty (the plan's rule 3).
/// @dev How a change on `contracts-audit-ready` adds an entry: one `if` per difference, testing the exact
///      difference (the action, the field, and the values on both sides), never a whole field, with the change's
///      ID and the reason beside it. An entry returns `Verdict(change, diverged)`:
///      - `diverged = false`: the difference is confined to this step, or to fields the new side no longer has;
///        the comparison goes on. Use it for an event no longer emitted, or a refusal that leaves both sides in the
///        same shared state.
///      - `diverged = true`: the two sides now hold different shared state by design. The harness compares this
///        step's other fields, then stops comparing the seed and reports "diverged by <change> at step <n>".
///        `test_sideBySide_reachesEveryRow` fails when more than a quarter of its seeds diverge, so an entry cannot
///        quietly switch the gate off.
///      Every entry below tests that the new side has the phase-one shape (no vault, the four-field word, the
///      removed selectors refused), so none can allow a difference between two builds of the deployed contracts,
///      such as the planted mutant against the old side.
///
///      T-346, SC-7 (ADR-0031 §8, D57): no party appeal and no bond. Exactly these differences, and no other:
///      1. Bonds: the new side has no vault, so it reports none (the old side reports its totals and appeal bonds).
///      2. Surface: `BONDS()` and `KEY_APPEAL()` are gone from the new side; every other view and immutable is equal.
///      3. Words: the new side's word drops `appeal`, `flags` and `t2`; its stage, attempt, `t1` and seed tag, and
///         every stored delivery hash, equal the old side's.
///      4. Events: the old side's vault events (all seven kinds), the token transfers into or out of the vault,
///         `AppealFiled`, `AppealClosed` and a `KeyReleased` on path 3 (`KEY_APPEAL`) are not emitted by the new
///         side; every other event is equal, in order.
///      5. Balances: the old side's vault holds the bond deposits; the same address holds nothing on the new side;
///         every other balance is equal.
///      6. Calls, `fileAppeal` and `expireAppeal`: the new side has no such function and reverts with empty data.
///      7. Calls, a decision on a decided deal (`decide`, `decideAppeal`, `decideFallback`): the new side refuses it with
///         `WrongStage(Released or Refunded)`, where the old side may take it as an appeal decision or refuse it
///         for another reason.
///      8. Balances, `decideAppeal`: when the old side's appeal adjudicator overturns, the old side pays the wronged
///         party the price from the first decider's bond. The sides' balances then differ by design: diverged.
///      9. Events, the same decision: the old side's appeal decision emits the appeal adjudicator's `Decided`
///         (role 2) besides the cut events; the new side refused it and emitted nothing.
///      The acceptance's `bondReserved` (0 on the new side, the price on the old) is signed per side by the
///      handler's hook, so it never shows; `PhaseOneNoBonds.t.sol` proves the refusal of any other value.
library AllowList {
    struct Verdict {
        string change; // the change that allows the difference; "" when none does
        bool diverged; // the sides now differ in shared state by design: stop comparing this seed
    }

    /// The verdict for field `f` differing between `o` (old) and `n` (new) at step `step`, with the rules
    /// contract's address and the address where the deployed contracts keep their vault (both the same on the
    /// two sides).
    function allowed(Field f, uint256 step, Obs memory o, Obs memory n, address rules, address vault)
        internal
        pure
        returns (Verdict memory v)
    {
        step;
        if (f == Field.Bonds && n.bonds.length == 0 && o.bonds.length != 0) return Verdict("SC-7: no vault", false);
        if (f == Field.Surface && _surfaceApartFromCut(o.surface, n.surface)) {
            return Verdict("SC-7: BONDS and KEY_APPEAL gone", false);
        }
        if (f == Field.Words && _sameSharedWords(o.words, n.words)) {
            return Verdict("SC-7: word without appeal, flags, t2", false);
        }
        if (f == Field.Events && _sameApartFromCut(o.events, n.events, rules, vault)) {
            return Verdict("SC-7: appeal and vault events", false);
        }
        if (f == Field.Balances && _sameApartFromVault(o.balances, n.balances, vault)) {
            return Verdict("SC-7: no bond deposits", false);
        }
        if (f == Field.Calls && _removedEntryPoint(o, n)) return Verdict("SC-7: appeal entry points gone", false);
        if (f == Field.Calls && _decisionOnDecided(o, n)) return Verdict("SC-7: no appeal decision", false);
        if (f == Field.Events && _decisionOnDecided(o, n) && _landed(o.calls) && _appealDecisionEvents(o.events, n.events, rules, vault)) {
            return Verdict("SC-7: no appeal decision events", false);
        }
        if (
            f == Field.Balances && o.action == RulesHandler.decideAppeal.selector && _landed(o.calls)
                && _refusedAsDecided(n.calls)
        ) {
            return Verdict("SC-7: no overturn payout", true);
        }
        return v;
    }

    // ------------------------------------------------------------ the entries' exact tests

    /// Entry 2: every view's raw return is equal, except `BONDS()` (index 4) and `KEY_APPEAL()` (index 10), which the
    /// new side does not have: its call fails with empty data. The indices are `SideBySide._surface`'s.
    function _surfaceApartFromCut(bytes memory os, bytes memory ns) private pure returns (bool) {
        bytes[] memory o = abi.decode(os, (bytes[]));
        bytes[] memory n = abi.decode(ns, (bytes[]));
        if (o.length != n.length) return false;
        bytes32 gone = keccak256(abi.encode(false, bytes("")));
        for (uint256 i; i < o.length; i++) {
            if (i == 4 || i == 10) {
                (bool ok,) = abi.decode(o[i], (bool, bytes));
                if (!ok || keccak256(n[i]) != gone) return false;
            } else if (keccak256(o[i]) != keccak256(n[i])) {
                return false;
            }
        }
        return true;
    }

    /// Entry 3: each old word is the deployed contracts' seven fields (stage, attempt, appeal, flags, t1, t2,
    /// seedTag), each new word phase one's four (stage, attempt, t1, seedTag). The shared four, and every stored
    /// delivery hash, are equal.
    function _sameSharedWords(bytes memory ow, bytes memory nw) private pure returns (bool) {
        (bytes[] memory o, bytes32[] memory od) = abi.decode(ow, (bytes[], bytes32[]));
        (bytes[] memory n, bytes32[] memory nd) = abi.decode(nw, (bytes[], bytes32[]));
        if (o.length != n.length || keccak256(abi.encode(od)) != keccak256(abi.encode(nd))) return false;
        for (uint256 i; i < o.length; i++) {
            if (o[i].length != 224 || n[i].length != 128) return false;
            uint256[7] memory a = abi.decode(o[i], (uint256[7]));
            uint256[4] memory b = abi.decode(n[i], (uint256[4]));
            if (a[0] != b[0] || a[1] != b[1] || a[4] != b[2] || a[6] != b[3]) return false;
        }
        return true;
    }

    /// Entry 4: the old side's events with the cut ones taken out equal the new side's, in order. Cut: every event
    /// the vault emits; the rules contract's `AppealFiled` and `AppealClosed`; and its `KeyReleased` on path 3.
    function _sameApartFromCut(bytes[] memory o, bytes[] memory n, address rules, address vault)
        private
        pure
        returns (bool)
    {
        uint256 j;
        for (uint256 i; i < o.length; i++) {
            if (_isCut(o[i], rules, vault)) continue;
            if (j == n.length || keccak256(o[i]) != keccak256(n[j])) return false;
            j++;
        }
        if (j != n.length) return false;
        // The new side emits none of the cut events itself.
        for (uint256 k; k < n.length; k++) {
            if (_isCut(n[k], rules, vault)) return false;
        }
        return true;
    }

    /// Entry 9: the old side took a decision on a decided deal as an appeal decision; the new side refused it and
    /// emitted nothing. Every old event of the step is a cut one (entry 4) or the appeal adjudicator's `Decided`
    /// (role 2, `ROLE_APPEAL`) for that decision.
    function _appealDecisionEvents(bytes[] memory o, bytes[] memory n, address rules, address vault)
        private
        pure
        returns (bool)
    {
        if (n.length != 0) return false;
        uint256 decided;
        for (uint256 i; i < o.length; i++) {
            if (_isCut(o[i], rules, vault)) continue;
            (address emitter, bytes32[] memory topics, bytes memory data) = abi.decode(o[i], (address, bytes32[], bytes));
            if (emitter != rules || topics.length == 0 || topics[0] != HoldbackRules.Decided.selector) return false;
            (uint8 role,,,) = abi.decode(data, (uint8, uint8, bytes32, bytes32));
            if (role != 2) return false;
            decided++;
        }
        return decided == 1;
    }

    function _isCut(bytes memory e, address rules, address vault) private pure returns (bool) {
        (address emitter, bytes32[] memory topics, bytes memory data) = abi.decode(e, (address, bytes32[], bytes));
        if (emitter == vault) return true;
        // A token transfer into or out of the vault (an appeal bond, even of 0, or a payout from a bond).
        bytes32 v = bytes32(uint256(uint160(vault)));
        if (topics.length == 3 && topics[0] == keccak256("Transfer(address,address,uint256)")) {
            return topics[1] == v || topics[2] == v;
        }
        if (emitter != rules || topics.length == 0) return false;
        if (topics[0] == keccak256("AppealFiled(bytes32,address,uint256)")) return true;
        if (topics[0] == keccak256("AppealClosed(bytes32,uint8)")) return true;
        if (topics[0] == HoldbackRules.KeyReleased.selector) {
            (uint8 path,,) = abi.decode(data, (uint8, string, string));
            return path == 3;
        }
        return false;
    }

    /// Entry 5: the holders are the same list; the vault's address holds nothing of either token on the new side;
    /// every other balance, and every ether balance, is equal. `SideBySide._balances` lays out the token balances
    /// of every holder, then the second token's, then ether, then the rules contract's and the vault's ether.
    function _sameApartFromVault(bytes memory ob, bytes memory nb, address vault) private pure returns (bool) {
        (address[] memory oh, uint256[] memory o) = abi.decode(ob, (address[], uint256[]));
        (address[] memory nh, uint256[] memory n) = abi.decode(nb, (address[], uint256[]));
        if (keccak256(abi.encode(oh)) != keccak256(abi.encode(nh)) || o.length != n.length) return false;
        uint256 m = oh.length;
        for (uint256 i; i < o.length; i++) {
            bool vaultToken = i < 2 * m && oh[i % m] == vault;
            if (vaultToken ? n[i] != 0 : o[i] != n[i]) return false;
        }
        return true;
    }

    /// Entry 6: `fileAppeal` or `expireAppeal`, which the new side does not have: its one checked call reverted
    /// with empty data. The old side made one checked call too.
    function _removedEntryPoint(Obs memory o, Obs memory n) private pure returns (bool) {
        bool removed =
            o.action == RulesHandler.fileAppeal.selector || o.action == RulesHandler.expireAppeal.selector;
        return removed && o.calls.length == 1 && _onlyRefused(n.calls, "");
    }

    /// Entry 7: a decision relayed on a decided deal: the new side refused it with `WrongStage(Released)` or
    /// `WrongStage(Refunded)`, the old side made one checked call that answered otherwise (on a deal with an open
    /// appeal it takes only the appeal adjudicator's role, so it refuses another role with `InvalidMessage`).
    function _decisionOnDecided(Obs memory o, Obs memory n) private pure returns (bool) {
        bool decision = o.action == RulesHandler.decide.selector || o.action == RulesHandler.decideAppeal.selector
            || o.action == RulesHandler.decideFallback.selector;
        return decision && o.calls.length == 1 && _refusedAsDecided(n.calls);
    }

    /// The step's one checked call reverted `WrongStage(Released)` or `WrongStage(Refunded)`.
    function _refusedAsDecided(bytes[] memory calls) private pure returns (bool) {
        return _onlyRefused(calls, abi.encodeWithSelector(HoldbackRules.WrongStage.selector, HoldbackRules.Stage.Released))
            || _onlyRefused(calls, abi.encodeWithSelector(HoldbackRules.WrongStage.selector, HoldbackRules.Stage.Refunded));
    }

    /// The step made exactly one checked call, and it reverted with exactly `data`.
    function _onlyRefused(bytes[] memory calls, bytes memory data) private pure returns (bool) {
        if (calls.length != 1) return false;
        (bool ok, bytes memory ret) = abi.decode(calls[0], (bool, bytes));
        return !ok && keccak256(ret) == keccak256(data);
    }

    function _landed(bytes[] memory calls) private pure returns (bool) {
        if (calls.length != 1) return false;
        (bool ok,) = abi.decode(calls[0], (bool, bytes));
        return ok;
    }
}
