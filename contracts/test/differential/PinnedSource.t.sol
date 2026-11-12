// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
// `forge test` compiles only what the selected tests import (measured 2026-11-12: a clean `--match-path` run of this
// file alone compiled 44 files and found none of the copies). These imports keep every pinned copy compiled, and
// its artifact readable below, whichever tests run. Since T-356 nothing else imports `old/SimBeacon.sol`. The
// sources under test are imported too: which copy gets a short artifact path depends on what is compiled with it.
import {HoldbackRules} from "../../src/HoldbackRules.sol";
import {SimBeacon} from "../../script/SimBeacon.sol";
import {HoldbackRules as OldRules} from "./old/HoldbackRules.64be1f1.sol";
import {SimBeacon as OldSimBeacon} from "./old/SimBeacon.sol";
import {HoldbackRules as ParentRules} from "./parent/HoldbackRules.02ddb24.sol";
import {HoldbackRules as PlantedRules} from "./planted/HoldbackRules.planted.sol";

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
    string internal constant PARENT = "test/differential/parent/";
    bytes32 internal constant PARENT_RULES = 0xe57cb78c5b8d797ea2cf2d5cd7033ef21d26d1c834faf32cdbe71b725f4f1a44;
    bytes32 internal constant PARENT_TYPES = 0xf166b963bbd4b054369bd683ce7776761946cd1aa62de101b637a14711040d9f;
    bytes32 internal constant PARENT_BEACON_IFACE = 0xd9a32bbbbf432f05199e0fb35c82aff4f944783ffd9fc59816d094fba5db2ae3;
    bytes32 internal constant PLANTED = 0x689e6fad0f3a5e349e65d09d8de2354b4abb7e08796562c66061f72a9cdb0d90;

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

    /// T-356: the harness's old side is the change's parent commit, `parent/`: `contracts/src/` at `02ddb24`, the
    /// three files the pinned side deploys (the sim beacon is `script/SimBeacon.sol`, unchanged since).
    /// `IHoldbackBeacon.sol` has the same git blob id as `02ddb24:contracts/src/IHoldbackBeacon.sol`. T-358 changes
    /// the signed type, so the other two are re-seated for it (ADR-0033 §1), and nothing else: `HoldbackRules.02ddb24.sol`
    /// differs from `02ddb24:contracts/src/HoldbackRules.sol` only in the domain version, "0.8" (two lines), and
    /// `HoldbackTypes.sol` is T-358's `src/HoldbackTypes.sol`, whose diff from `02ddb24` is the struct, the type string
    /// and the commitment ID (measured 2026-11-12 with `diff`). The values below are the compiler's keccak256.
    function test_parentIsTheChangesParent() public view {
        string memory a = "HoldbackRules.02ddb24.sol/HoldbackRules.json";
        assertEq(_compiled(a, string.concat(PARENT, "HoldbackRules.02ddb24.sol")), PARENT_RULES, "parent/HoldbackRules");
        assertEq(_compiled(a, string.concat(PARENT, "HoldbackTypes.sol")), PARENT_TYPES, "parent/HoldbackTypes");
        assertEq(_compiled(a, string.concat(PARENT, "IHoldbackBeacon.sol")), PARENT_BEACON_IFACE, "parent/IHoldbackBeacon");
    }

    /// The planted copy: `parent/HoldbackRules.02ddb24.sol`, its imports pointed at `../parent/`, a header comment,
    /// and the line `deliveryHashOf[id] = dh;` deleted. It compiles against the pinned parent files.
    function test_plantedCopyIsPinned() public view {
        string memory a = "HoldbackRules.planted.sol/HoldbackRules.json";
        assertEq(_compiled(a, "test/differential/planted/HoldbackRules.planted.sol"), PLANTED, "planted copy");
        assertEq(_compiled(a, string.concat(PARENT, "HoldbackTypes.sol")), PARENT_TYPES, "planted: parent/HoldbackTypes");
        assertEq(
            _compiled(a, string.concat(PARENT, "IHoldbackBeacon.sol")), PARENT_BEACON_IFACE, "planted: parent/IHoldbackBeacon"
        );
    }

    /// The copies share their contract names with `src/`. Forge writes the copies' artifacts elsewhere and keeps
    /// `src/`'s at the short paths that `NoAdmin.fuzz.t.sol` and the anvil suites read. This pins that: a
    /// short-path artifact compiled from a copy fails here. The sim beacon is a test fixture under `script/` since
    /// T-334, so its short path must be that file. Since T-346 (SC-7) `src/` has no bond vault, so the short-path
    /// `HoldbackBonds` artifact is the pinned copy's, as it must be: only `old/` still has the vault.
    function test_shortArtifactPathsAreTheSourceUnderTest() public view {
        string[3] memory names = ["HoldbackRules", "HoldbackBonds", "SimBeacon"];
        string[3] memory dirs = ["src/", "test/differential/old/", "script/"];
        for (uint256 i; i < 3; i++) {
            string memory json = vm.readFile(string.concat("out/", names[i], ".sol/", names[i], ".json"));
            string[] memory target = vm.parseJsonKeys(json, ".metadata.settings.compilationTarget");
            assertEq(target.length, 1);
            assertEq(target[0], string.concat(dirs[i], names[i], ".sol"), "a short-path artifact is not the source under test");
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
