// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";

/// T-339: a planted failing test. It exists only to show that CI's contracts job, and the required check job, fail
/// on a failing contract test. The PR that carries it is closed unmerged.
contract PlantedFailureTest is Test {
    function test_plantedFailure() public pure {
        assertTrue(false, "T-339 planted failure: CI must fail on this");
    }
}
