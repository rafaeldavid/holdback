// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {HoldbackRules} from "../../src/HoldbackRules.sol";
import {HoldbackBonds} from "../../src/HoldbackBonds.sol";
import {HoldbackTypes as H} from "../../src/HoldbackTypes.sol";
import {RulesHandler} from "../handlers/RulesHandler.sol";

/// @title StateOracle (T-341, refinement gate VG-2)
/// @notice The legal states of one deal, from the state model: `docs/audit/state-model.md` (task T-340, refinement
///         package R2), section 2 ("The legal rows", rows L01 to L37, and "Bounds on the times") and section 5.1
///         (what the escrow holds per row), as of T-340's commit 3761f9c (pull request 330). Each row below carries
///         the table's row ID; change the two together. `RulesInvariants.invariant_legalDealStates` checks every
///         deal against it after every step of the invariant campaign.
/// @dev A deal is legal when, together:
///      1. its stored word and stored delivery hash match exactly one row of section 2 (the stage, the attempt, the
///         appeal state, the flags, whether t1 and t2 are zero, and whether the delivery hash is zero; and the seed
///         tag is zero in L01 and L02 only, its rows' rule);
///      2. its times keep the bounds of section 2 against its terms;
///      3. the vault holds an appeal bond for it exactly while an appeal is open, from the party the decision went
///         against (illegal class I15);
///      4. the escrow's capturable and refundable amounts are the row's (section 5.1, illegal class I16). A funded
///         row (L03 to L06) may show an empty escrow only after the buyer's own reclaim on the escrow (section 5.2).
///      The vault's per-adjudicator totals are checked by `invariant_encumberedNotDoubleCounted` and
///      `invariant_bondsNeverNegative` (section 5.3).
library StateOracle {
    uint8 internal constant ZERO = 0;
    uint8 internal constant SET = 1;

    struct Row {
        string id;
        HoldbackRules.Stage stage;
        uint8 attempt; // 0 or 1; the delivery hash is set exactly when it is 1
        HoldbackRules.AppealState appeal;
        uint8 flags;
        uint8 t1; // ZERO or SET
        uint8 t2; // ZERO or SET
    }

    /// Everything the oracle reads about one deal.
    struct State {
        HoldbackRules.Deal d;
        bytes32 deliveryHash;
        address appellant; // the vault's appealBondOf(id)
        uint120 capturable; // the escrow's paymentState
        uint120 refundable;
        bool buyerReclaimed; // the buyer reclaimed on the escrow directly (section 5.2)
    }

    /// What the oracle reads about deal i of handler `x`: the rules contract, the vault, the escrow, and the
    /// handler's record of the buyer's own reclaim.
    function read(RulesHandler x, uint256 i) internal view returns (State memory s) {
        (HoldbackRules r, HoldbackBonds b,) = x.system();
        bytes32 id = x.dealId(i);
        s.d = r.dealOf(id);
        s.deliveryHash = r.deliveryHashOf(id);
        (s.appellant,) = b.appealBondOf(id);
        (, s.capturable, s.refundable) = x.holdOf(i);
        s.buyerReclaimed = x.cppReclaimed(id);
    }

    /// Checks deal i of handler `x`.
    function checkDeal(RulesHandler x, uint256 i) internal view returns (string memory) {
        return check(read(x, i), x.termsOf(i));
    }

    function _r(
        string memory id,
        HoldbackRules.Stage s,
        uint8 attempt,
        HoldbackRules.AppealState a,
        uint8 flags,
        uint8 t1,
        uint8 t2
    ) private pure returns (Row memory) {
        return Row(id, s, attempt, a, flags, t1, t2);
    }

    /// Section 2's table, row for row.
    function rows() internal pure returns (Row[] memory r) {
        HoldbackRules.Stage rel = HoldbackRules.Stage.Released;
        HoldbackRules.Stage ref = HoldbackRules.Stage.Refunded;
        HoldbackRules.AppealState none = HoldbackRules.AppealState.None;
        HoldbackRules.AppealState open = HoldbackRules.AppealState.Open;
        HoldbackRules.AppealState up = HoldbackRules.AppealState.Upheld;
        HoldbackRules.AppealState over = HoldbackRules.AppealState.Overturned;
        HoldbackRules.AppealState exp = HoldbackRules.AppealState.Expired;
        HoldbackRules.AppealState closed = HoldbackRules.AppealState.Closed;
        r = new Row[](37);
        r[0] = _r("L01", HoldbackRules.Stage.None, 0, none, 0, ZERO, ZERO);
        r[1] = _r("L02", HoldbackRules.Stage.Expired, 0, none, 0, ZERO, ZERO);
        r[2] = _r("L03", HoldbackRules.Stage.Held, 0, none, 1, ZERO, ZERO);
        r[3] = _r("L04", HoldbackRules.Stage.Delivered, 1, none, 1, ZERO, ZERO);
        r[4] = _r("L05", HoldbackRules.Stage.FallbackJudging, 1, none, 1, SET, ZERO);
        r[5] = _r("L06", HoldbackRules.Stage.Escalated, 1, none, 0, SET, ZERO);
        r[6] = _r("L07", rel, 1, none, 1, SET, ZERO);
        r[7] = _r("L08", ref, 1, none, 1, SET, ZERO);
        r[8] = _r("L09", rel, 1, none, 10, SET, ZERO);
        r[9] = _r("L10", ref, 1, none, 10, SET, ZERO);
        r[10] = _r("L11", rel, 1, open, 1, SET, SET);
        r[11] = _r("L12", ref, 1, open, 1, SET, SET);
        r[12] = _r("L13", rel, 1, open, 10, SET, SET);
        r[13] = _r("L14", ref, 1, open, 10, SET, SET);
        r[14] = _r("L15", rel, 1, up, 0, SET, SET);
        r[15] = _r("L16", ref, 1, up, 0, SET, SET);
        r[16] = _r("L17", rel, 1, up, 8, SET, SET);
        r[17] = _r("L18", ref, 1, up, 8, SET, SET);
        r[18] = _r("L19", rel, 1, over, 0, SET, SET);
        r[19] = _r("L20", ref, 1, over, 0, SET, SET);
        r[20] = _r("L21", rel, 1, over, 8, SET, SET);
        r[21] = _r("L22", ref, 1, over, 8, SET, SET);
        r[22] = _r("L23", rel, 1, exp, 0, SET, ZERO);
        r[23] = _r("L24", ref, 1, exp, 0, SET, ZERO);
        r[24] = _r("L25", rel, 1, exp, 8, SET, ZERO);
        r[25] = _r("L26", ref, 1, exp, 8, SET, ZERO);
        r[26] = _r("L27", rel, 1, exp, 0, SET, SET);
        r[27] = _r("L28", ref, 1, exp, 0, SET, SET);
        r[28] = _r("L29", rel, 1, exp, 8, SET, SET);
        r[29] = _r("L30", ref, 1, exp, 8, SET, SET);
        r[30] = _r("L31", rel, 1, closed, 0, SET, ZERO);
        r[31] = _r("L32", ref, 1, closed, 0, SET, ZERO);
        r[32] = _r("L33", rel, 1, closed, 0, ZERO, ZERO);
        r[33] = _r("L34", ref, 0, closed, 0, ZERO, ZERO);
        r[34] = _r("L35", HoldbackRules.Stage.Settled, 0, closed, 0, ZERO, ZERO);
        r[35] = _r("L36", HoldbackRules.Stage.Settled, 1, closed, 0, ZERO, ZERO);
        r[36] = _r("L37", HoldbackRules.Stage.Settled, 1, closed, 0, SET, ZERO);
    }

    function matches(Row memory r, HoldbackRules.Deal memory d, bytes32 dh) internal pure returns (bool) {
        return d.stage == r.stage && d.attempt == r.attempt && d.appeal == r.appeal && d.flags == r.flags
            && (d.t1 != 0) == (r.t1 == SET) && (d.t2 != 0) == (r.t2 == SET) && (dh != bytes32(0)) == (r.attempt == 1);
    }

    /// The row the word matches, or "" for none (rows are disjoint: at most one matches).
    function rowOf(HoldbackRules.Deal memory d, bytes32 dh) internal pure returns (string memory) {
        Row[] memory r = rows();
        for (uint256 i; i < r.length; i++) {
            if (matches(r[i], d, dh)) return r[i].id;
        }
        return "";
    }

    /// Returns "" when the deal's state is legal, otherwise why it is not, with the word.
    function check(State memory s, H.Terms memory t) internal pure returns (string memory) {
        HoldbackRules.Deal memory d = s.d;
        bytes memory row = bytes(rowOf(d, s.deliveryHash));
        if (row.length == 0) return string.concat("no legal row (section 2): ", describe(s));
        bool unfunded = d.stage == HoldbackRules.Stage.None || d.stage == HoldbackRules.Stage.Expired;
        if (unfunded != (d.seedTag == 0)) return string.concat(string(row), ": the seed tag is wrong for the row");

        string memory times = _times(string(row), d, t);
        if (bytes(times).length != 0) return times;

        // I15: an appeal bond is held exactly while an appeal is open, from the party the decision went against.
        bool open = d.appeal == HoldbackRules.AppealState.Open;
        if (open != (s.appellant != address(0))) {
            return string.concat(string(row), ": an appeal bond held outside an open appeal, or none in one (I15)");
        }
        if (open && s.appellant != (d.stage == HoldbackRules.Stage.Released ? t.buyer : t.seller)) {
            return string.concat(string(row), ": the appeal bond is not the losing party's (I15)");
        }
        return _holds(string(row), s, t);
    }

    /// Section 2, "Bounds on the times".
    function _times(string memory row, HoldbackRules.Deal memory d, H.Terms memory t)
        private
        pure
        returns (string memory)
    {
        uint256 t1 = d.t1;
        uint256 judgeBy = t.timing.judgeBy;
        uint256 fallbackBy = t.timing.fallbackBy;
        if (_is(row, "L05") && t1 < judgeBy) return string.concat(row, ": t1 before judgeBy");
        // L06: the primary escalated before judgeBy, or the fallback in [judgeBy, fallbackBy).
        if (_is(row, "L06") && !(t1 < judgeBy || t1 < fallbackBy)) return string.concat(row, ": t1 too late");
        uint256 n = _num(row);
        if (n >= 7 && n <= 30) {
            // The appeal-chain rows: rows 7, 8, 11, 12, ... (step 4) were decided by the primary, the others by the
            // fallback; their flags say which (1 or 0: the primary; 10 or 8: the fallback).
            bool byFallback = d.flags & 8 != 0;
            if (!byFallback && t1 >= judgeBy) return string.concat(row, ": the primary decided at or after judgeBy");
            if (byFallback && (t1 < judgeBy || t1 >= fallbackBy)) {
                return string.concat(row, ": the fallback decided outside [judgeBy, fallbackBy)");
            }
            if (d.t2 != 0 && (d.t2 < t1 || d.t2 >= t1 + t.timing.appealWindowSec)) {
                return string.concat(row, ": the appeal was filed outside [t1, t1 + appealWindowSec)");
            }
        }
        return "";
    }

    /// Section 5.1: what the escrow holds for each row.
    function _holds(string memory row, State memory s, H.Terms memory t) private pure returns (string memory) {
        uint256 hold = t.price + t.fee;
        uint256 n = _num(row);
        if (n <= 2) {
            if (s.capturable != 0 || s.refundable != 0) return string.concat(row, ": an unfunded deal holds money");
            return "";
        }
        if (n <= 6) {
            if (s.refundable != 0) return string.concat(row, ": a funded deal paid out");
            if (s.capturable == hold || (s.capturable == 0 && s.buyerReclaimed)) return "";
            return string.concat(row, ": the escrow does not hold price + fee");
        }
        if (s.capturable != 0) return string.concat(row, ": a closed deal still holds money");
        uint256 paid;
        if (n <= 31) {
            // L07 to L30 and L31: Released paid price + fee out of the escrow, Refunded only the fee.
            paid = s.d.stage == HoldbackRules.Stage.Released ? hold : t.fee;
        } else if (n == 32) {
            // L32: the fee after an escalation decision, or nothing after a default.
            if (s.refundable == t.fee || s.refundable == 0) return "";
            return string.concat(row, ": refundable is neither the fee nor zero");
        } else if (n == 33) {
            paid = t.price;
        } else if (n == 34) {
            paid = 0;
        } else {
            // L35 to L37: price minus the buyer's own payouts.
            if (s.refundable <= t.price) return "";
            return string.concat(row, ": a settlement paid out more than the price");
        }
        if (s.refundable != paid) return string.concat(row, ": the escrow's refundable amount is not the row's");
        return "";
    }

    function _is(string memory a, string memory b) private pure returns (bool) {
        return keccak256(bytes(a)) == keccak256(bytes(b));
    }

    /// "L07" -> 7.
    function _num(string memory row) private pure returns (uint256) {
        bytes memory b = bytes(row);
        return (uint8(b[1]) - 48) * 10 + (uint8(b[2]) - 48);
    }

    function describe(State memory s) internal pure returns (string memory) {
        HoldbackRules.Deal memory d = s.d;
        return string.concat(
            string.concat("stage ", _u(uint8(d.stage)), ", attempt ", _u(d.attempt), ", appeal ", _u(uint8(d.appeal))),
            string.concat(", flags ", _u(d.flags), d.t1 == 0 ? ", t1 zero" : ", t1 set"),
            string.concat(d.t2 == 0 ? ", t2 zero" : ", t2 set", s.deliveryHash == 0 ? ", no delivery hash" : ", a delivery hash")
        );
    }

    function _u(uint256 v) private pure returns (string memory) {
        if (v == 0) return "0";
        bytes memory b;
        for (; v != 0; v /= 10) {
            b = abi.encodePacked(bytes1(uint8(48 + v % 10)), b);
        }
        return string(b);
    }
}
