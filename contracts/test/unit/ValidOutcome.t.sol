// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";

import {HoldbackTypes as H} from "../../src/HoldbackTypes.sol";

/// T-384 (RF-5, IS-9): `H.isValidOutcome` names the outcomes a role may decide by membership, not by the numeric order
/// of the constants. Over every role and outcome byte it accepts exactly what the rule it replaced accepted:
/// `outcome <= (role == ROLE_APPEAL ? OUTCOME_REJECT : OUTCOME_ESCALATE)`, the bound in `decide` up to the lane's
/// commit 73bbafa.
contract ValidOutcomeTest is Test {
    /// The bound `decide` used before T-384, kept here as the reference.
    function _numericOrderRule(uint8 role, uint8 outcome) internal pure returns (bool) {
        return outcome <= (role == H.ROLE_APPEAL ? H.OUTCOME_REJECT : H.OUTCOME_ESCALATE);
    }

    function test_isValidOutcome_matchesTheNumericOrderRule_forEveryRoleAndOutcome() public pure {
        for (uint256 role; role < 256; ++role) {
            for (uint256 outcome; outcome < 256; ++outcome) {
                if (H.isValidOutcome(uint8(role), uint8(outcome)) != _numericOrderRule(uint8(role), uint8(outcome))) {
                    revert(string.concat("differs at role ", vm.toString(role), ", outcome ", vm.toString(outcome)));
                }
            }
        }
    }

    function test_isValidOutcome_theThreeRoles() public pure {
        assertTrue(H.isValidOutcome(H.ROLE_PRIMARY, H.OUTCOME_ESCALATE));
        assertTrue(H.isValidOutcome(H.ROLE_FALLBACK, H.OUTCOME_ESCALATE));
        assertFalse(H.isValidOutcome(H.ROLE_APPEAL, H.OUTCOME_ESCALATE));
        assertTrue(H.isValidOutcome(H.ROLE_APPEAL, H.OUTCOME_ACCEPT));
        assertTrue(H.isValidOutcome(H.ROLE_APPEAL, H.OUTCOME_REJECT));
        assertFalse(H.isValidOutcome(H.ROLE_PRIMARY, 3));
    }
}
