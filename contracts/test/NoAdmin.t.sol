// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {HoldbackRules} from "../src/HoldbackRules.sol";
import {SpikeBase} from "./SpikeBase.sol";

/// Hard rule "No admin keys": HoldbackRules exposes exactly the selectors below and nothing else, has no
/// fallback or receive, and every common admin selector fails. A new public function must be added here on
/// purpose, which makes an admin path a visible diff.
contract NoAdminTest is SpikeBase {
    string internal constant ARTIFACT = "out/HoldbackRules.sol/HoldbackRules.json";
    string internal constant T = "(bytes32,address,address,address,address,uint120,uint120,uint48,uint48,uint48)";

    function _allowed() internal pure returns (string[] memory s) {
        s = new string[](13);
        s[12] = "TERMS_TYPEHASH()";
        s[0] = "COLLECTOR()";
        s[1] = "ESCROW()";
        s[2] = string.concat("decide(", T, ",bool,bytes)");
        s[3] = "decisionDigest(bytes32,bool)";
        s[4] = string.concat("earlyAccept(", T, ",bytes)");
        s[5] = "earlyAcceptDigest(bytes32)";
        s[6] = "eip712Domain()";
        s[7] = string.concat("fund(", T, ",bytes)");
        s[8] = string.concat("hashTerms(", T, ")");
        s[9] = string.concat("paymentInfoFor(", T, ")");
        s[10] = "stage(bytes32)";
        s[11] = string.concat("timeout(", T, ")");
    }

    function test_abi_isExactlyTheAllowlist() public view {
        string memory json = vm.readFile(ARTIFACT);
        string[] memory keys = vm.parseJsonKeys(json, ".methodIdentifiers");
        string[] memory allowed = _allowed();
        assertEq(keys.length, allowed.length, "unexpected number of external functions");
        for (uint256 i; i < keys.length; i++) {
            bool found;
            for (uint256 j; j < allowed.length; j++) {
                if (keccak256(bytes(keys[i])) == keccak256(bytes(allowed[j]))) found = true;
            }
            assertTrue(found, string.concat("selector not on the no-admin allowlist: ", keys[i]));
        }
    }

    function test_abi_hasNoFallbackOrReceive() public view {
        string memory json = vm.readFile(ARTIFACT);
        assertEq(vm.indexOf(json, '"type":"fallback"'), type(uint256).max);
        assertEq(vm.indexOf(json, '"type":"receive"'), type(uint256).max);
    }

    function test_commonAdminSelectors_allFail() public {
        string[14] memory sigs = [
            "owner()",
            "transferOwnership(address)",
            "renounceOwnership()",
            "pause()",
            "unpause()",
            "paused()",
            "upgradeTo(address)",
            "upgradeToAndCall(address,bytes)",
            "setFee(uint256)",
            "setEscrow(address)",
            "blacklist(address)",
            "freeze(bytes32)",
            "grantRole(bytes32,address)",
            "withdraw(address,uint256)"
        ];
        for (uint256 i; i < sigs.length; i++) {
            (bool ok,) = address(rules).call(abi.encodeWithSignature(sigs[i]));
            assertFalse(ok, sigs[i]);
        }
    }

    function test_rulesContractNeverHoldsFunds() public {
        // Custody stays in CPP's TokenStore; the rules contract has no balance to sweep, during or after a deal.
        HoldbackRules.Terms memory t = _terms(keccak256("c"));
        _fund(t);
        assertEq(usdc.balanceOf(address(rules)), 0);
        rules.decide(t, false, _decisionSig(t, false, ADJ_PK));
        assertEq(usdc.balanceOf(address(rules)), 0);
        assertEq(address(rules).balance, 0);
    }
}
