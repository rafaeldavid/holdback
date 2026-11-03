// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {HoldbackRules} from "../../src/HoldbackRules.sol";
import {HoldbackTypes as H} from "../../src/HoldbackTypes.sol";
import {Base} from "./Base.sol";

/// T-206 finding H-2: a party-appeal decision may carry the buyer's key only where the seller was paid (ADR-0012:
/// "on rejection or reclaim, the key is never released to the buyer"; formal model KeyOnlyWithPayment).
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

    function _appealDecision(H.Terms memory t, bytes32 id, uint64 round, uint8 outcome)
        internal
        view
        returns (H.Decision memory m)
    {
        m = _beaconDecision(id, H.ROLE_APPEAL, outcome, round);
        m.keyScheme = KEY_SCHEME;
        m.keyCiphertext = KEY_CT;
        m = _signDecision(t, id, m, appealAdj, AP_PK);
    }

    function _keyReleased() internal returns (bool) {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].topics[0] == HoldbackRules.KeyReleased.selector) return true;
        }
        return false;
    }

    function test_overturnedReject_refusesAKeyForTheRefundedBuyer() public {
        (H.Terms memory t, bytes32 id, uint64 round) = _appealed(H.OUTCOME_REJECT, 1);
        H.Decision memory m = _appealDecision(t, id, round, H.OUTCOME_ACCEPT);
        vm.expectRevert(HoldbackRules.InvalidMessage.selector);
        rules.decide(t, m, _noDelivery(), "");
    }

    function test_upheldReject_refusesAKeyForTheRefundedBuyer() public {
        (H.Terms memory t, bytes32 id, uint64 round) = _appealed(H.OUTCOME_REJECT, 0);
        H.Decision memory m = _appealDecision(t, id, round, H.OUTCOME_REJECT);
        vm.expectRevert(HoldbackRules.InvalidMessage.selector);
        rules.decide(t, m, _noDelivery(), "");
    }

    function test_overturnedReject_withoutAKey_decides() public {
        (H.Terms memory t, bytes32 id, uint64 round) = _appealed(H.OUTCOME_REJECT, 1);
        H.Decision memory m = _beaconDecision(id, H.ROLE_APPEAL, H.OUTCOME_ACCEPT, round);
        m.keyScheme = "";
        m.keyCiphertext = "";
        m = _signDecision(t, id, m, appealAdj, AP_PK);
        rules.decide(t, m, _noDelivery(), "");
        assertEq(uint8(rules.dealOf(id).appeal), uint8(HoldbackRules.AppealState.Overturned));
    }

    /// ADR-0012's "missing or wrong key" ground: after an accept the appeal may still carry the key.
    function test_upheldAccept_releasesTheKey() public {
        (H.Terms memory t, bytes32 id, uint64 round) = _appealed(H.OUTCOME_ACCEPT, 0);
        H.Decision memory m = _appealDecision(t, id, round, H.OUTCOME_ACCEPT);
        vm.recordLogs();
        rules.decide(t, m, _noDelivery(), "");
        assertTrue(_keyReleased());
        assertEq(uint8(rules.dealOf(id).appeal), uint8(HoldbackRules.AppealState.Upheld));
    }
}
