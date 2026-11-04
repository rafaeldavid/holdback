// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {HoldbackRules} from "../../src/HoldbackRules.sol";
import {HoldbackTypes as H} from "../../src/HoldbackTypes.sol";
import {Base} from "./Base.sol";

/// T-206 H-2: a decision carries the buyer's key only with an accept, and never on a deal that stands Refunded
/// (ADR-0012: "on rejection or reclaim, the key is never released to the buyer"; formal model KeyOnlyWithPayment).
contract AppealKeyTest is Base {
    /// The first decision has `firstOutcome`, `appellant` appeals, and time reaches the appeal round. The round is
    /// read from the deal (block.timestamp is not re-read after a warp under via_ir).
    function _appealed(uint8 firstOutcome, uint8 appellant)
        internal
        returns (H.Terms memory t, bytes32 id, uint64 round)
    {
        (t, id) = _funded();
        _deliver(t, id);
        rules.decide(t, _primary(t, id, firstOutcome), _noDelivery(), "");
        (address who, uint256 pk) = appellant == 0 ? (buyer, BUYER_PK) : (seller, SELLER_PK);
        vm.prank(who);
        usdc.approve(address(bonds), type(uint256).max);
        H.Appeal memory a =
            H.Appeal({appellant: appellant, groundsHash: keccak256("g"), bond: 1_000, filedAt: 0, signature: ""});
        a.signature = _sign(pk, hx.appeal(id, who, t.token, a));
        rules.fileAppeal(t, a);
        round = uint64(rules.dealOf(id).t2) + 1;
        vm.warp(round);
    }

    function _appealDecision(H.Terms memory t, bytes32 id, uint64 round, uint8 outcome, bool withKey)
        internal
        view
        returns (H.Decision memory m)
    {
        m = _beaconDecision(id, H.ROLE_APPEAL, outcome, round);
        (m.keyScheme, m.keyCiphertext) = withKey ? (KEY_SCHEME, KEY_CT) : ("", "");
        m = _signDecision(t, id, m, appealAdj, AP_PK);
    }

    function _keyReleased() internal returns (bool) {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].topics[0] == HoldbackRules.KeyReleased.selector) return true;
        }
        return false;
    }

    // ------------------------------------------------------------ party appeals

    function test_overturnedReject_refusesAKeyForTheRefundedBuyer() public {
        (H.Terms memory t, bytes32 id, uint64 round) = _appealed(H.OUTCOME_REJECT, 1);
        H.Decision memory m = _appealDecision(t, id, round, H.OUTCOME_ACCEPT, true);
        vm.expectRevert(HoldbackRules.InvalidMessage.selector);
        rules.decide(t, m, _noDelivery(), "");
    }

    /// The refusal leaves the appeal open; the same verdict re-signed without the key settles it.
    function test_overturnedReject_withoutTheKey_settles() public {
        (H.Terms memory t, bytes32 id, uint64 round) = _appealed(H.OUTCOME_REJECT, 1);
        H.Decision memory m = _appealDecision(t, id, round, H.OUTCOME_ACCEPT, true);
        vm.expectRevert(HoldbackRules.InvalidMessage.selector);
        rules.decide(t, m, _noDelivery(), "");
        assertEq(uint8(rules.dealOf(id).appeal), uint8(HoldbackRules.AppealState.Open));
        rules.decide(t, _appealDecision(t, id, round, H.OUTCOME_ACCEPT, false), _noDelivery(), "");
        assertEq(uint8(rules.dealOf(id).appeal), uint8(HoldbackRules.AppealState.Overturned));
    }

    function test_upheldReject_refusesAKey() public {
        (H.Terms memory t, bytes32 id, uint64 round) = _appealed(H.OUTCOME_REJECT, 1);
        H.Decision memory m = _appealDecision(t, id, round, H.OUTCOME_REJECT, true);
        vm.expectRevert(HoldbackRules.InvalidMessage.selector);
        rules.decide(t, m, _noDelivery(), "");
    }

    function test_overturnedAccept_refusesAKey() public {
        (H.Terms memory t, bytes32 id, uint64 round) = _appealed(H.OUTCOME_ACCEPT, 0);
        H.Decision memory m = _appealDecision(t, id, round, H.OUTCOME_REJECT, true);
        vm.expectRevert(HoldbackRules.InvalidMessage.selector);
        rules.decide(t, m, _noDelivery(), "");
    }

    /// ADR-0012's "missing or wrong key" ground: after an accept the appeal may still carry the key.
    function test_upheldAccept_releasesTheKey() public {
        (H.Terms memory t, bytes32 id, uint64 round) = _appealed(H.OUTCOME_ACCEPT, 0);
        H.Decision memory m = _appealDecision(t, id, round, H.OUTCOME_ACCEPT, true);
        vm.recordLogs();
        rules.decide(t, m, _noDelivery(), "");
        assertTrue(_keyReleased());
        assertEq(uint8(rules.dealOf(id).appeal), uint8(HoldbackRules.AppealState.Upheld));
    }

    // ------------------------------------------------------------ decisions that move the escrow

    function test_firstInstanceReject_refusesAKey() public {
        (H.Terms memory t, bytes32 id) = _funded();
        _deliver(t, id);
        H.Decision memory m = _decision(H.ROLE_PRIMARY, H.OUTCOME_REJECT);
        (m.keyScheme, m.keyCiphertext) = (KEY_SCHEME, KEY_CT);
        m = _signDecision(t, id, m, adjudicator, ADJ_PK);
        vm.expectRevert(HoldbackRules.InvalidMessage.selector);
        rules.decide(t, m, _noDelivery(), "");
    }

    function test_escalatedReject_refusesAKey() public {
        (H.Terms memory t, bytes32 id) = _funded();
        _deliver(t, id);
        rules.decide(t, _primary(t, id, H.OUTCOME_ESCALATE), _noDelivery(), "");
        uint64 round = uint64(rules.dealOf(id).t1) + 1;
        vm.warp(round);
        H.Decision memory m = _appealDecision(t, id, round, H.OUTCOME_REJECT, true);
        vm.expectRevert(HoldbackRules.InvalidMessage.selector);
        rules.decide(t, m, _noDelivery(), "");
    }
}
