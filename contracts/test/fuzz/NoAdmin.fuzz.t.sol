// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {HoldbackTypes as H} from "../../src/HoldbackTypes.sol";
import {DrandQuicknetBeacon} from "../../src/DrandQuicknetBeacon.sol";
import {TestUSDC} from "../../script/TestUSDC.sol";
import {Base} from "../unit/Base.sol";

/// @title NoAdminFuzzTest
/// @notice T-203, hard rule "No admin keys" and the contract review checklist in docs/neutrality.md, over every
///         contract the settlement deploys: HoldbackRules, CPP AuthCaptureEscrow, both collectors, the TokenStore
///         implementation, the rules contract's TokenStore clone, (T-209) both beacons: the drand quicknet verifier
///         and the local-chain sim beacon, and (T-213) the Sepolia demo's test token, tUSDC. HoldbackBonds left with
///         the phase-one cut (T-346, ADR-0031 §8): the rules contract creates no vault.
///         - Each ABI is exactly a reviewed allowlist (a new external function is a visible diff here).
///         - No ABI has a forbidden admin function, a fallback or a receive.
///         - Fuzzed: any selector outside a contract's ABI reverts, with any calldata and any caller.
///         - No runtime bytecode has SELFDESTRUCT; only the TokenStore clone has DELEGATECALL, and it is the fixed
///           EIP-1167 minimal proxy to an implementation with no admin path (not an upgradeable proxy).
///         That the rules contract never holds funds is `invariant_noAdminPath` in RulesInvariants.t.sol.
contract NoAdminFuzzTest is Base {
    string internal constant PI =
        "(address,address,address,address,uint120,uint48,uint48,uint48,uint16,uint16,address,uint256)";

    address[9] internal targets;
    string[9] internal artifacts;
    uint256 internal constant CLONE = 5;
    mapping(address => mapping(bytes4 => bool)) internal inAbi;

    function setUp() public override {
        super.setUp();
        // CPP deploys the rules contract's TokenStore clone at the first payout.
        (H.Terms memory t, bytes32 id) = _funded();
        _deliver(t, id);
        rules.decide(t, _primary(t, id, H.OUTCOME_ACCEPT), _noDelivery(), "");
        address store = escrow.getTokenStore(address(rules));
        require(store.code.length > 0, "TokenStore clone not deployed");
        targets = [
            address(rules),
            address(escrow),
            address(collector3009),
            address(collectorPermit2), // no longer deployed by the settlement (SC-2); the test world still has it
            escrow.tokenStoreImplementation(),
            store,
            address(new DrandQuicknetBeacon()),
            address(sim),
            address(new TestUSDC())
        ];
        artifacts = [
            "out/HoldbackRules.sol/HoldbackRules.json",
            "out/AuthCaptureEscrow.sol/AuthCaptureEscrow.json",
            "out/ERC3009PaymentCollector.sol/ERC3009PaymentCollector.json",
            "out/Permit2PaymentCollector.sol/Permit2PaymentCollector.json",
            "out/TokenStore.sol/TokenStore.json",
            "out/TokenStore.sol/TokenStore.json", // the clone answers with the implementation's ABI
            "out/DrandQuicknetBeacon.sol/DrandQuicknetBeacon.json",
            "out/SimBeacon.sol/SimBeacon.json",
            "out/TestUSDC.sol/TestUSDC.json"
        ];
        for (uint256 i; i < targets.length; i++) {
            string[] memory sigs = vm.parseJsonKeys(vm.readFile(artifacts[i]), ".methodIdentifiers");
            for (uint256 k; k < sigs.length; k++) {
                inAbi[targets[i]][bytes4(keccak256(bytes(sigs[k])))] = true;
            }
        }
    }

    // ------------------------------------------------------------ reviewed allowlists (full signatures)

    function _allowlist(uint256 i) internal pure returns (string[] memory s) {
        if (i == 0) {
            // T-346 (ADR-0031 §8): BONDS(), KEY_APPEAL(), expireAppeal( and fileAppeal( left with the phase-one cut.
            // T-356 (ADR-0031 §2, SC-1): TOKEN(), the deployment's one token, an immutable set at deploy.
            // T-356 (ADR-0031 §3, SC-2): PERMIT2_COLLECTOR() left with the Permit2 path; TOKEN() takes its index.
            s = new string[](22);
            s[0] = "BEACON()";
            s[1] = "ERC3009_COLLECTOR()";
            s[2] = "ESCROW()";
            s[3] = "EXPIRY_MARGIN()";
            s[4] = "KEY_DECISION()";
            s[5] = "KEY_EARLY_ACCEPT()";
            s[6] = "KEY_MUTUAL()";
            s[7] = "MUTUAL_FEE_SHARE_BPS()";
            s[8] = "TOKEN()";
            s[9] = "agreeAndFund(";
            s[10] = "dealOf(bytes32)";
            s[11] = "decide(";
            s[12] = "deliver(";
            s[13] = "earlyAccept(";
            s[14] = "eip712Domain()";
            s[15] = "expireOffer(";
            s[16] = "mutualSettle(";
            s[17] = "reclaim(";
            s[18] = "triggerDefault(";
            s[19] = "triggerFallback(";
            s[20] = "typedDataHash(bytes32)";
            s[21] = "deliveryHashOf(bytes32)"; // a read: the posted delivery every signature names (ADR-0029)
        } else if (i == 1) {
            s = new string[](11);
            s[0] = "PAYMENT_INFO_TYPEHASH()";
            s[1] = string.concat("authorize(", PI, ",uint256,address,bytes)");
            s[2] = string.concat("capture(", PI, ",uint256,uint256,address)");
            s[3] = string.concat("charge(", PI, ",uint256,address,bytes,uint256,address)");
            s[4] = string.concat("getHash(", PI, ")");
            s[5] = "getTokenStore(address)";
            s[6] = "paymentState(bytes32)";
            s[7] = string.concat("reclaim(", PI, ")");
            s[8] = string.concat("refund(", PI, ",uint256,address,bytes)");
            s[9] = "tokenStoreImplementation()";
            s[10] = string.concat("void(", PI, ")");
        } else if (i == 2 || i == 3) {
            s = new string[](i == 2 ? 4 : 5);
            s[0] = "authCaptureEscrow()";
            s[1] = string.concat("collectTokens(", PI, ",address,uint256,bytes)");
            s[2] = "collectorType()";
            s[3] = "multicall3()";
            if (i == 3) s[4] = "permit2()";
        } else if (i == 4 || i == 5) {
            s = new string[](2);
            s[0] = "authCaptureEscrow()";
            s[1] = "sendTokens(address,address,uint256)";
        } else if (i == 6) {
            s = new string[](5);
            s[0] = "GENESIS()";
            s[1] = "PERIOD()";
            s[2] = "beaconValue(uint64,bytes)";
            s[3] = "hashToG1(bytes32)";
            s[4] = "roundAt(uint256)";
        } else if (i == 7) {
            s = new string[](3);
            s[0] = "SIM_SEED()";
            s[1] = "beaconValue(uint64,bytes)";
            s[2] = "roundAt(uint256)";
        } else {
            // tUSDC: an ERC-20 with permit, open mint and USDC's ERC-3009 pair; nothing else.
            s = new string[](18);
            s[0] = "DOMAIN_SEPARATOR()";
            s[1] = "RECEIVE_WITH_AUTHORIZATION_TYPEHASH()";
            s[2] = "TRANSFER_WITH_AUTHORIZATION_TYPEHASH()";
            s[3] = "allowance(address,address)";
            s[4] = "approve(address,uint256)";
            s[5] = "authorizationState(address,bytes32)";
            s[6] = "balanceOf(address)";
            s[7] = "decimals()";
            s[8] = "mint(address,uint256)";
            s[9] = "name()";
            s[10] = "nonces(address)";
            s[11] = "permit(address,address,uint256,uint256,uint8,bytes32,bytes32)";
            s[12] = "receiveWithAuthorization(address,address,uint256,uint256,uint256,bytes32,bytes)";
            s[13] = "symbol()";
            s[14] = "totalSupply()";
            s[15] = "transfer(address,uint256)";
            s[16] = "transferFrom(address,address,uint256)";
            s[17] = "transferWithAuthorization(address,address,uint256,uint256,uint256,bytes32,bytes)";
        }
    }

    /// An allowlist entry ending in "(" matches any parameter list (the Holdback struct tuples are long).
    function _allowed(string memory sig, string[] memory list) internal pure returns (bool) {
        for (uint256 i; i < list.length; i++) {
            bytes memory p = bytes(list[i]);
            bytes memory s = bytes(sig);
            if (p[p.length - 1] == "(") {
                if (s.length < p.length) continue;
                bool eq = true;
                for (uint256 k; k < p.length && eq; k++) {
                    eq = s[k] == p[k];
                }
                if (eq) return true;
            } else if (keccak256(p) == keccak256(s)) {
                return true;
            }
        }
        return false;
    }

    function test_everyAbi_isItsReviewedAllowlist() public view {
        for (uint256 i; i < targets.length; i++) {
            if (i == CLONE) continue;
            string memory json = vm.readFile(artifacts[i]);
            string[] memory sigs = vm.parseJsonKeys(json, ".methodIdentifiers");
            string[] memory list = _allowlist(i);
            assertEq(sigs.length, list.length, string.concat("ABI size changed: ", artifacts[i]));
            for (uint256 k; k < sigs.length; k++) {
                assertTrue(_allowed(sigs[k], list), string.concat("not on the reviewed allowlist: ", sigs[k]));
            }
            assertEq(vm.indexOf(json, '"type":"fallback"'), type(uint256).max, "fallback");
            assertEq(vm.indexOf(json, '"type":"receive"'), type(uint256).max, "receive");
        }
    }

    // ------------------------------------------------------------ forbidden functions

    function _forbidden() internal pure returns (string[24] memory) {
        return [
            "owner()",
            "transferOwnership(address)",
            "renounceOwnership()",
            "acceptOwnership()",
            "pause()",
            "unpause()",
            "paused()",
            "upgradeTo(address)",
            "upgradeToAndCall(address,bytes)",
            "implementation()",
            "proxiableUUID()",
            "changeAdmin(address)",
            "admin()",
            "blacklist(address)",
            "unBlacklist(address)",
            "freeze(bytes32)",
            "freeze(address)",
            "grantRole(bytes32,address)",
            "revokeRole(bytes32,address)",
            "setEscrow(address)",
            "setRules(address)",
            "sweep(address,uint256)",
            "rescueTokens(address,address,uint256)",
            "kill()"
        ];
    }

    function test_forbiddenSelectors_absentEverywhere_andCallsFail() public {
        string[24] memory f = _forbidden();
        for (uint256 i; i < targets.length; i++) {
            for (uint256 k; k < f.length; k++) {
                bytes4 sel = bytes4(keccak256(bytes(f[k])));
                assertFalse(inAbi[targets[i]][sel], f[k]);
                (bool ok,) = targets[i].call(abi.encodeWithSelector(sel, address(this), uint256(1)));
                assertFalse(ok, f[k]);
            }
        }
    }

    /// Any selector outside a contract's ABI reverts, whoever calls and whatever follows it.
    function testFuzz_unknownSelector_reverts(bytes4 sel, bytes calldata rest, uint8 which, address caller) public {
        address target = targets[which % targets.length];
        vm.assume(!inAbi[target][sel]);
        vm.prank(caller);
        (bool ok,) = target.call(bytes.concat(sel, rest));
        assertFalse(ok);
    }

    /// Plain ether transfers are refused (no receive, no fallback).
    function testFuzz_etherRefused(uint8 which, uint96 amount) public {
        vm.assume(amount > 0);
        address target = targets[which % targets.length];
        vm.deal(address(this), amount);
        (bool ok,) = target.call{value: amount}("");
        assertFalse(ok);
    }

    // ------------------------------------------------------------ forbidden opcodes

    /// keccak256("Transfer(address,address,uint256)"). via-IR stores this constant of Solady's ERC20 as a data
    /// section after the final INVALID of tUSDC's code and loads it with CODECOPY: data, not opcodes.
    bytes32 internal constant TRANSFER_TOPIC = 0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef;

    /// Walks the runtime bytecode opcode by opcode, skipping PUSH data, the CBOR metadata trailer when present, and
    /// a trailing data section that is exactly the Transfer topic after an INVALID.
    function _opcodes(address target, bool allowDelegatecall) internal view {
        bytes memory code = target.code;
        uint256 end = code.length;
        if (end > 2) {
            uint256 metaLen = (uint256(uint8(code[end - 2])) << 8) | uint8(code[end - 1]);
            if (metaLen + 2 <= end && metaLen > 0 && uint8(code[end - metaLen - 2]) == 0xa2) end -= metaLen + 2;
        }
        if (end > 33 && uint8(code[end - 33]) == 0xfe) {
            bytes32 tail;
            assembly {
                tail := mload(add(add(code, 0x20), sub(end, 32)))
            }
            if (tail == TRANSFER_TOPIC) end -= 32;
        }
        for (uint256 i; i < end; i++) {
            uint8 op = uint8(code[i]);
            assertTrue(op != 0xff, "SELFDESTRUCT in runtime bytecode");
            assertTrue(op != 0xf2, "CALLCODE in runtime bytecode");
            if (!allowDelegatecall) assertTrue(op != 0xf4, "DELEGATECALL in runtime bytecode");
            if (op >= 0x60 && op <= 0x7f) i += op - 0x5f;
        }
    }

    function test_bytecode_noSelfdestruct_delegatecallOnlyInTheFixedClone() public view {
        for (uint256 i; i < targets.length; i++) {
            if (i != CLONE) _opcodes(targets[i], false);
        }
        address impl = escrow.tokenStoreImplementation();
        // Solady LibClone.cloneDeterministic: its 44-byte minimal proxy (an EIP-1167 variant) with the
        // implementation address fixed in the code; nothing can change where it delegates.
        bytes memory proxy = abi.encodePacked(hex"3d3d3d3d363d3d37363d73", impl, hex"5af43d3d93803e602a57fd5bf3");
        assertEq(targets[CLONE].code, proxy, "TokenStore clone is not the fixed minimal proxy");
        _opcodes(targets[CLONE], true);
    }
}
