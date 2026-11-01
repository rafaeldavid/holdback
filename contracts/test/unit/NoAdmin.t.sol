// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Base} from "./Base.sol";

/// Hard rule "No admin keys". For HoldbackRules and HoldbackBonds:
/// - the ABI is exactly the function-name allowlist below (a new public function is a visible diff here);
/// - no admin, pause, upgrade, blacklist or freeze function exists, and calls to those selectors fail;
/// - there is no fallback or receive;
/// - the runtime bytecode has no SELFDESTRUCT and no DELEGATECALL at all.
contract NoAdminTest is Base {
    function _rulesAllowed() internal pure returns (string[] memory s) {
        s = new string[](27);
        (s[0], s[1], s[2], s[3], s[4]) = ("BEACON_GENESIS", "BEACON_PERIOD", "BONDS", "ERC3009_COLLECTOR", "ESCROW");
        (s[5], s[6], s[7], s[8], s[9]) = ("EXPIRY_MARGIN", "KEY_APPEAL", "KEY_DECISION", "KEY_EARLY_ACCEPT", "KEY_MUTUAL");
        (s[10], s[11], s[12], s[13]) = ("MUTUAL_FEE_SHARE_BPS", "PERMIT2_COLLECTOR", "agreeAndFund", "beaconRoundAt");
        (s[14], s[15], s[16], s[17]) = ("dealOf", "decide", "deliver", "earlyAccept");
        (s[18], s[19], s[20], s[21]) = ("eip712Domain", "expireAppeal", "expireOffer", "fileAppeal");
        (s[22], s[23], s[24], s[25], s[26]) =
            ("mutualSettle", "reclaim", "triggerDefault", "triggerFallback", "typedDataHash");
    }

    function _bondsAllowed() internal pure returns (string[] memory s) {
        s = new string[](12);
        (s[0], s[1], s[2], s[3]) = ("RULES", "appealBondOf", "bondOf", "deposit");
        (s[4], s[5], s[6], s[7]) = ("encumber", "encumberedOf", "freeOf", "payAppealBond");
        (s[8], s[9], s[10], s[11]) = ("release", "takeAppealBond", "tryEncumber", "withdraw");
    }

    function _name(string memory sig) internal pure returns (string memory) {
        bytes memory b = bytes(sig);
        uint256 n;
        while (n < b.length && b[n] != "(") n++;
        bytes memory out = new bytes(n);
        for (uint256 i; i < n; i++) out[i] = b[i];
        return string(out);
    }

    function _in(string memory x, string[] memory list) internal pure returns (bool) {
        for (uint256 i; i < list.length; i++) {
            if (keccak256(bytes(x)) == keccak256(bytes(list[i]))) return true;
        }
        return false;
    }

    function _checkAbi(string memory artifact, string[] memory allowed) internal view {
        string memory json = vm.readFile(artifact);
        string[] memory keys = vm.parseJsonKeys(json, ".methodIdentifiers");
        assertEq(keys.length, allowed.length, string.concat("unexpected number of external functions in ", artifact));
        for (uint256 i; i < keys.length; i++) {
            assertTrue(_in(_name(keys[i]), allowed), string.concat("not on the no-admin allowlist: ", keys[i]));
        }
        assertEq(vm.indexOf(json, '"type":"fallback"'), type(uint256).max);
        assertEq(vm.indexOf(json, '"type":"receive"'), type(uint256).max);
    }

    function test_rules_abiIsTheAllowlist() public view {
        _checkAbi("out/HoldbackRules.sol/HoldbackRules.json", _rulesAllowed());
    }

    function test_bonds_abiIsTheAllowlist() public view {
        _checkAbi("out/HoldbackBonds.sol/HoldbackBonds.json", _bondsAllowed());
    }

    function test_adminSelectors_absentAndFail() public {
        string[16] memory sigs = [
            "owner()",
            "transferOwnership(address)",
            "renounceOwnership()",
            "pause()",
            "unpause()",
            "paused()",
            "upgradeTo(address)",
            "upgradeToAndCall(address,bytes)",
            "blacklist(address)",
            "unBlacklist(address)",
            "freeze(bytes32)",
            "freeze(address)",
            "grantRole(bytes32,address)",
            "setEscrow(address)",
            "setRules(address)",
            "sweep(address,uint256)"
        ];
        address[2] memory targets = [address(rules), address(bonds)];
        for (uint256 j; j < 2; j++) {
            for (uint256 i; i < sigs.length; i++) {
                (bool ok,) = targets[j].call(abi.encodeWithSignature(sigs[i]));
                assertFalse(ok, sigs[i]);
            }
        }
    }

    /// Walks the runtime bytecode opcode by opcode (skipping PUSH data and the CBOR metadata trailer).
    function _assertNoSelfdestructOrDelegatecall(address target) internal view {
        bytes memory code = target.code;
        uint256 metaLen = (uint256(uint8(code[code.length - 2])) << 8) | uint8(code[code.length - 1]);
        uint256 end = code.length - metaLen - 2;
        for (uint256 i; i < end; i++) {
            uint8 op = uint8(code[i]);
            assertTrue(op != 0xff, "SELFDESTRUCT in runtime bytecode");
            assertTrue(op != 0xf4, "DELEGATECALL in runtime bytecode");
            if (op >= 0x60 && op <= 0x7f) i += op - 0x5f;
        }
    }

    function test_bytecode_noSelfdestructNoDelegatecall() public view {
        _assertNoSelfdestructOrDelegatecall(address(rules));
        _assertNoSelfdestructOrDelegatecall(address(bonds));
    }

    function test_rulesContractNeverHoldsFunds() public {
        _funded();
        assertEq(usdc.balanceOf(address(rules)), 0);
        assertEq(address(rules).balance, 0);
    }
}
