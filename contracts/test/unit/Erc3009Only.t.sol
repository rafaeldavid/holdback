// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {AuthCaptureEscrow} from "commerce-payments/AuthCaptureEscrow.sol";

import {HoldbackRules} from "../../src/HoldbackRules.sol";
import {HoldbackTypes as H} from "../../src/HoldbackTypes.sol";
import {TestUSDC} from "../../script/TestUSDC.sol";
import {OwnedWallet} from "../crosscheck/Erc1271Replay.t.sol";
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

        // The ERC-3009 collector hands the bytes to the token's receiveWithAuthorization, which finds no ERC-3009
        // signature in them.
        vm.expectRevert(bytes("MockERC3009: invalid signature"));
        rules.agreeAndFund(t, ss, acc, ag, f);

        assertEq(uint8(rules.dealOf(id).stage), uint8(HoldbackRules.Stage.None), "nothing stored");
        assertEq(usdc.balanceOf(buyer), before, "no token moved");
        assertEq(_held(t), 0);
    }

    /// With Permit2 gone, a multisig or any contract-wallet buyer funds only through the token's ERC-3009. On the
    /// demo's own token (TestUSDC, the token `deploy-sepolia.sh` deploys, not CPP's mock) the token checks the
    /// wallet's ERC-1271 answer, the hold funds, and the timeout returns it in full (ADR-0031 §3, §5).
    function test_contractWalletBuyer_fundsOnTestUSDC() public {
        TestUSDC tusdc = new TestUSDC();
        rules = new HoldbackRules(escrow, address(collector3009), MARGIN, sim, address(tusdc));
        uint256 ownerPk = 0x0111E4;
        OwnedWallet w = new OwnedWallet(vm.addr(ownerPk));
        tusdc.mint(address(w), 1_000_000_000);
        H.Terms memory t = _terms();
        t.token = address(tusdc);
        t.buyer = address(w);
        t.buyerPaymentAddress = address(w); // ADR-0033: the wallet also holds the money
        bytes memory ss = _sellerSig(t, SELLER_PK);
        H.Acceptance memory acc = _acceptance(t, ADJ_PK);
        H.Agree memory ag = _agree(t, ownerPk);
        H.Funding memory f = _erc3009(t, ownerPk);

        vm.prank(relayer);
        bytes32 id = rules.agreeAndFund(t, ss, acc, ag, f);
        assertEq(uint8(rules.dealOf(id).stage), uint8(HoldbackRules.Stage.Held));
        assertEq(tusdc.balanceOf(escrow.getTokenStore(address(rules))), PRICE + FEE);
        assertEq(tusdc.balanceOf(address(w)), 1_000_000_000 - PRICE - FEE);

        vm.warp(t.timing.deliverBy);
        rules.reclaim(t);
        assertEq(tusdc.balanceOf(address(w)), 1_000_000_000, "the wallet got its hold back");
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
