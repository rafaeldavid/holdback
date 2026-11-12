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
///      T-375, RF-4 (`docs/audit/state-model.md` section 9.2): the deal's stored word gains its closing reason and
///      its decider, so `dealOf` returns six fields where the parent returns four. Exactly this difference, and no
///      other: in the Words field, for every deal, the new raw word is the old raw word followed by two words, a
///      reason (0 to 5) that is 0 (Open) exactly while the stage is None to Escalated, and a decider (0 to 3) that is
///      not 0 exactly when the reason is 1 (Decided); the stored delivery hashes are equal. Whether each reason and
///      decider is the right one is the state oracle's check, against the handler's record of how each deal closed.
library AllowList {
    struct Verdict {
        string change; // the change that allows the difference; "" when none does
        bool diverged; // the sides now differ in shared state by design: stop comparing this seed
    }

    uint256 private constant OLD_WORD = 128; // abi.encode of (stage, attempt, t1, seedTag)
    uint256 private constant NEW_WORD = 192; // the same, then (reason, decider)
    uint256 private constant LAST_OPEN_STAGE = 4; // Escalated
    uint256 private constant DECIDED = 1;

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
        if (f == Field.Words && _wordGainsReasonAndDecider(o.words, n.words)) {
            return Verdict("T-375 RF-4: reason, decider", false);
        }
    }

    /// `n` (abi.encode(raw dealOf returns, stored delivery hashes)) is `o` with the closing reason and the decider
    /// appended to every deal's word, as the entry above states.
    function _wordGainsReasonAndDecider(bytes memory o, bytes memory n) private pure returns (bool) {
        (bytes[] memory ow, bytes32[] memory od) = abi.decode(o, (bytes[], bytes32[]));
        (bytes[] memory nw, bytes32[] memory nd) = abi.decode(n, (bytes[], bytes32[]));
        if (ow.length != nw.length || keccak256(abi.encode(od)) != keccak256(abi.encode(nd))) return false;
        for (uint256 i; i < ow.length; i++) {
            if (ow[i].length != OLD_WORD || nw[i].length != NEW_WORD) return false;
            for (uint256 k; k < OLD_WORD / 32; k++) {
                if (_at(ow[i], k) != _at(nw[i], k)) return false;
            }
            uint256 stage = uint256(_at(nw[i], 0));
            uint256 reason = uint256(_at(nw[i], 4));
            uint256 decider = uint256(_at(nw[i], 5));
            if (reason > 5 || decider > 3) return false;
            if ((reason == 0) != (stage <= LAST_OPEN_STAGE)) return false;
            if ((decider != 0) != (reason == DECIDED)) return false;
        }
        return true;
    }

    /// The k-th 32-byte word of `b`.
    function _at(bytes memory b, uint256 k) private pure returns (bytes32 w) {
        assembly {
            w := mload(add(add(b, 32), mul(k, 32)))
        }
    }
}
