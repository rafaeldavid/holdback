// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";

import {GitBlob} from "./GitBlob.sol";

/// @title The pinned old side is the deployed commit (T-341)
/// @notice `old/` holds the contract source the Sepolia world runs: `contracts/src/` at commit `64be1f1`, the five
///         files the harness deploys. Each file's git blob id is pinned below, as `git rev-parse
///         64be1f1:contracts/src/<file>` prints it; a changed byte changes the id and fails this test. The drand
///         verifier (`DrandQuicknetBeacon.sol`) is not vendored: the harness's world uses the sim beacon, as the
///         unit and invariant suites do. The planted copy is pinned too, so its stated difference cannot drift.
contract PinnedSourceTest is Test {
    string internal constant DIR = "test/differential/";

    function _assertBlob(string memory path, bytes20 expected) internal view {
        bytes20 got = GitBlob.id(vm.readFileBinary(string.concat(DIR, path)));
        assertEq(got, expected, string.concat(path, ": not the pinned bytes"));
    }

    /// `old/HoldbackRules.64be1f1.sol` is `src/HoldbackRules.sol` renamed: see the note in `Sides.sol`.
    function test_oldIsTheDeployedCommit64be1f1() public view {
        _assertBlob("old/HoldbackRules.64be1f1.sol", hex"c9fa1cbda04ff89865bc00b8a3d602a056302751");
        _assertBlob("old/HoldbackBonds.sol", hex"a71424f7b59685e87f4b5ca76ec23a863b52cd70");
        _assertBlob("old/HoldbackTypes.sol", hex"021ece53338281c926670f184ff2718abca0a05c");
        _assertBlob("old/IHoldbackBeacon.sol", hex"0e2c8c691c42aaf40d621008a690c840ca3419ef");
        _assertBlob("old/SimBeacon.sol", hex"c5fae10341612b7284099be49997cf60f50d1b77");
    }

    /// The renamed copies keep name lookups unambiguous: `Vectors.t.sol` deploys "HoldbackRules.sol:HoldbackRules".
    function test_nameLookupFindsOnlyTheSource() public view {
        assertEq(keccak256(vm.getCode("HoldbackRules.sol:HoldbackRules")), keccak256(vm.getCode("src/HoldbackRules.sol:HoldbackRules")));
    }

    /// The planted copy: `old/HoldbackRules.64be1f1.sol`, its imports pointed at `../old/`, a header comment, and
    /// the line `deliveryHashOf[id] = dh;` deleted.
    function test_plantedCopyIsPinned() public view {
        _assertBlob("planted/HoldbackRules.planted.sol", hex"d11893758b4fbfb41980df1c6d7934383ca0c720");
    }

    /// The copies share their contract names with `src/`. Forge writes the copies' artifacts under `out/old/` and
    /// `out/planted/` and keeps `src/`'s at the short paths that `NoAdmin.fuzz.t.sol`, the deploy script and the
    /// anvil suites read. This pins that: a short-path artifact compiled from a copy fails here.
    function test_shortArtifactPathsAreTheSourceUnderTest() public view {
        string[3] memory names = ["HoldbackRules", "HoldbackBonds", "SimBeacon"];
        for (uint256 i; i < 3; i++) {
            string memory json = vm.readFile(string.concat("out/", names[i], ".sol/", names[i], ".json"));
            string[] memory target = vm.parseJsonKeys(json, ".metadata.settings.compilationTarget");
            assertEq(target.length, 1);
            assertEq(target[0], string.concat("src/", names[i], ".sol"), "a short-path artifact is not src/");
        }
    }

    /// The hash itself, against published vectors: FIPS 180-4 and git's empty blob.
    function test_sha1Vectors() public pure {
        assertEq(GitBlob.sha1(""), bytes20(hex"da39a3ee5e6b4b0d3255bfef95601890afd80709"));
        assertEq(GitBlob.sha1("abc"), bytes20(hex"a9993e364706816aba3e25717850c26c9cd0d89d"));
        assertEq(
            GitBlob.sha1("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"),
            bytes20(hex"84983e441c3bd26ebaae4aa1f95129e5e54670f1")
        );
        assertEq(GitBlob.id(""), bytes20(hex"e69de29bb2d1d6434b8b29ae775ad8c2e48c5391"));
    }
}
