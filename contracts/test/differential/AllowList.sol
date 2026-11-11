// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Field, Obs} from "./Observation.sol";

/// @title The side-by-side harness's allow-list (T-341, refinement gate VG-1)
/// @notice The differences between the old contracts (`old/`, commit 64be1f1) and the source under test that a
///         change is allowed to make. On `main` it is empty: the two sides are the same source, and any difference
///         fails the harness.
/// @dev How a change on `contracts-audit-ready` adds an entry. One `if` per difference, each returning the change's
///      ID (for example "SC-5"), and each testing the exact difference, never a whole field:
///
///          // SC-5: a zero price is refused at funding; the old contract funded it.
///          if (f == Field.Calls && o.action == RulesHandler.agreeAndFund.selector && _zeroPrice(o, n)
///              && n.calls.length == 1 && bytes4(n.calls[0]) == HoldbackRules.Unrepresentable.selector) {
///              return "SC-5";
///          }
///
///      A refactor's list stays empty (plan rule 3). A behaviour change lists each difference and says why in a
///      comment beside its entry. The harness logs every allowed difference with its change ID.
library AllowList {
    /// Returns the ID of the change that allows field `f` to differ between `o` (old) and `n` (new) at this step,
    /// or "" when no entry allows it.
    function allowed(Field f, Obs memory o, Obs memory n) internal pure returns (string memory change) {
        (f, o, n); // no entries on main
        return "";
    }
}
