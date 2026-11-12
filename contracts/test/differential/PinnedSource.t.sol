// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";

/// @title The pinned old side is the deployed commit (T-341)
/// @notice `old/` holds the contract source the Sepolia world runs: `contracts/src/` at commit `64be1f1`, the five
///         files the harness deploys. This test reads, from the compiler's own metadata in each artifact, the
///         keccak256 of every source file the copies were compiled from, and checks it against the pinned value: a
///         changed byte fails it, and it checks the bytes that were actually compiled. The values were measured on
///         2026-11-11 from the artifacts of `main` at 26d4670, where each `old/` file has the same git blob id as
///         `64be1f1:contracts/src/<file>` (`git hash-object` against `git rev-parse`) and the same keccak256 as
///         `src/`. The drand verifier (`DrandQuicknetBeacon.sol`) is not vendored: the harness's world uses the
///         sim beacon, as the unit and invariant suites do. The planted copy is pinned too, so its stated
///         difference cannot drift.
/// @dev No `fs_permissions` change: `./out` is already readable, and `foundry.toml` must stay equal to 64be1f1 for
///      `deploy-sepolia.sh --check`.
contract PinnedSourceTest is Test {
    string internal constant OLD = "test/differential/old/";

    bytes32 internal constant RULES = 0x5b0557cd998b71c39f5b39ddf90e06db371018ecd8b6666f07abfb6aa4432ebc;
    bytes32 internal constant BONDS = 0x78f15e58a1325e77bdbe9562cf376b152db7e41aff66b5bb0b5fa1f6b6aa4eaf;
    bytes32 internal constant TYPES = 0x14bb6f68982c733a257c70e02e98595a9eaadde5825792b3a9e4db46ae16f514;
    bytes32 internal constant BEACON_IFACE = 0x91f6b5fa005d7ea75b872d7dc19293167379c43e0e61550f25f9e65db476de28;
    bytes32 internal constant SIM = 0x674a26c77a2803179c8b0e9e2571c2bf16e785126f022e2a3c151cc86b968a41;
    bytes32 internal constant PLANTED = 0x5c3bdc14a989104a11b03eeeae7de0f41cd6d74eb1d9a4098edf806d1212167d;

    /// The keccak256 the compiler recorded for `source` in the artifact at `artifact`.
    function _compiled(string memory artifact, string memory source) internal view returns (bytes32) {
        string memory json = vm.readFile(string.concat("out/", artifact));
        return vm.parseJsonBytes32(json, string.concat(".metadata.sources.['", source, "'].keccak256"));
    }

    function test_oldIsTheDeployedCommit64be1f1() public view {
        string memory a = "HoldbackRules.64be1f1.sol/HoldbackRules.json";
        assertEq(_compiled(a, string.concat(OLD, "HoldbackRules.64be1f1.sol")), RULES, "old/HoldbackRules");
        assertEq(_compiled(a, string.concat(OLD, "HoldbackBonds.sol")), BONDS, "old/HoldbackBonds");
        assertEq(_compiled(a, string.concat(OLD, "HoldbackTypes.sol")), TYPES, "old/HoldbackTypes");
        assertEq(_compiled(a, string.concat(OLD, "IHoldbackBeacon.sol")), BEACON_IFACE, "old/IHoldbackBeacon");
        assertEq(_compiled("old/SimBeacon.sol/SimBeacon.json", string.concat(OLD, "SimBeacon.sol")), SIM, "old/SimBeacon");
    }

    /// The planted copy: `old/HoldbackRules.64be1f1.sol`, its imports pointed at `../old/`, a header comment, and
    /// the line `deliveryHashOf[id] = dh;` deleted. It compiles against the pinned old files.
    function test_plantedCopyIsPinned() public view {
        string memory a = "HoldbackRules.planted.sol/HoldbackRules.json";
        assertEq(_compiled(a, "test/differential/planted/HoldbackRules.planted.sol"), PLANTED, "planted copy");
        assertEq(_compiled(a, string.concat(OLD, "HoldbackBonds.sol")), BONDS, "planted: old/HoldbackBonds");
        assertEq(_compiled(a, string.concat(OLD, "HoldbackTypes.sol")), TYPES, "planted: old/HoldbackTypes");
    }

    /// The copies share their contract names with `src/`. Forge writes the copies' artifacts elsewhere and keeps
    /// `src/`'s at the short paths that `NoAdmin.fuzz.t.sol` and the anvil suites read. This pins that: a
    /// short-path artifact compiled from a copy fails here.
    function test_shortArtifactPathsAreTheSourceUnderTest() public view {
        string[3] memory names = ["HoldbackRules", "HoldbackBonds", "SimBeacon"];
        for (uint256 i; i < 3; i++) {
            string memory json = vm.readFile(string.concat("out/", names[i], ".sol/", names[i], ".json"));
            string[] memory target = vm.parseJsonKeys(json, ".metadata.settings.compilationTarget");
            assertEq(target.length, 1);
            assertEq(target[0], string.concat("src/", names[i], ".sol"), "a short-path artifact is not src/");
        }
    }

    /// The renamed copies keep name lookups unambiguous: `Vectors.t.sol` deploys "HoldbackRules.sol:HoldbackRules".
    function test_nameLookupFindsOnlyTheSource() public view {
        assertEq(
            keccak256(vm.getCode("HoldbackRules.sol:HoldbackRules")),
            keccak256(vm.getCode("src/HoldbackRules.sol:HoldbackRules"))
        );
    }
}
