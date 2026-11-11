// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {DrandQuicknetBeacon} from "../../src/DrandQuicknetBeacon.sol";
import {SimBeacon} from "../../script/SimBeacon.sol";

/// T-209: the drand quicknet verifier against real rounds fetched from public relays
/// (fixtures/beacon/drand-quicknet.json carries the source URLs), and the local-chain sim beacon.
contract DrandBeaconTest is Test {
    string internal constant VECTORS = "../fixtures/beacon/drand-quicknet.json";

    DrandQuicknetBeacon internal beacon;

    // Three rounds pinned in code as well as in the fixture (the fixture test below checks every round in it).
    bytes internal constant SIG_1 =
        hex"b55e7cb2d5c613ee0b2e28d6750aabbb78c39dcc96bd9d38c2c2e12198df95571de8e8e402a0cc48871c7089a2b3af4b";
    bytes32 internal constant RAND_1 = 0x1466a6cd24e327188770752f6134001c64d6efcc590ccc26b721611ad96f165a;
    bytes internal constant SIG_1000 =
        hex"b44679b9a59af2ec876b1a6b1ad52ea9b1615fc3982b19576350f93447cb1125e342b73a8dd2bacbe47e4b6b63ed5e39";
    bytes32 internal constant RAND_1000 = 0xfe290beca10872ef2fb164d2aa4442de4566183ec51c56ff3cd603d930e54fdd;
    bytes internal constant SIG_20M =
        hex"96892582a33552a7b67ba44ef09c3ccd535bbebe760c93ecf45be8958d0c0f06390c6d19d7bf492eb806af7eef6b125c";
    bytes32 internal constant RAND_20M = 0xf39c98df5525968e6622e0c63edb3d1f9c5607cf780db78abdded36e4b3dba95;

    function setUp() public {
        vm.chainId(31337);
        beacon = new DrandQuicknetBeacon();
    }

    // ------------------------------------------------------------ valid rounds

    function test_realRounds_accepted_valueIsSha256OfSignature() public view {
        assertEq(beacon.beaconValue(1, SIG_1), RAND_1);
        assertEq(beacon.beaconValue(1000, SIG_1000), RAND_1000);
        assertEq(beacon.beaconValue(20_000_000, SIG_20M), RAND_20M);
        assertEq(RAND_1000, sha256(SIG_1000));
    }

    function test_everyFixtureRound_accepted() public view {
        string memory json = vm.readFile(VECTORS);
        assertEq(vm.parseJsonUint(json, ".info.genesisTime"), beacon.GENESIS());
        assertEq(vm.parseJsonUint(json, ".info.period"), beacon.PERIOD());
        uint256 n;
        for (uint256 i;; i++) {
            string memory k = string.concat(".rounds[", vm.toString(i), "]");
            if (!vm.keyExistsJson(json, k)) break;
            uint64 round = uint64(vm.parseJsonUint(json, string.concat(k, ".round")));
            bytes memory sig =
                vm.parseBytes(string.concat("0x", vm.parseJsonString(json, string.concat(k, ".signature"))));
            bytes32 rand =
                vm.parseBytes32(string.concat("0x", vm.parseJsonString(json, string.concat(k, ".randomness"))));
            assertEq(beacon.beaconValue(round, sig), rand, vm.toString(round));
            n++;
        }
        assertGe(n, 3, "at least three real rounds");
    }

    function test_hashToG1_matchesTheReferenceImplementation() public view {
        string memory json = vm.readFile(VECTORS);
        bytes memory expected = vm.parseBytes(string.concat("0x", vm.parseJsonString(json, ".hashToG1.1")));
        assertEq(beacon.hashToG1(sha256(abi.encodePacked(uint64(1)))), expected);
    }

    // ------------------------------------------------------------ refusals

    function test_refuses_wrongRound() public {
        vm.expectRevert(DrandQuicknetBeacon.InvalidSignature.selector);
        beacon.beaconValue(1001, SIG_1000);
    }

    function test_refuses_anotherRoundsSignature() public {
        vm.expectRevert(DrandQuicknetBeacon.InvalidSignature.selector);
        beacon.beaconValue(1, SIG_1000);
    }

    function test_refuses_theNegatedSignature() public {
        bytes memory s = SIG_1000;
        s[0] ^= 0x20; // the sign flag: -sig is on the curve and in G1, but does not verify
        vm.expectRevert(DrandQuicknetBeacon.InvalidSignature.selector);
        beacon.beaconValue(1000, s);
    }

    function test_refuses_aG1PointNotOnTheCurve() public {
        // x = 1: 1 + 4 = 5 is not a square mod p, so no point has this x.
        bytes memory s =
            hex"800000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001";
        vm.expectRevert(DrandQuicknetBeacon.InvalidSignature.selector);
        beacon.beaconValue(1000, s);
    }

    function test_refuses_aCurvePointOutsideG1() public {
        // x = 4 is on E(Fp) but not in the prime-order subgroup (checked off chain); PAIRING_CHECK refuses it.
        bytes memory s =
            hex"800000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000004";
        vm.expectRevert(DrandQuicknetBeacon.InvalidSignature.selector);
        beacon.beaconValue(1000, s);
    }

    function test_refuses_malformedEncodings() public {
        bytes memory s = SIG_1000;
        bytes memory uncompressed = bytes.concat(s);
        uncompressed[0] &= 0x7f;
        bytes memory infinity = bytes.concat(s);
        infinity[0] |= 0x40;
        bytes memory xTooLarge =
            hex"9a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaaab"; // x = p
        bytes[5] memory bad = [uncompressed, infinity, xTooLarge, bytes(hex""), bytes.concat(s, hex"00")];
        for (uint256 i; i < bad.length; i++) {
            vm.expectRevert(DrandQuicknetBeacon.InvalidSignature.selector);
            beacon.beaconValue(1000, bad[i]);
        }
    }

    function testFuzz_refuses_corruptedSignature(uint16 bit, bytes32 noise) public {
        bytes memory s = SIG_1000;
        uint256 b = bound(bit, 0, 383);
        s[b / 8] ^= bytes1(uint8(1) << uint8(7 - (b % 8)));
        // Optionally corrupt one more byte at a noise-chosen position.
        if (uint256(noise) & 1 == 1) s[uint256(noise >> 8) % 48] ^= bytes1(uint8(uint256(noise >> 1) | 1));
        if (keccak256(s) == keccak256(SIG_1000)) return; // the second flip undid the first
        vm.expectRevert(DrandQuicknetBeacon.InvalidSignature.selector);
        beacon.beaconValue(1000, s);
    }

    // ------------------------------------------------------------ round arithmetic (drand: round 1 at genesis)

    function test_roundAt_matchesDrand() public view {
        uint256 g = beacon.GENESIS();
        assertEq(beacon.roundAt(0), 0);
        assertEq(beacon.roundAt(g - 1), 0);
        assertEq(beacon.roundAt(g), 1);
        assertEq(beacon.roundAt(g + 2), 1);
        assertEq(beacon.roundAt(g + 3), 2);
        assertEq(beacon.roundAt(g + (20_000_000 - 1) * 3), 20_000_000);
        // api.drand.sh/public/latest returned round 33600306 at unix time 1793604284 (fixture roundFormula.check).
        assertEq(beacon.roundAt(1_793_604_284), 33_600_306);
    }

    // ------------------------------------------------------------ the sim beacon (local chains only)

    function test_sim_valueIsKeccakOfSeedAndRound_roundIsTheSecond() public {
        SimBeacon sim = new SimBeacon(keccak256("seed"));
        vm.warp(1000);
        assertEq(sim.roundAt(1000), 1000);
        assertEq(sim.roundAt(0), 0);
        assertEq(sim.beaconValue(999, ""), keccak256(abi.encodePacked(keccak256("seed"), uint64(999))));
        assertEq(sim.beaconValue(1000, ""), keccak256(abi.encodePacked(keccak256("seed"), uint64(1000))));
    }

    function test_sim_refusesAFutureRoundAndAnyProof() public {
        SimBeacon sim = new SimBeacon(keccak256("seed"));
        vm.warp(1000);
        vm.expectRevert(SimBeacon.RoundUnavailable.selector);
        sim.beaconValue(1001, "");
        vm.expectRevert(SimBeacon.RoundUnavailable.selector);
        sim.beaconValue(999, hex"01");
    }

    function test_sim_refusesToDeployOffALocalChain() public {
        vm.chainId(11155111); // Sepolia
        vm.expectRevert(SimBeacon.NotALocalChain.selector);
        new SimBeacon(keccak256("seed"));
    }
}
