// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {DrandQuicknetBeacon} from "../../src/DrandQuicknetBeacon.sol";

/// T-353: checks behind the second-family read of the drand verifier
/// (docs/reviews/2026-11-11-drand-verifier-second-read.md). Each test settles one claim the other model made about
/// gas or encodings: the exact price of each precompile the verifier calls, under the repo's evm_version (prague),
/// and the cost of one whole verification.
contract DrandSecondReadTest is Test {
    DrandQuicknetBeacon internal beacon;

    address internal constant MODEXP = address(0x05);
    address internal constant G1ADD = address(0x0b);
    address internal constant PAIRING_CHECK = address(0x0f);
    address internal constant MAP_FP_TO_G1 = address(0x10);

    uint256 internal constant P_HI = 0x1a0111ea397fe69a4b1ba7b6434bacd7;
    uint256 internal constant P_LO = 0x64774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaaab;
    uint128 internal constant SQRT_EXP_HI = 0x0680447a8e5ff9a692c6e9ed90d2eb35;
    uint256 internal constant SQRT_EXP_LO = 0xd91dd2e13ce144afd9cc34a83dac3d8907aaffffac54ffffee7fbfffffffeaab;

    bytes internal constant SIG_1000 =
        hex"b44679b9a59af2ec876b1a6b1ad52ea9b1615fc3982b19576350f93447cb1125e342b73a8dd2bacbe47e4b6b63ed5e39";

    function setUp() public {
        vm.chainId(31337);
        beacon = new DrandQuicknetBeacon();
    }

    /// The call succeeds with exactly `price` gas and fails with one gas less: the precompile's price, measured.
    function _assertPrice(address precompile, bytes memory input, uint256 price, string memory name) internal view {
        (bool under,) = precompile.staticcall{gas: price - 1}(input);
        (bool at,) = precompile.staticcall{gas: price}(input);
        assertFalse(under, string.concat(name, " ran on one gas less than its price"));
        assertTrue(at, string.concat(name, " failed at its price"));
    }

    /// The model put MAP_FP_TO_G1 at 25,000 gas and G1ADD at 600 (from memory). EIP-2537 as activated in Prague
    /// prices them at 5,500 and 375; two pairs of PAIRING_CHECK cost 32,600 * 2 + 37,700 = 102,900.
    function test_secondRead_eip2537Prices() public view {
        _assertPrice(G1ADD, new bytes(256), 375, "G1ADD");
        bytes memory one = new bytes(64);
        one[63] = 0x01;
        _assertPrice(MAP_FP_TO_G1, one, 5_500, "MAP_FP_TO_G1");
        _assertPrice(PAIRING_CHECK, new bytes(768), 102_900, "PAIRING_CHECK, two pairs");
    }

    /// The model put the square-root MODEXP near 776,000 gas. Under EIP-2565 a 64-byte base and modulus are 8 words
    /// (complexity 64), and the 48-byte exponent (p + 1) / 4 counts 8 * 16 + 250 = 378 iterations: 64 * 378 / 3 =
    /// 8,064 gas. The 1-byte exponents (1, 2, 3) cost the 200-gas minimum.
    function test_secondRead_modexpPrices() public view {
        bytes memory sqrtInput = abi.encodePacked(
            uint256(64), uint256(48), uint256(64), uint256(0), uint256(4), SQRT_EXP_HI, SQRT_EXP_LO, P_HI, P_LO
        );
        _assertPrice(MODEXP, sqrtInput, 8_064, "MODEXP sqrt");
        bytes memory cubeInput =
            abi.encodePacked(uint256(64), uint256(1), uint256(64), uint256(0), uint256(4), hex"03", P_HI, P_LO);
        _assertPrice(MODEXP, cubeInput, 200, "MODEXP cube");
    }

    /// One whole verification of a real round, as the contract runs it: logged, and bounded below by the sum of
    /// its precompile prices (123,799 gas under EIP-2565, the script in reports/scratch/t-353/check_constants.py).
    function test_secondRead_oneVerificationGas() public {
        uint256 before = gasleft();
        beacon.beaconValue(1000, SIG_1000);
        uint256 used = before - gasleft();
        emit log_named_uint("beaconValue(1000) gas, call included", used);
        assertGt(used, 123_799);
        assertLt(used, 200_000);
    }

    /// The model said another drand chain's signature fails the pairing because the key differs. drand's default
    /// chain signs on G2, so its signature is 96 bytes: the length check refuses it before any precompile runs.
    function test_secondRead_aG2SignatureIsRefusedByLength() public {
        bytes memory g2Sized = new bytes(96);
        g2Sized[0] = 0x80;
        vm.expectRevert(DrandQuicknetBeacon.InvalidSignature.selector);
        beacon.beaconValue(1000, g2Sized);
    }
}
