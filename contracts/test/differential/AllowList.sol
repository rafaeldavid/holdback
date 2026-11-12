// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

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
///      T-380, R8 fix 2 (ADR-0032): the rules contract takes a beacon margin at deploy and reads it back as
///      `BEACON_MARGIN()`. The harness's world deploys a margin of 0 (`Base._beaconMargin`), under which the sim
///      beacon's rounds do not move: the fallback's stays judgeBy and an escalation's t1 + 1, so no call, event, balance
///      or word may differ. Exactly this difference, and no other: in the Surface field, the slot of `BEACON_MARGIN()`
///      (its place in `SideBySideTest._surface`), which the parent does not have (a failed call) and the new side
///      answers with 0; every other slot equal. The margin's rounds are proven by `BeaconMargin.t.sol` and the drand
///      suites, not here.
library AllowList {
    struct Verdict {
        string change; // the change that allows the difference; "" when none does
        bool diverged; // the sides now differ in shared state by design: stop comparing this seed
    }

    uint256 private constant MARGIN_SLOT = 13; // "BEACON_MARGIN()" in SideBySideTest._surface

    /// The verdict for field `f` differing between `o` (old) and `n` (new) at step `step`. `served` and `funded` are
    /// the new side's token and the token of the step's `agreeAndFund` terms; `appealWindow` says whether that call's
    /// terms had an appeal window other than 0 and deadlines in strict order (`RulesHandler.fundAppealWindow`). No
    /// entry reads them now; they stay for the next change that needs one.
    function allowed(Field f, uint256 step, Obs memory o, Obs memory n, address served, address funded, bool appealWindow)
        internal
        pure
        returns (Verdict memory v)
    {
        (step, served, funded, appealWindow);
        if (f == Field.Surface && _onlyTheMarginIsNew(o.surface, n.surface)) {
            return Verdict("T-380 ADR-0032: BEACON_MARGIN", false);
        }
    }

    /// `n` is `o` but for the BEACON_MARGIN() slot: a failed call on the old side, 0 on the new.
    function _onlyTheMarginIsNew(bytes memory o, bytes memory n) private pure returns (bool) {
        bytes[] memory os = abi.decode(o, (bytes[]));
        bytes[] memory ns = abi.decode(n, (bytes[]));
        if (os.length != ns.length || ns.length <= MARGIN_SLOT) return false;
        for (uint256 i; i < ns.length; i++) {
            if (i != MARGIN_SLOT && keccak256(os[i]) != keccak256(ns[i])) return false;
        }
        (bool oldOk,) = abi.decode(os[MARGIN_SLOT], (bool, bytes));
        (bool newOk, bytes memory ret) = abi.decode(ns[MARGIN_SLOT], (bool, bytes));
        return !oldOk && newOk && keccak256(ret) == keccak256(abi.encode(uint64(0)));
    }
}
