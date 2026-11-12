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
///      T-358, R6c-1 (ADR-0033): the parent is re-seated for the new signed type (`Sides.sol`), so both sides take one
///      ABI, hash one commitment ID and sign one domain. The handler keeps each deal's payment and payout addresses
///      equal to its signing addresses in trace mode, where the parent's payer and receiver are the same addresses.
///      It draws an appeal window of 0, except one offer in 32 (`RulesHandler.offer`); `RulesHandler.fundAppealWindow`
///      says whether the step's `agreeAndFund` relayed such terms. Exactly these differences, and no other:
///      1. `agreeAndFund` with the same outcome on both sides: the new side emits one more event,
///         `SettlementAddresses(id, payment address, payout address)`, right after `JobFunded`. Every other event, in
///         order, is the same. That holds when the call lands, and when the escrow refuses it after the rules contract
///         emitted its events (a deal that holds nothing: the recorder keeps a reverted call's events).
///      2. `agreeAndFund` on terms with an appeal window other than 0 (and deadlines in order): the old side funds them;
///         the new side refuses the same one checked call with exactly `InvalidMessage()` and emits nothing. The sides
///         then hold different deals by design: diverged.
///      3. The same call refused on both sides, the old side for a reason it checks after the new side's timing check:
///         only the refusal reason (Calls) and the events the old side's reverted call recorded (Events) differ.
///      Deals with their addresses apart are the invariant campaign's (`invariant_signingAddressesMoveNoMoney`) and the
///      unit tests' (`test/unit/TwoAddresses.t.sol`).
library AllowList {
    struct Verdict {
        string change; // the change that allows the difference; "" when none does
        bool diverged; // the sides now differ in shared state by design: stop comparing this seed
    }

    bytes32 internal constant SETTLEMENT_ADDRESSES = keccak256("SettlementAddresses(bytes32,address,address)");

    /// The verdict for field `f` differing between `o` (old) and `n` (new) at step `step`. `served` and `funded` are
    /// the new side's token and the token of the step's `agreeAndFund` terms (no T-358 entry reads them);
    /// `appealWindow` says whether that call's terms had an appeal window other than 0 and deadlines in strict order
    /// (`RulesHandler.fundAppealWindow`; the same terms on both sides, picked from shared state).
    function allowed(Field f, uint256 step, Obs memory o, Obs memory n, address served, address funded, bool appealWindow)
        internal
        pure
        returns (Verdict memory v)
    {
        (step, served, funded);
        if (o.action != RulesHandler.agreeAndFund.selector) return v;
        // Entry 1: the same outcome on both sides; the new side adds the one event.
        if (f == Field.Events && keccak256(abi.encode(o.calls)) == keccak256(abi.encode(n.calls)) && _oneMore(o.events, n.events)) {
            return Verdict("R6c-1: SettlementAddresses at funding", false);
        }
        if (!appealWindow || n.events.length != 0) return v;
        if (!_onlyRefused(n.calls, abi.encodeWithSelector(HoldbackRules.InvalidMessage.selector))) return v;
        // Entry 2: the old side funded terms with an appeal window; the new side refused them.
        if (_landed(o.calls)) return Verdict("R6c-1: appeal window other than 0 refused", true);
        // Entry 3: both refused, the old side for a reason it checks later.
        if ((f == Field.Calls || f == Field.Events) && _refused(o.calls)) {
            return Verdict("R6c-1: refused for its appeal window first", false);
        }
        return v;
    }

    /// `n` is `o` with exactly one `SettlementAddresses` event inserted right after the old side's `JobFunded`, from
    /// the same emitter, naming the same deal in its first topic.
    function _oneMore(bytes[] memory o, bytes[] memory n) private pure returns (bool) {
        if (n.length != o.length + 1) return false;
        uint256 at = type(uint256).max;
        for (uint256 i; i < n.length; i++) {
            (address emitter, bytes32[] memory topics,) = abi.decode(n[i], (address, bytes32[], bytes));
            if (topics.length == 4 && topics[0] == SETTLEMENT_ADDRESSES) {
                if (at != type(uint256).max || i == 0) return false;
                (address prev, bytes32[] memory pt,) = abi.decode(n[i - 1], (address, bytes32[], bytes));
                if (prev != emitter || pt.length < 2 || pt[0] != HoldbackRules.JobFunded.selector || pt[1] != topics[1]) {
                    return false;
                }
                at = i;
            }
        }
        if (at == type(uint256).max) return false;
        for (uint256 i; i < o.length; i++) {
            if (keccak256(o[i]) != keccak256(n[i < at ? i : i + 1])) return false;
        }
        return true;
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
