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
///      T-380, R8 fix 1 (known issue L-4): the primary's seed tag hashes its whole seed commitment with the
///      commitment ID (`HoldbackTypes.seedTag`). Exactly this difference, and no other: in the Words field, for every
///      deal, the raw words are equal but for the fourth value, the seed tag; where it differs, the parent's is the low
///      144 bits of the handler's one seed commitment (`keccak256(SEED)`, `Base._acceptance`) and the new one is
///      `uint144(keccak256(abi.encode(that commitment, the deal's ID)))`; the stored delivery hashes are equal.
library AllowList {
    struct Verdict {
        string change; // the change that allows the difference; "" when none does
        bool diverged; // the sides now differ in shared state by design: stop comparing this seed
    }

    uint256 private constant WORD = 192; // abi.encode of (stage, attempt, t1, seedTag, reason, decider)
    uint256 private constant TAG = 3; // the seed tag's place in it
    bytes32 private constant COMMITMENT = keccak256(abi.encodePacked(keccak256("primary seed"))); // Base.SEED's

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
        if (f == Field.Words && _tagBindsTheCommitment(o.words, n.words, n.stages)) {
            return Verdict("T-380 L-4: seed tag", false);
        }
    }

    /// `n` (abi.encode(raw dealOf returns, stored delivery hashes)) is `o` with each deal's seed tag bound to its ID,
    /// as the entry above states. `stages` is the new side's abi.encode(ids, stages).
    function _tagBindsTheCommitment(bytes memory o, bytes memory n, bytes memory stages) private pure returns (bool) {
        (bytes[] memory ow, bytes32[] memory od) = abi.decode(o, (bytes[], bytes32[]));
        (bytes[] memory nw, bytes32[] memory nd) = abi.decode(n, (bytes[], bytes32[]));
        (bytes32[] memory ids,) = abi.decode(stages, (bytes32[], uint8[]));
        if (ow.length != nw.length || ids.length != nw.length) return false;
        if (keccak256(abi.encode(od)) != keccak256(abi.encode(nd))) return false;
        for (uint256 i; i < ow.length; i++) {
            if (ow[i].length != WORD || nw[i].length != WORD) return false;
            for (uint256 k; k < WORD / 32; k++) {
                if (k != TAG && _at(ow[i], k) != _at(nw[i], k)) return false;
            }
            (bytes32 ot, bytes32 nt) = (_at(ow[i], TAG), _at(nw[i], TAG));
            if (ot == nt) continue;
            if (uint256(ot) != uint144(uint256(COMMITMENT))) return false;
            if (uint256(nt) != uint144(uint256(keccak256(abi.encode(COMMITMENT, ids[i]))))) return false;
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
