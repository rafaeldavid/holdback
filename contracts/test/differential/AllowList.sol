// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {HoldbackRules} from "../../src/HoldbackRules.sol";
import {RulesHandler} from "../handlers/RulesHandler.sol";
import {Field, Obs} from "./Observation.sol";

/// @title The side-by-side harness's allow-list (T-341, refinement gate VG-1)
/// @notice The differences between the old contracts (`parent/`, the change's parent commit) and the source under
///         test that a change is allowed to make. A refactor's list stays empty (the plan's rule 3). Each change on
///         `contracts-audit-ready` replaces the list: the old side is its own parent, so the entries of earlier
///         changes no longer apply (T-356).
/// @dev How a change adds an entry: one `if` per difference, testing the exact difference (the action, the field,
///      and the values on both sides), never a whole field, with the change's ID and the reason beside it. An entry
///      returns `Verdict(change, diverged)`:
///      - `diverged = false`: the difference is confined to this step, or to fields the new side no longer has;
///        the comparison goes on. Use it for an event no longer emitted, or a refusal that leaves both sides in the
///        same shared state.
///      - `diverged = true`: the two sides now hold different shared state by design. The harness compares this
///        step's other fields, then stops comparing the seed and reports "diverged by <change> at step <n>".
///        `test_sideBySide_reachesEveryRow` fails when more than a quarter of its seeds diverge, so an entry cannot
///        quietly switch the gate off.
///
///      T-356, SC-6 (ADR-0031 §7): no on-chain record of an unfunded offer's expiry. Exactly these differences, and
///      no other; none diverges, because an expired offer and an unfunded one hold the same money (none) and take the
///      same steps (none funds, every timeout finds no deal):
///      1. `expireOffer`: the new side has no such function, so its one call reverts with empty data and nothing is
///         emitted. On a due offer the old side lands it (one checked call, its `JobExpired`); otherwise it refuses it
///         for its own reason (`TooEarly` before the deadline, `WrongStage` on a funded or expired deal).
///      2. Words: an offer the old side recorded as expired stores stage 8 there and nothing here (an all-zero
///         word); every other word, and every stored delivery hash, is equal.
///      3. Calls on such an offer later: the old side refuses with `WrongStage(Expired)`; the new side refuses the
///         same call with `WrongStage(None)`, or `DeadlinePassed` for `agreeAndFund` (its deadline check follows the
///         stage check), or empty data for `expireOffer` again. Every other checked call of the step is equal.
library AllowList {
    struct Verdict {
        string change; // the change that allows the difference; "" when none does
        bool diverged; // the sides now differ in shared state by design: stop comparing this seed
    }

    /// The parent's `Stage.Expired`, which the new `Stage` lacks.
    uint8 internal constant PARENT_EXPIRED = 8;

    /// The verdict for field `f` differing between `o` (old) and `n` (new) at step `step`. `served` and `funded` are
    /// the new side's token and the token of the step's `agreeAndFund` terms; no SC-6 entry reads them.
    function allowed(Field f, uint256 step, Obs memory o, Obs memory n, address served, address funded)
        internal
        pure
        returns (Verdict memory v)
    {
        (step, served, funded);
        // Entry 1: the new side has no `expireOffer`, so its one call reverts with empty data, whatever the old side
        // answered (it lands a due expiry, or refuses one that is not due with its own TooEarly or WrongStage).
        bool gone = o.action == RulesHandler.expireOffer.selector && o.calls.length == 1 && _onlyRefused(n.calls, "");
        if (gone && f == Field.Calls) return Verdict("SC-6: expireOffer gone", false);
        bool expiry = gone && _landed(o.calls);
        if (expiry && f == Field.Events && n.events.length == 0 && _onlyJobExpired(o.events)) {
            return Verdict("SC-6: no JobExpired for an offer", false);
        }
        if (f == Field.Words && _sameApartFromExpired(o.words, n.words)) {
            return Verdict("SC-6: no Expired stage stored", false);
        }
        if (f == Field.Calls && _refusedAsExpired(o, n)) return Verdict("SC-6: an expired offer is unfunded", false);
        return v;
    }

    // ------------------------------------------------------------ the entries' exact tests

    /// Entry 1: the old side's step emitted exactly one event, the rules contract's `JobExpired`.
    function _onlyJobExpired(bytes[] memory events) private pure returns (bool) {
        if (events.length != 1) return false;
        (, bytes32[] memory topics,) = abi.decode(events[0], (address, bytes32[], bytes));
        return topics.length == 2 && topics[0] == HoldbackRules.JobExpired.selector;
    }

    /// Entry 2: the words line up deal for deal; each is equal, or the old one is stage 8 with every other field
    /// zero and the new one is all zero. The stored delivery hashes are equal.
    function _sameApartFromExpired(bytes memory ow, bytes memory nw) private pure returns (bool) {
        (bytes[] memory o, bytes32[] memory od) = abi.decode(ow, (bytes[], bytes32[]));
        (bytes[] memory n, bytes32[] memory nd) = abi.decode(nw, (bytes[], bytes32[]));
        if (o.length != n.length || keccak256(abi.encode(od)) != keccak256(abi.encode(nd))) return false;
        bytes32 expired = keccak256(abi.encode(uint256(PARENT_EXPIRED), 0, 0, 0));
        bytes32 unfunded = keccak256(abi.encode(uint256(0), 0, 0, 0));
        bool any;
        for (uint256 i; i < o.length; i++) {
            if (keccak256(o[i]) == keccak256(n[i])) continue;
            if (keccak256(o[i]) != expired || keccak256(n[i]) != unfunded) return false;
            any = true;
        }
        return any;
    }

    /// Entry 3: the step's checked calls line up one for one; each is equal, or the old one is a refusal with
    /// `WrongStage(Expired)` and the new one the same call's refusal on an unfunded offer.
    function _refusedAsExpired(Obs memory o, Obs memory n) private pure returns (bool) {
        if (o.calls.length != n.calls.length) return false;
        bytes memory wrongExpired = abi.encodeWithSelector(HoldbackRules.WrongStage.selector, PARENT_EXPIRED);
        bytes memory instead = o.action == RulesHandler.agreeAndFund.selector
            ? abi.encodeWithSelector(HoldbackRules.DeadlinePassed.selector)
            : o.action == RulesHandler.expireOffer.selector
                ? bytes("")
                : abi.encodeWithSelector(HoldbackRules.WrongStage.selector, HoldbackRules.Stage.None);
        bool any;
        for (uint256 i; i < o.calls.length; i++) {
            if (keccak256(o.calls[i]) == keccak256(n.calls[i])) continue;
            (bool ook, bytes memory oret) = abi.decode(o.calls[i], (bool, bytes));
            (bool nok, bytes memory nret) = abi.decode(n.calls[i], (bool, bytes));
            if (ook || nok || keccak256(oret) != keccak256(wrongExpired) || keccak256(nret) != keccak256(instead)) {
                return false;
            }
            any = true;
        }
        return any;
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
