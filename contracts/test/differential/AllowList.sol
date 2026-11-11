// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Field, Obs} from "./Observation.sol";

/// @title The side-by-side harness's allow-list (T-341, refinement gate VG-1)
/// @notice The differences between the old contracts (`old/`, commit 64be1f1) and the source under test that a
///         change is allowed to make. On `main` it is empty: the two sides are the same source, and any difference
///         fails the harness. A refactor's list stays empty (the plan's rule 3).
/// @dev How a change on `contracts-audit-ready` adds an entry: one `if` per difference, testing the exact
///      difference (the action, the field, and the values on both sides), never a whole field, with the change's
///      ID and the reason beside it. An entry returns `Verdict(change, diverged)`:
///      - `diverged = false`: the difference is confined to this step; the comparison goes on. Use it for an event
///        no longer emitted, or a refusal that leaves both sides in the same state.
///      - `diverged = true`: the two sides now hold different state by design (the old side funded a deal the new
///        side refuses; the old side keeps an appeal window open where the new side's decision is terminal; a
///        vault the new side no longer has). The harness compares this step's other fields, then stops comparing
///        the seed and reports "diverged by <change> at step <n>". `test_sideBySide_reachesEveryRow` fails when
///        more than a quarter of its seeds diverge, so an entry cannot quietly switch the gate off.
///      The three kinds the scope cuts need, as examples (selectors and errors from the new source):
///
///          // SC-6: expireOffer is gone. The old side records Expired; the new side has no such call.
///          if (f == Field.Calls && o.action == RulesHandler.expireOffer.selector && n.calls.length == 0)
///              return Verdict("SC-6", true);
///          // SC-5: deadlines out of order are refused at funding (an input the new side refuses and the old
///          // side accepts). A zero price stays legal in phase one, so it is never on this list.
///          if (f == Field.Calls && o.action == RulesHandler.agreeAndFund.selector && _outOfOrder(o)
///              && _revertsWith(n, HoldbackRules.InvalidMessage.selector)) return Verdict("SC-5", true);
///          // SC-7: AppealFiled and AppealClosed and the vault's events are no longer emitted.
///          if (f == Field.Events && _sameApartFrom(o.events, n.events, _appealAndVaultEvents()))
///              return Verdict("SC-7", false);
library AllowList {
    struct Verdict {
        string change; // the change that allows the difference; "" when none does
        bool diverged; // the sides now differ in state by design: stop comparing this seed
    }

    /// The verdict for field `f` differing between `o` (old) and `n` (new) at step `step`.
    function allowed(Field f, uint256 step, Obs memory o, Obs memory n) internal pure returns (Verdict memory v) {
        (f, step, o, n); // no entries on main
        return v;
    }
}
