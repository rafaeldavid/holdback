// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {HoldbackRules} from "../../src/HoldbackRules.sol";
import {HoldbackTypes as H} from "../../src/HoldbackTypes.sol";
import {RulesHandler} from "../handlers/RulesHandler.sol";

/// @title StateOracle (T-341, refinement gate VG-2; phase-one rows since T-346)
/// @notice The legal states of one deal on the phase-one contracts, from the state model:
///         `docs/audit/state-model.md` (task T-340, refinement package R2), section 9.3 (the phase-one rows P01 to
///         P17, with their closing reason and decider) and section 9.4 (their time bounds and what the escrow holds).
///         The deployed machine's row L02, an unfunded offer's recorded expiry, left with `expireOffer` (scope cut
///         SC-6, T-356): an unfunded offer is P01 until it funds, whatever the clock says. Each row below carries the
///         table's row ID; change the two together.
///         `RulesInvariants.invariant_legalDealStates` checks every deal against it after every step of the
///         invariant campaign.
/// @dev The deployed machine's rows L11 to L30 and every vault column left with SC-7 (T-346): phase one has no
///      party appeal and no bond. The closing reason and the decider (section 9.2) are not yet stored on chain;
///      refactor RF-4 adds them to the word. Until then the oracle takes them from the handler's record of the
///      action that closed the deal (`RulesHandler.closedBy`, `closedDecider`), as it takes the buyer's own reclaim
///      on the escrow, and checks the stored word against the row that reason names. A deal is legal when, together:
///      1. its stored word, its stored delivery hash and its closing reason match exactly one row (the stage, the
///         attempt, the reason, the decider, whether t1 is zero, and whether the delivery hash is zero; and the seed
///         tag is zero exactly in P01);
///      2. its times keep the row's bounds against its terms;
///      3. the escrow's capturable and refundable amounts are the row's (section 9.4, illegal class I16). A funded
///         row (P02 to P05) may show an empty escrow only after the buyer's own reclaim on the escrow (section 5.2).
library StateOracle {
    uint8 internal constant ZERO = 0;
    uint8 internal constant SET = 1;

    // The handler's closing reasons and deciders (`RulesHandler.R_*`, `D_*`).
    uint8 internal constant OPEN = 0;
    uint8 internal constant DECIDED = 1;
    uint8 internal constant ACCEPTED_EARLY = 2;
    uint8 internal constant SETTLED = 3;
    uint8 internal constant RECLAIMED = 4;
    uint8 internal constant DEFAULTED = 5;
    uint8 internal constant NOBODY = 0;
    uint8 internal constant PRIMARY = 1;
    uint8 internal constant FALLBACK = 2;
    uint8 internal constant APPEAL = 3;

    struct Row {
        string id;
        HoldbackRules.Stage stage;
        uint8 attempt; // 0 or 1; the delivery hash is set exactly when it is 1
        uint8 reason;
        uint8 decider;
        uint8 t1; // ZERO or SET
    }

    /// Everything the oracle reads about one deal.
    struct State {
        HoldbackRules.Deal d;
        bytes32 deliveryHash;
        uint8 reason; // the handler's record: how the deal closed (OPEN while it is open)
        uint8 decider; // the handler's record: whose decision closed it
        uint120 capturable; // the escrow's paymentState
        uint120 refundable;
        bool buyerReclaimed; // the buyer reclaimed on the escrow directly (section 5.2)
        uint144 seedTag; // the tag a funded deal must store: the low 144 bits of the primary's seed commitment
    }

    /// What the oracle reads about deal i of handler `x`: the rules contract, the escrow, and the handler's record
    /// of how the deal closed and of the buyer's own reclaim.
    function read(RulesHandler x, uint256 i) internal view returns (State memory s) {
        (HoldbackRules r,,) = x.system();
        bytes32 id = x.dealId(i);
        s.d = x.word(id);
        s.deliveryHash = r.deliveryHashOf(id);
        s.reason = x.closedBy(id);
        s.decider = x.closedDecider(id);
        (, s.capturable, s.refundable) = x.holdOf(i);
        s.buyerReclaimed = x.cppReclaimed(id);
        s.seedTag = x.seedTag();
    }

    /// Checks deal i of handler `x` against the phase-one table.
    function checkDeal(RulesHandler x, uint256 i) internal view returns (string memory) {
        return check(read(x, i), x.termsOf(i), rows());
    }

    function _r(string memory id, HoldbackRules.Stage s, uint8 attempt, uint8 reason, uint8 decider, uint8 t1)
        private
        pure
        returns (Row memory)
    {
        return Row(id, s, attempt, reason, decider, t1);
    }

    /// Section 9.3's table, row for row. L02 left with SC-6.
    function rows() internal pure returns (Row[] memory r) {
        HoldbackRules.Stage rel = HoldbackRules.Stage.Released;
        HoldbackRules.Stage ref = HoldbackRules.Stage.Refunded;
        HoldbackRules.Stage set = HoldbackRules.Stage.Settled;
        r = new Row[](17);
        r[0] = _r("P01", HoldbackRules.Stage.None, 0, OPEN, NOBODY, ZERO);
        r[1] = _r("P02", HoldbackRules.Stage.Held, 0, OPEN, NOBODY, ZERO);
        r[2] = _r("P03", HoldbackRules.Stage.Delivered, 1, OPEN, NOBODY, ZERO);
        r[3] = _r("P04", HoldbackRules.Stage.FallbackJudging, 1, OPEN, NOBODY, SET);
        r[4] = _r("P05", HoldbackRules.Stage.Escalated, 1, OPEN, NOBODY, SET);
        r[5] = _r("P06", rel, 1, DECIDED, PRIMARY, SET);
        r[6] = _r("P07", ref, 1, DECIDED, PRIMARY, SET);
        r[7] = _r("P08", rel, 1, DECIDED, FALLBACK, SET);
        r[8] = _r("P09", ref, 1, DECIDED, FALLBACK, SET);
        r[9] = _r("P10", rel, 1, DECIDED, APPEAL, SET);
        r[10] = _r("P11", ref, 1, DECIDED, APPEAL, SET);
        r[11] = _r("P12", ref, 1, DEFAULTED, NOBODY, SET);
        r[12] = _r("P13", rel, 1, ACCEPTED_EARLY, NOBODY, ZERO);
        r[13] = _r("P14", ref, 0, RECLAIMED, NOBODY, ZERO);
        r[14] = _r("P15", set, 0, SETTLED, NOBODY, ZERO);
        r[15] = _r("P16", set, 1, SETTLED, NOBODY, ZERO);
        r[16] = _r("P17", set, 1, SETTLED, NOBODY, SET);
    }

    function matches(Row memory r, State memory s) internal pure returns (bool) {
        HoldbackRules.Deal memory d = s.d;
        return d.stage == r.stage && d.attempt == r.attempt && s.reason == r.reason && s.decider == r.decider
            && (d.t1 != 0) == (r.t1 == SET) && (s.deliveryHash != bytes32(0)) == (r.attempt == 1);
    }

    /// The index in `table` of the row the state matches, plus one, or 0 for none (rows are disjoint: at most one
    /// matches).
    function rowIndex(State memory s, Row[] memory table) internal pure returns (uint256) {
        for (uint256 i; i < table.length; i++) {
            if (matches(table[i], s)) return i + 1;
        }
        return 0;
    }

    /// The row's position in the phase-one table (1 for P01 to 17 for P17), or 0 for none.
    function rowNumber(State memory s) internal pure returns (uint256) {
        return rowIndex(s, rows());
    }

    /// The row ID at position n (1-based) of the phase-one table.
    function rowId(uint256 n) internal pure returns (string memory) {
        return rows()[n - 1].id;
    }

    /// The ID of the row the state matches, or "" for none.
    function rowOf(State memory s) internal pure returns (string memory) {
        uint256 n = rowNumber(s);
        return n == 0 ? "" : rowId(n);
    }

    /// Returns "" when the deal's state is legal in `table`, otherwise why it is not, with the word.
    function check(State memory s, H.Terms memory t, Row[] memory table) internal pure returns (string memory) {
        HoldbackRules.Deal memory d = s.d;
        uint256 n = rowIndex(s, table);
        if (n == 0) return string.concat("no legal row (section 9): ", describe(s));
        string memory row = table[n - 1].id;
        bool unfunded = d.stage == HoldbackRules.Stage.None;
        if (d.seedTag != (unfunded ? 0 : s.seedTag)) {
            return string.concat(row, ": the seed tag is not the primary's seed commitment");
        }
        string memory times = _times(row, d, t);
        if (bytes(times).length != 0) return times;
        return _holds(row, s, t);
    }

    /// Section 9.3's bounds on t1.
    function _times(string memory row, HoldbackRules.Deal memory d, H.Terms memory t)
        private
        pure
        returns (string memory)
    {
        uint256 t1 = d.t1;
        uint256 judgeBy = t.timing.judgeBy;
        uint256 fallbackBy = t.timing.fallbackBy;
        // The fallback's turn starts at judgeBy at the earliest.
        if (_is(row, "P04") && t1 < judgeBy) return string.concat(row, ": t1 before judgeBy");
        // An escalation, and the appeal adjudicator's decision on it (t1 stays the escalation's time): the primary
        // escalated before judgeBy, or the fallback before fallbackBy. The word does not say which, so the bound is the
        // later of the two. (Since SC-5 the terms keep judgeBy before fallbackBy, so this is t1 < fallbackBy; T-356
        // left the expression as it was.)
        if ((_is(row, "P05") || _is(row, "P10") || _is(row, "P11")) && t1 >= judgeBy && t1 >= fallbackBy) {
            return string.concat(row, ": escalated at or after both judgeBy and fallbackBy");
        }
        if ((_is(row, "P06") || _is(row, "P07")) && t1 >= judgeBy) {
            return string.concat(row, ": the primary decided at or after judgeBy");
        }
        if ((_is(row, "P08") || _is(row, "P09")) && (t1 < judgeBy || t1 >= fallbackBy)) {
            return string.concat(row, ": the fallback decided outside [judgeBy, fallbackBy)");
        }
        return "";
    }

    /// Section 9.4: what the escrow holds for each row.
    function _holds(string memory row, State memory s, H.Terms memory t) private pure returns (string memory) {
        uint256 hold = t.price + t.fee;
        HoldbackRules.Stage st = s.d.stage;
        if (st == HoldbackRules.Stage.None) {
            if (s.capturable != 0 || s.refundable != 0) return string.concat(row, ": an unfunded deal holds money");
            return "";
        }
        if (s.reason == OPEN) {
            if (s.refundable != 0) return string.concat(row, ": a funded deal paid out");
            if (s.capturable == hold || (s.capturable == 0 && s.buyerReclaimed)) return "";
            return string.concat(row, ": the escrow does not hold price + fee");
        }
        if (s.capturable != 0) return string.concat(row, ": a closed deal still holds money");
        if (s.reason == SETTLED) {
            // P15 to P17: the seller's share, at most the price.
            if (s.refundable <= t.price) return "";
            return string.concat(row, ": a settlement paid out more than the price");
        }
        uint256 paid;
        if (s.reason == DECIDED) {
            // P06, P08, P10: price + fee out of the escrow; P07, P09, P11: the fee only.
            paid = st == HoldbackRules.Stage.Released ? hold : t.fee;
        } else if (s.reason == ACCEPTED_EARLY) {
            paid = t.price; // P13
        } else {
            paid = 0; // P12, P14: everything back to the buyer
        }
        if (s.refundable != paid) return string.concat(row, ": the escrow's refundable amount is not the row's");
        return "";
    }

    function _is(string memory a, string memory b) private pure returns (bool) {
        return keccak256(bytes(a)) == keccak256(bytes(b));
    }

    function describe(State memory s) internal pure returns (string memory) {
        HoldbackRules.Deal memory d = s.d;
        return string.concat(
            string.concat("stage ", _u(uint8(d.stage)), ", attempt ", _u(d.attempt), ", reason ", _u(s.reason)),
            string.concat(", decider ", _u(s.decider), d.t1 == 0 ? ", t1 zero" : ", t1 set"),
            s.deliveryHash == 0 ? ", no delivery hash" : ", a delivery hash"
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
