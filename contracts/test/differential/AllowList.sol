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
///      T-356, SC-3 (ADR-0031 §4, §10): a mutual settlement pays the buyer and the seller only. Exactly this
///      difference, and no other:
///      1. `mutualSettle` with a payout to a third address: the old side lands it, paying that address as an all-fee
///         capture and emitting `Paid`; the new side refuses the same one checked call with exactly
///         `InvalidMessage()` and emits nothing. The sides then hold different deals by design: diverged. The handler
///         names a third party in one settlement in 32 (`RulesHandler._mutual`), so the refusal stays exercised.
///      2. The same settlement refused on both sides, the old side inside its third-party payout (the escrow refusing
///         that all-fee capture, as after the hold's authorization expiry), the new side first for its payee: only the
///         refusal reason (Calls) and the events the old side's reverted call recorded (Events) differ. Every check
///         before the payouts (stage, expiry, signatures, key proof) refuses alike on both sides, and an overshoot
///         reverts `InvalidMessage` on both. No coverage seed exercises this entry; the fuzz gate met it before the
///         handler recorded the payee (seed 17 of the first run, measured 2026-11-12).
///      A settlement between the parties alone emits no `Paid` on either side, so every such step must be equal.
library AllowList {
    struct Verdict {
        string change; // the change that allows the difference; "" when none does
        bool diverged; // the sides now differ in shared state by design: stop comparing this seed
    }

    /// The verdict for field `f` differing between `o` (old) and `n` (new) at step `step`. `served` and `funded` are
    /// the new side's token and the token of the step's `agreeAndFund` terms (no SC-3 entry reads them);
    /// `thirdParty` says whether the step's `mutualSettle` named a payee other than the parties
    /// (`RulesHandler.thirdPartyPayout`; the same settlement on both sides, built from shared state).
    function allowed(Field f, uint256 step, Obs memory o, Obs memory n, address served, address funded, bool thirdParty)
        internal
        pure
        returns (Verdict memory v)
    {
        (step, served, funded);
        if (o.action != RulesHandler.mutualSettle.selector || !thirdParty || n.events.length != 0) return v;
        if (!_onlyRefused(n.calls, abi.encodeWithSelector(HoldbackRules.InvalidMessage.selector))) return v;
        // Entry 1: the old side paid the third address (its `Paid` event); the new side refused.
        if (_landed(o.calls) && _paid(o.events)) return Verdict("SC-3: third-party payout refused", true);
        // Entry 2: both refused, the old side inside its third-party payout (the escrow refusing that capture); only the
        // refusal reason and the old side's recorded events differ.
        if ((f == Field.Calls || f == Field.Events) && _refused(o.calls)) {
            return Verdict("SC-3: refused for its payee first", false);
        }
        return v;
    }

    /// The old side's step emitted the deleted `Paid` event.
    function _paid(bytes[] memory events) private pure returns (bool) {
        bytes32 paid = keccak256("Paid(bytes32,address,uint256)");
        for (uint256 i; i < events.length; i++) {
            (, bytes32[] memory topics,) = abi.decode(events[i], (address, bytes32[], bytes));
            if (topics.length != 0 && topics[0] == paid) return true;
        }
        return false;
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
