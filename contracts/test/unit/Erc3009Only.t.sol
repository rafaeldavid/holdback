// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {AuthCaptureEscrow} from "commerce-payments/AuthCaptureEscrow.sol";

import {HoldbackRules} from "../../src/HoldbackRules.sol";
import {HoldbackTypes as H} from "../../src/HoldbackTypes.sol";
import {Base} from "./Base.sol";

/// @title SC-2: funding by ERC-3009 only (T-356, ADR-0031 §3)
/// @notice The Permit2 path left: no `permit2Collector` constructor argument, no `PERMIT2_COLLECTOR`, no
///         `Funding.method`. Every hold is authorized through CPP's ERC-3009 collector. A Permit2 signature, valid for
///         the deal and with the buyer's Permit2 allowance in place (the input that funded before SC-2,
///         `test/differential/parent/`'s `method` 1), is now refused and moves nothing.
contract Erc3009OnlyTest is Base {
    function test_permit2Collector_isGone() public view {
        (bool ok, bytes memory ret) = address(rules).staticcall(abi.encodeWithSignature("PERMIT2_COLLECTOR()"));
        assertFalse(ok, "PERMIT2_COLLECTOR() is not in the phase-one ABI");
        assertEq(ret.length, 0);
        assertEq(rules.ERC3009_COLLECTOR(), address(collector3009));
    }

    /// The refused input: a Permit2 PermitTransferFrom signature for this deal's hold, the buyer having approved
    /// Permit2. The ERC-3009 collector cannot use it, so `agreeAndFund` reverts; nothing is stored and no token moves.
    function test_permit2Signature_refused() public {
        H.Terms memory t = _terms();
        vm.prank(buyer);
        usdc.approve(permit2, type(uint256).max);
        bytes32 id = hx.id(t);
        bytes memory ss = _sellerSig(t, SELLER_PK);
        H.Acceptance memory acc = _acceptance(t, ADJ_PK);
        H.Agree memory ag = _agree(t, BUYER_PK);
        H.Funding memory f = H.Funding({signature: _permit2(t, BUYER_PK)});
        uint256 before = usdc.balanceOf(buyer);

        vm.expectRevert();
        rules.agreeAndFund(t, ss, acc, ag, f);

        assertEq(uint8(rules.dealOf(id).stage), uint8(HoldbackRules.Stage.None), "nothing stored");
        assertEq(usdc.balanceOf(buyer), before, "no token moved");
        assertEq(_held(t), 0);
    }

    /// Every hold goes through the ERC-3009 collector: the escrow's `PaymentAuthorized` names it.
    function test_erc3009_isTheCollector() public {
        H.Terms memory t = _terms();
        vm.recordLogs();
        _fund(t);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 seen;
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].emitter != address(escrow) || logs[i].topics[0] != AuthCaptureEscrow.PaymentAuthorized.selector) {
                continue;
            }
            (, , address collector) = abi.decode(logs[i].data, (AuthCaptureEscrow.PaymentInfo, uint256, address));
            assertEq(collector, address(collector3009));
            seen++;
        }
        assertEq(seen, 1);
        assertEq(_held(t), PRICE + FEE);
    }
}
