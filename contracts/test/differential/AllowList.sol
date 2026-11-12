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
///      T-356, SC-1 (ADR-0031 §2): one settlement token per deployment. Exactly these differences, and no other:
///      1. Surface: `TOKEN()` is new. The old side's call fails with empty data; the new side returns the token it
///         was deployed for. Every other view and immutable is equal.
///      2. `agreeAndFund` on terms in another token (`RulesHandler.fundToken` is not the deployment's): the old side
///         funds them; the new side refuses with exactly `InvalidMessage()` and emits nothing. The sides then hold
///         different deals by design: diverged. The handler offers such terms once in 64 offers
///         (`RulesHandler.offer`), so the refusal stays exercised.
///      3. The same call, refused on both sides: the old side for another reason (a wrong key, a passed deadline,
///         the escrow's refusal), the new side first for the token. Only the refusal reason (Calls) and the events the
///         old side's reverted call recorded (Events) differ; every state field must still be equal.
///      The planted mutant is built from the parent and has no `TOKEN()`, so no entry fires against it except for a
///      new side that has one.
library AllowList {
    struct Verdict {
        string change; // the change that allows the difference; "" when none does
        bool diverged; // the sides now differ in shared state by design: stop comparing this seed
    }

    /// Index of `TOKEN()` in `SideBySide._surface`.
    uint256 internal constant SURFACE_TOKEN = 12;

    /// The verdict for field `f` differing between `o` (old) and `n` (new) at step `step`, with the new side's
    /// deployment token `served` (the handler's first token) and `funded`, the token of the terms the step's
    /// `agreeAndFund` relayed (`RulesHandler.fundToken`; the same deal on both sides, picked from shared state).
    function allowed(Field f, uint256 step, Obs memory o, Obs memory n, address served, address funded)
        internal
        pure
        returns (Verdict memory v)
    {
        step;
        if (f == Field.Surface && _surfaceApartFromToken(o.surface, n.surface, served)) {
            return Verdict("SC-1: TOKEN() added", false);
        }
        if (o.action != RulesHandler.agreeAndFund.selector || funded == served || !_refusedForToken(n)) return v;
        // Entry 2: the old side funded the other-token terms; the new side refused them.
        if (_landed(o.calls)) return Verdict("SC-1: other token refused", true);
        // Entry 3: both sides refused the same terms, the old side for another reason (a wrong key, a deadline), so
        // only the step's refusal reason, and the events the old side's reverted call recorded, differ.
        if ((f == Field.Calls || f == Field.Events) && _refused(o.calls)) {
            return Verdict("SC-1: refused for its token first", false);
        }
        return v;
    }

    // ------------------------------------------------------------ the entries' exact tests

    /// Entry 1: every view's raw return is equal, except `TOKEN()`, which the old side does not have (its call fails
    /// with empty data) and the new side answers with `served`.
    function _surfaceApartFromToken(bytes memory os, bytes memory ns, address served) private pure returns (bool) {
        bytes[] memory o = abi.decode(os, (bytes[]));
        bytes[] memory n = abi.decode(ns, (bytes[]));
        if (o.length != n.length) return false;
        for (uint256 i; i < o.length; i++) {
            if (i == SURFACE_TOKEN) {
                if (keccak256(o[i]) != keccak256(abi.encode(false, bytes("")))) return false;
                if (keccak256(n[i]) != keccak256(abi.encode(true, abi.encode(served)))) return false;
            } else if (keccak256(o[i]) != keccak256(n[i])) {
                return false;
            }
        }
        return true;
    }

    /// Entries 2 and 3: the new side made one checked call, it reverted with exactly `InvalidMessage()`, and the new
    /// side emitted nothing.
    function _refusedForToken(Obs memory n) private pure returns (bool) {
        return n.events.length == 0 && _onlyRefused(n.calls, abi.encodeWithSelector(HoldbackRules.InvalidMessage.selector));
    }

    /// The step made exactly one checked call, and it reverted.
    function _refused(bytes[] memory calls) private pure returns (bool) {
        if (calls.length != 1) return false;
        (bool ok,) = abi.decode(calls[0], (bool, bytes));
        return !ok;
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
