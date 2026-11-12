// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {HoldbackRules} from "../../src/HoldbackRules.sol";
import {HoldbackTypes as H} from "../../src/HoldbackTypes.sol";
import {SignerBase, SwitchWallet} from "./ContractSigners.sol";

/// T-346 (ADR-0031 §5): a contract signer whose `isValidSignature` burns all the gas it is given. Solady's check makes
/// the ERC-1271 staticcall with all but 1/64 of the remaining gas (EIP-150), so the burn takes 63/64 of what is left
/// and the rules contract keeps enough to refuse the step with BadSignature. The refused call changes no state, and
/// the deal still ends by its timeouts. Each test logs the gas the failing call used at two gas limits (1,000,000 and
/// 30,000,000 gas); run with -vv to see the numbers.
contract Erc1271GasBurnTest is SignerBase {
    uint256 internal constant SMALL_LIMIT = 1_000_000;
    uint256 internal constant BLOCK_LIMIT = 30_000_000;

    /// Relays `data` to the rules contract with a gas limit and returns what the call used, as the caller sees it.
    function _relayWithGas(bytes memory data, uint256 limit)
        internal
        returns (bool ok, bytes memory ret, uint256 used)
    {
        uint256 g0 = gasleft();
        (ok, ret) = address(rules).call{gas: limit}(data);
        used = g0 - gasleft();
    }

    /// The burned call is refused with BadSignature, uses almost all of its gas limit, and leaves `before` unchanged.
    function _refusedAtBothLimits(H.Terms memory t, bytes32 id, bytes memory data, string memory what) internal {
        bytes32 before = _state(t, id, address(0));
        uint256[2] memory limits = [SMALL_LIMIT, BLOCK_LIMIT];
        for (uint256 i; i < limits.length; i++) {
            (bool ok, bytes memory ret, uint256 used) = _relayWithGas(data, limits[i]);
            assertFalse(ok, "the burned call fails");
            assertEq(ret, abi.encodeWithSelector(HoldbackRules.BadSignature.selector), "refused, not out of gas");
            assertGe(used, limits[i] * 62 / 64, "the wallet burned about 63/64 of the limit");
            assertLe(used, limits[i] + 10_000, "never more than the limit plus the call's own cost");
            assertEq(_state(t, id, address(0)), before, "no state changed");
            emit log_named_uint(string.concat(what, ", gas limit"), limits[i]);
            emit log_named_uint(string.concat(what, ", gas used"), used);
        }
    }

    /// The seller's wallet signs the terms honestly, then burns the gas of its delivery check. The delivery is refused
    /// with no state change; at deliverBy anyone reclaims and the buyer is whole.
    function test_sellerWalletBurnsGas_deliveryRefused_buyerReclaims() public {
        SwitchWallet w = _wallet(SW_PK);
        H.Terms memory t = _terms();
        t.seller = address(w);
        t.sellerPayoutAddress = address(w); // ADR-0033: the wallet also holds the money
        uint256 buyerStart = usdc.balanceOf(buyer);
        bytes32 id = _fundAs(t, BUYER_PK, SW_PK, ADJ_PK);
        (H.Delivery memory d,) = _deliveryFor(t.buyer);
        bytes memory data = abi.encodeCall(HoldbackRules.deliver, (t, d, _deliverySig(id, d, SW_PK)));

        w.setMode(BURN);
        _refusedAtBothLimits(t, id, data, "deliver");
        _is(id, HoldbackRules.Stage.Held);

        vm.warp(t.timing.deliverBy);
        rules.reclaim(t);
        _is(id, HoldbackRules.Stage.Refunded);
        assertEq(usdc.balanceOf(buyer), buyerStart, "the buyer is whole");
    }

    /// The primary's wallet accepts the case honestly, then burns the gas of its decision check. The decision is
    /// refused with no state change; at judgeBy the fallback takes over and its reject returns the price to the buyer.
    function test_primaryWalletBurnsGas_decisionRefused_fallbackDecides() public {
        SwitchWallet w = _wallet(AW_PK);
        H.Terms memory t = _terms();
        t.adjudicator = address(w);
        bytes32 id = _fundAs(t, BUYER_PK, SELLER_PK, AW_PK);
        _deliver(t, id);
        H.Decision memory m =
            _signDecision(t, id, _decision(H.ROLE_PRIMARY, H.OUTCOME_ACCEPT), address(w), AW_PK);
        bytes memory data = abi.encodeCall(HoldbackRules.decide, (t, m, _noDelivery(), bytes("")));

        w.setMode(BURN);
        _refusedAtBothLimits(t, id, data, "decide");
        _is(id, HoldbackRules.Stage.Delivered);

        vm.warp(t.timing.judgeBy);
        rules.triggerFallback(t);
        uint256 buyerBefore = usdc.balanceOf(buyer);
        rules.decide(t, _fallbackDecision(t, id, H.OUTCOME_REJECT, fallbackAdj, FB_PK), _noDelivery(), "");
        _is(id, HoldbackRules.Stage.Refunded);
        assertEq(usdc.balanceOf(buyer) - buyerBefore, PRICE);
        assertEq(usdc.balanceOf(fallbackAdj), FEE);
    }

    /// The buyer's wallet burns the gas of its early-accept check after a delivery. The accept is refused with no
    /// state change; the primary's decision, which needs no buyer signature, settles the deal.
    function test_buyerWalletBurnsGas_earlyAcceptRefused_primaryDecides() public {
        SwitchWallet w = _wallet(BW_PK);
        H.Terms memory t = _terms();
        t.buyer = address(w);
        t.buyerPaymentAddress = address(w); // ADR-0033: the wallet also holds the money
        bytes32 id = _fundAs(t, BW_PK, SELLER_PK, ADJ_PK);
        (H.Delivery memory d, H.KeyProof memory k) = _deliverAs(t, id, SELLER_PK);
        bytes memory data =
            abi.encodeCall(HoldbackRules.earlyAccept, (t, _earlyFor(t, id, d, BW_PK), d, bytes(""), k));

        w.setMode(BURN);
        _refusedAtBothLimits(t, id, data, "earlyAccept");
        _is(id, HoldbackRules.Stage.Delivered);

        uint256 sellerBefore = usdc.balanceOf(seller);
        rules.decide(t, _primary(t, id, H.OUTCOME_ACCEPT), _noDelivery(), "");
        _is(id, HoldbackRules.Stage.Released);
        assertEq(usdc.balanceOf(seller) - sellerBefore, PRICE);
    }

    /// The seller's wallet burns the gas of the terms check at funding. Nothing is funded and no money moves; after
    /// the offer expires anyone records the expiry.
    function test_sellerWalletBurnsGas_atFunding_nothingFunded_offerExpires() public {
        SwitchWallet w = _wallet(SW_PK);
        H.Terms memory t = _terms();
        t.seller = address(w);
        t.sellerPayoutAddress = address(w); // ADR-0033: the wallet also holds the money
        bytes32 id = hx.id(t);
        bytes memory data = abi.encodeCall(
            HoldbackRules.agreeAndFund,
            (t, _sellerSig(t, SW_PK), _acceptance(t, ADJ_PK), _agree(t, BUYER_PK), _erc3009(t, BUYER_PK))
        );

        w.setMode(BURN);
        _refusedAtBothLimits(t, id, data, "agreeAndFund");
        _is(id, HoldbackRules.Stage.None);

        // The offer lapses unfunded: nothing is recorded on chain (SC-6), and funding it is refused for its deadline
        // before the wallet is asked anything.
        vm.warp(t.timing.offerExpiresAt);
        (bool ok, bytes memory ret) = address(rules).call(data);
        assertFalse(ok);
        assertEq(ret, abi.encodeWithSelector(HoldbackRules.DeadlinePassed.selector));
        _is(id, HoldbackRules.Stage.None);
    }
}
