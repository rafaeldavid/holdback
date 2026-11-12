// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Field, Obs} from "./Observation.sol";
import {HoldbackRules} from "../../src/HoldbackRules.sol";
import {RulesHandler} from "../handlers/RulesHandler.sol";

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
///      T-380, R8 fix 3: `agreeAndFund` refuses with `Unrepresentable` terms that core cannot represent, a fallbackBy
///      after 9999-12-31T23:59:59Z or an escalation window above 2^32 - 1 s. The handler draws them only in two of the
///      eight boundary cases (`RulesHandler._boundary`, one offer in 16); `RulesHandler.fundUnrepresentable` says
///      whether the step's `agreeAndFund` relayed such terms with deadlines in strict order. Exactly these
///      differences, and no other:
///      1. the old side funds such terms; the new side refuses the same one checked call with exactly
///         `Unrepresentable()` and emits nothing. The sides then hold different deals by design: diverged.
///      2. both refuse, the old side for a reason it checks after the new check (a signature from the wrong key, a
///         token the deployment does not serve, the escrow's refusal to hold nothing or more than 120 bits): only the
///         refusal reason (Calls) and the events the old side's reverted call recorded (Events) differ.
///      The parent's unreachable check of fundBy above 48 bits is gone with it; no call reached it [inferred: fundBy is
///      below fallbackBy, and the escrow's expiry, already checked against 48 bits, is above fallbackBy].
library AllowList {
    struct Verdict {
        string change; // the change that allows the difference; "" when none does
        bool diverged; // the sides now differ in shared state by design: stop comparing this seed
    }

    /// The verdict for field `f` differing between `o` (old) and `n` (new) at step `step`. `served` and `funded` are
    /// the new side's token and the token of the step's `agreeAndFund` terms (no T-380 entry reads them);
    /// `unrepresentable` says whether that call's terms were in order and carried a value core cannot represent
    /// (`RulesHandler.fundUnrepresentable`; the same terms on both sides, picked from shared state).
    function allowed(
        Field f,
        uint256 step,
        Obs memory o,
        Obs memory n,
        address served,
        address funded,
        bool unrepresentable
    ) internal pure returns (Verdict memory v) {
        (step, served, funded);
        if (o.action != RulesHandler.agreeAndFund.selector || !unrepresentable || n.events.length != 0) return v;
        if (!_onlyRefused(n.calls, abi.encodeWithSelector(HoldbackRules.Unrepresentable.selector))) return v;
        // Entry 1: the old side funded the terms; the new side refused them.
        if (_landed(o.calls)) return Verdict("T-380 fix 3: unrepresentable terms refused", true);
        // Entry 2: both refused, the old side for a reason it checks later.
        if ((f == Field.Calls || f == Field.Events) && _refused(o.calls)) {
            return Verdict("T-380 fix 3: refused as unrepresentable first", false);
        }
        return v;
    }

    /// The step made exactly one checked call, and it reverted with exactly `data`.
    function _onlyRefused(bytes[] memory calls, bytes memory data) private pure returns (bool) {
        if (calls.length != 1) return false;
        (bool ok, bytes memory ret) = abi.decode(calls[0], (bool, bytes));
        return !ok && keccak256(ret) == keccak256(data);
    }

    /// The step made exactly one checked call, and it reverted.
    function _refused(bytes[] memory calls) private pure returns (bool) {
        if (calls.length != 1) return false;
        (bool ok,) = abi.decode(calls[0], (bool, bytes));
        return !ok;
    }

    function _landed(bytes[] memory calls) private pure returns (bool) {
        if (calls.length != 1) return false;
        (bool ok,) = abi.decode(calls[0], (bool, bytes));
        return ok;
    }
}
