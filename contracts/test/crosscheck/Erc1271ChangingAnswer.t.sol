// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {HoldbackRules} from "../../src/HoldbackRules.sol";
import {HoldbackTypes as H} from "../../src/HoldbackTypes.sol";
import {SignerBase, SwitchWallet} from "./ContractSigners.sol";

/// T-346 (ADR-0031 §5, red-team M-4): a contract signer's answer can change between two steps of one deal, because
/// each step checks its own signature when it is relayed. These tests show that a changed answer blocks only that
/// wallet's own next step: the other parties' steps still land, and the deal still ends by the timeouts its terms
/// name (a reclaim, the fallback, or the default), with the money where the terms say.
contract Erc1271ChangingAnswerTest is SignerBase {
    // ------------------------------------------------------------ the seller

    /// The seller's wallet approves the terms at funding, then refuses its delivery signature. The delivery is refused
    /// whether posted alone or carried by an early accept or a decision; nothing else is blocked, and at deliverBy
    /// anyone reclaims: the buyer gets price and fee back, the seller's wallet gets nothing.
    function test_sellerWallet_approvesTermsThenRefusesDelivery_buyerReclaims() public {
        SwitchWallet w = _wallet(SW_PK);
        H.Terms memory t = _terms();
        t.seller = address(w);
        t.sellerPayoutAddress = address(w); // ADR-0033: the wallet also holds the money
        uint256 buyerStart = usdc.balanceOf(buyer);
        uint256 walletStart = usdc.balanceOf(address(w));
        bytes32 id = _fundAs(t, BUYER_PK, SW_PK, ADJ_PK);
        _is(id, HoldbackRules.Stage.Held);

        w.setMode(WRONG_MAGIC);
        (H.Delivery memory d, H.KeyProof memory k) = _deliveryFor(t.buyer);
        bytes memory sig = _deliverySig(id, d, SW_PK);
        vm.expectRevert(HoldbackRules.BadSignature.selector);
        rules.deliver(t, d, sig);
        H.EarlyAccept memory early = _earlyFor(t, id, d, BUYER_PK);
        vm.expectRevert(HoldbackRules.BadSignature.selector);
        rules.earlyAccept(t, early, d, sig, k);
        H.Decision memory m = _primary(t, id, H.OUTCOME_ACCEPT);
        m.deliveryHash = hx.delivery(id, d);
        m = _signDecision(t, id, m, adjudicator, ADJ_PK);
        vm.expectRevert(HoldbackRules.BadSignature.selector);
        rules.decide(t, m, d, sig);
        _is(id, HoldbackRules.Stage.Held);

        vm.expectRevert(HoldbackRules.TooEarly.selector);
        rules.reclaim(t);
        vm.warp(t.timing.deliverBy);
        rules.reclaim(t);
        _is(id, HoldbackRules.Stage.Refunded);
        assertEq(usdc.balanceOf(buyer), buyerStart, "the buyer is whole");
        assertEq(usdc.balanceOf(address(w)), walletStart, "the seller's wallet gets nothing");
        assertEq(_held(t), 0);
    }

    /// The seller's wallet delivers honestly, then turns off. Only its own half of a settlement is blocked: the
    /// primary's accept needs no seller signature, lands, and pays the wallet the price.
    function test_sellerWallet_turnsOffAfterDelivery_decisionStillPaysIt() public {
        SwitchWallet w = _wallet(SW_PK);
        H.Terms memory t = _terms();
        t.seller = address(w);
        t.sellerPayoutAddress = address(w); // ADR-0033: the wallet also holds the money
        bytes32 id = _fundAs(t, BUYER_PK, SW_PK, ADJ_PK);
        (H.Delivery memory d, H.KeyProof memory k) = _deliverAs(t, id, SW_PK);
        H.Mutual memory mu = _mutualFor(t, id, BUYER_PK, SW_PK, 10_000_000);

        w.setMode(REVERTS);
        vm.expectRevert(HoldbackRules.BadSignature.selector);
        rules.mutualSettle(t, mu, d, k);

        uint256 walletBefore = usdc.balanceOf(address(w));
        rules.decide(t, _primary(t, id, H.OUTCOME_ACCEPT), _noDelivery(), "");
        _is(id, HoldbackRules.Stage.Released);
        assertEq(usdc.balanceOf(address(w)) - walletBefore, PRICE, "being paid needs no signature");
        assertEq(usdc.balanceOf(adjudicator), FEE);
    }

    /// M-4's one-sided option, pinned: a seller's wallet can turn its half of a co-signed settlement off and on. The
    /// same signed settlement is refused while the wallet is off and lands once it is on again. It moves money only
    /// as both parties signed, and the turned-off wallet blocks nothing but the settlement.
    function test_sellerWallet_offThenOn_sameSettlementLands() public {
        SwitchWallet w = _wallet(SW_PK);
        H.Terms memory t = _terms();
        t.seller = address(w);
        t.sellerPayoutAddress = address(w); // ADR-0033: the wallet also holds the money
        bytes32 id = _fundAs(t, BUYER_PK, SW_PK, ADJ_PK);
        (H.Delivery memory d, H.KeyProof memory k) = _deliverAs(t, id, SW_PK);
        H.Mutual memory mu = _mutualFor(t, id, BUYER_PK, SW_PK, 10_000_000);

        w.setMode(EMPTY);
        vm.expectRevert(HoldbackRules.BadSignature.selector);
        rules.mutualSettle(t, mu, d, k);
        _is(id, HoldbackRules.Stage.Delivered);
        w.setMode(HONEST);
        uint256 walletBefore = usdc.balanceOf(address(w));
        rules.mutualSettle(t, mu, d, k);
        _is(id, HoldbackRules.Stage.Settled);
        assertEq(usdc.balanceOf(address(w)) - walletBefore, 10_000_000);
    }

    // ------------------------------------------------------------ the buyer

    /// The buyer's wallet agrees and funds, then turns off. Its early accept is refused; the primary's decision does
    /// not need it and settles the deal.
    function test_buyerWallet_turnsOffAfterFunding_decisionStillSettles() public {
        SwitchWallet w = _wallet(BW_PK);
        H.Terms memory t = _terms();
        t.buyer = address(w);
        t.buyerPaymentAddress = address(w); // ADR-0033: the wallet also holds the money
        bytes32 id = _fundAs(t, BW_PK, SELLER_PK, ADJ_PK);
        (H.Delivery memory d, H.KeyProof memory k) = _deliverAs(t, id, SELLER_PK);

        H.EarlyAccept memory early = _earlyFor(t, id, d, BW_PK);
        w.setMode(WRONG_MAGIC);
        vm.expectRevert(HoldbackRules.BadSignature.selector);
        rules.earlyAccept(t, early, d, "", k);

        uint256 walletBefore = usdc.balanceOf(address(w));
        rules.decide(t, _primary(t, id, H.OUTCOME_REJECT), _noDelivery(), "");
        _is(id, HoldbackRules.Stage.Refunded);
        assertEq(usdc.balanceOf(address(w)) - walletBefore, PRICE, "the price returns to the wallet");
        assertEq(usdc.balanceOf(adjudicator), FEE);
    }

    // ------------------------------------------------------------ the adjudicators

    /// The primary's wallet accepts the case at funding, then turns off. Its decision is refused; at judgeBy anyone
    /// hands the case to the fallback, whose accept pays the seller the price and the fallback the fee. The primary's
    /// wallet gets nothing.
    function test_primaryWallet_turnsOffAfterAccepting_fallbackTakesOver() public {
        SwitchWallet w = _wallet(AW_PK);
        H.Terms memory t = _terms();
        t.adjudicator = address(w);
        bytes32 id = _fundAs(t, BUYER_PK, SELLER_PK, AW_PK);
        _deliver(t, id);
        H.Decision memory m =
            _signDecision(t, id, _decision(H.ROLE_PRIMARY, H.OUTCOME_ACCEPT), address(w), AW_PK);

        w.setMode(WRONG_MAGIC);
        vm.expectRevert(HoldbackRules.BadSignature.selector);
        rules.decide(t, m, _noDelivery(), "");
        vm.expectRevert(HoldbackRules.TooEarly.selector);
        rules.triggerFallback(t);

        vm.warp(t.timing.judgeBy);
        rules.triggerFallback(t);
        _is(id, HoldbackRules.Stage.FallbackJudging);
        uint256 walletBefore = usdc.balanceOf(address(w));
        uint256 sellerBefore = usdc.balanceOf(seller);
        rules.decide(t, _fallbackDecision(t, id, H.OUTCOME_ACCEPT, fallbackAdj, FB_PK), _noDelivery(), "");
        _is(id, HoldbackRules.Stage.Released);
        assertEq(usdc.balanceOf(seller) - sellerBefore, PRICE);
        assertEq(usdc.balanceOf(fallbackAdj), FEE, "the fallback is paid the fee");
        assertEq(usdc.balanceOf(address(w)), walletBefore, "the silent primary gets nothing");
    }

    /// The primary's and the fallback's wallets both turn off. Neither decision lands; at fallbackBy anyone triggers
    /// the default, which returns price and fee to the buyer.
    function test_primaryAndFallbackWalletsTurnOff_defaultRefundsTheBuyer() public {
        SwitchWallet pw = _wallet(AW_PK);
        SwitchWallet fw = _wallet(FW_PK);
        H.Terms memory t = _terms();
        t.adjudicator = address(pw);
        t.fallbackAdjudicator = address(fw);
        uint256 buyerStart = usdc.balanceOf(buyer);
        bytes32 id = _fundAs(t, BUYER_PK, SELLER_PK, AW_PK);
        _deliver(t, id);

        H.Decision memory pm =
            _signDecision(t, id, _decision(H.ROLE_PRIMARY, H.OUTCOME_ACCEPT), address(pw), AW_PK);
        pw.setMode(REVERTS);
        vm.expectRevert(HoldbackRules.BadSignature.selector);
        rules.decide(t, pm, _noDelivery(), "");
        vm.warp(t.timing.judgeBy);
        rules.triggerFallback(t);
        fw.setMode(EMPTY);
        H.Decision memory fm = _fallbackDecision(t, id, H.OUTCOME_ACCEPT, address(fw), FW_PK);
        vm.expectRevert(HoldbackRules.BadSignature.selector);
        rules.decide(t, fm, _noDelivery(), "");

        vm.expectRevert(HoldbackRules.TooEarly.selector);
        rules.triggerDefault(t);
        vm.warp(t.timing.fallbackBy);
        rules.triggerDefault(t);
        _is(id, HoldbackRules.Stage.Refunded);
        assertEq(usdc.balanceOf(buyer), buyerStart, "the buyer is whole");
        assertEq(_held(t), 0);
    }

    /// The appeal adjudicator's wallet turns off after the primary escalates. Its decision is refused; once
    /// appealDecideSec has passed since the escalation, anyone triggers the default, which returns price and fee to
    /// the buyer.
    function test_appealWalletTurnsOff_escalationDefaultsToRefund() public {
        SwitchWallet w = _wallet(AW_PK);
        H.Terms memory t = _terms();
        t.appealAdjudicator = address(w);
        uint256 buyerStart = usdc.balanceOf(buyer);
        bytes32 id = _fund(t);
        _deliver(t, id);
        rules.decide(t, _primary(t, id, H.OUTCOME_ESCALATE), _noDelivery(), "");
        uint64 at = uint64(block.timestamp);
        vm.warp(at + 1);
        H.Decision memory m = _appealDecision(t, id, H.OUTCOME_ACCEPT, at, address(w), AW_PK);

        w.setMode(WRONG_MAGIC);
        vm.expectRevert(HoldbackRules.BadSignature.selector);
        rules.decide(t, m, _noDelivery(), "");
        vm.expectRevert(HoldbackRules.TooEarly.selector);
        rules.triggerDefault(t);
        vm.warp(at + t.timing.appealDecideSec);
        rules.triggerDefault(t);
        _is(id, HoldbackRules.Stage.Refunded);
        assertEq(usdc.balanceOf(buyer), buyerStart);
        assertEq(usdc.balanceOf(address(w)), 1_000_000_000, "the silent appeal adjudicator gets nothing");
    }
}
