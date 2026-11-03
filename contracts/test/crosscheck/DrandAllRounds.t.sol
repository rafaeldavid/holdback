// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {DrandQuicknetBeacon} from "../../src/DrandQuicknetBeacon.sol";

/// Red-team cross-check of D1. The review states "on all 7 fixture rounds exactly one encoding verifies [measured]"
/// but the committed test (`test_defense_onlyThePublishedFlagsVerify`) checks round 1000 only. This runs the same
/// eight-flag sweep over every round in the fixture.
contract DrandAllRoundsTest is Test {
    string internal constant VECTORS = "../fixtures/beacon/drand-quicknet.json";

    DrandQuicknetBeacon internal beacon;

    function setUp() public {
        beacon = new DrandQuicknetBeacon();
    }

    function _verifies(uint64 round, bytes memory s) internal view returns (bool ok) {
        (ok,) = address(beacon).staticcall(abi.encodeCall(DrandQuicknetBeacon.beaconValue, (round, s)));
    }

    function test_defense_everyFixtureRound_exactlyOneOfEightFlagEncodingsVerifies() public view {
        string memory json = vm.readFile(VECTORS);
        uint256 n;
        for (uint256 i;; i++) {
            string memory k = string.concat(".rounds[", vm.toString(i), "]");
            if (!vm.keyExistsJson(json, k)) break;
            uint64 round = uint64(vm.parseJsonUint(json, string.concat(k, ".round")));
            bytes memory sig =
                vm.parseBytes(string.concat("0x", vm.parseJsonString(json, string.concat(k, ".signature"))));
            uint8 published = uint8(sig[0]) >> 5;
            uint256 accepted;
            for (uint8 f; f < 8; ++f) {
                bytes memory s = sig;
                s[0] = bytes1((uint8(sig[0]) & 0x1f) | (f << 5));
                bool ok = _verifies(round, s);
                if (ok) accepted++;
                assertEq(ok, f == published, string.concat("round ", vm.toString(round), " flags ", vm.toString(f)));
            }
            assertEq(accepted, 1);
            n++;
        }
        assertGe(n, 7, "all seven fixture rounds");
    }

    // Note: an "x + p" re-encoding sweep over the fixture rounds was tried and dropped: none of the seven
    // signatures has x < 2^381 - p, so x + p never fits the 381-bit field and the sweep asserted nothing. The PR's
    // `test_defense_xAboveP_refused` (x = p + 1 and 2^381 - 1) is the live check for that class.
}
