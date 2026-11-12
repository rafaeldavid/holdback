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
///      T-356, SC-2 (ADR-0031 §3): ERC-3009 funding only. Exactly this difference, and no other:
///      1. Surface: `PERMIT2_COLLECTOR()` is gone. The old side returns its Permit2 collector; the new side's call
///         fails with empty data. Every other view and immutable is equal.
///      `Funding.method` left too, which changes `agreeAndFund`'s selector. The handler funds by ERC-3009 only and the
///      pinned side encodes the parent's layout with `method` 0 (`Sides.sol`), so both sides receive the same ERC-3009
///      signature and every call, event and balance must stay equal. The refusal of a Permit2 signature is proven in
///      `test/unit/Erc3009Only.t.sol`: the handler never funded through Permit2, on either side.
library AllowList {
    struct Verdict {
        string change; // the change that allows the difference; "" when none does
        bool diverged; // the sides now differ in shared state by design: stop comparing this seed
    }

    /// Index of `PERMIT2_COLLECTOR()` in `SideBySide._surface`.
    uint256 internal constant SURFACE_PERMIT2_COLLECTOR = 3;

    /// The verdict for field `f` differing between `o` (old) and `n` (new) at step `step`. `served` and `funded` are
    /// the new side's token and the token of the step's `agreeAndFund` terms; no SC-2 entry reads them.
    function allowed(Field f, uint256 step, Obs memory o, Obs memory n, address served, address funded)
        internal
        pure
        returns (Verdict memory v)
    {
        (step, served, funded);
        if (f == Field.Surface && _surfaceApartFromPermit2(o.surface, n.surface)) {
            return Verdict("SC-2: PERMIT2_COLLECTOR() gone", false);
        }
        return v;
    }

    /// Entry 1: every view's raw return is equal, except `PERMIT2_COLLECTOR()`, which the old side answers with a
    /// nonzero address and the new side does not have (its call fails with empty data).
    function _surfaceApartFromPermit2(bytes memory os, bytes memory ns) private pure returns (bool) {
        bytes[] memory o = abi.decode(os, (bytes[]));
        bytes[] memory n = abi.decode(ns, (bytes[]));
        if (o.length != n.length) return false;
        for (uint256 i; i < o.length; i++) {
            if (i == SURFACE_PERMIT2_COLLECTOR) {
                (bool ok, bytes memory ret) = abi.decode(o[i], (bool, bytes));
                if (!ok || ret.length != 32 || abi.decode(ret, (address)) == address(0)) return false;
                if (keccak256(n[i]) != keccak256(abi.encode(false, bytes("")))) return false;
            } else if (keccak256(o[i]) != keccak256(n[i])) {
                return false;
            }
        }
        return true;
    }
}
