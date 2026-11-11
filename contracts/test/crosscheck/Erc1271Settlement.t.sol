// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Vm} from "forge-std/Vm.sol";

import {HoldbackRules} from "../../src/HoldbackRules.sol";
import {HoldbackTypes as H} from "../../src/HoldbackTypes.sol";
import {SignerBase, SwitchWallet} from "./ContractSigners.sol";

/// T-346 (ADR-0031 §5, SC-4 kept): the signing steps a contract wallet takes that Erc1271Roles.t.sol,
/// Erc1271Replay.t.sol and Erc6492Prepare.t.sol leave out. The buyer as a wallet signs its early accept and its half
/// of a settlement; the seller as a wallet signs its half of a settlement; the appeal adjudicator as a wallet decides
/// an escalated case. Each step goes through with an honest wallet and is refused with BadSignature, leaving the deal
/// where it was, when the wallet answers wrong (a wrong magic value, a revert, an empty return) or when the signature
/// comes from a key the wallet does not accept.
contract Erc1271SettlementTest is SignerBase {
    // ------------------------------------------------------------ the buyer: early accept

    /// The buyer as a wallet early-accepts a posted delivery through ERC-1271. Every wrong answer and another key's
    /// signature is refused with BadSignature and leaves the deal Delivered; the honest answer pays the seller the
    /// price and returns the fee to the wallet.
    function test_buyerWallet_earlyAcceptsPostedDelivery() public {
        SwitchWallet w = _wallet(BW_PK);
        H.Terms memory t = _terms();
        t.buyer = address(w);
        bytes32 id = _fundAs(t, BW_PK, SELLER_PK, ADJ_PK);
        (H.Delivery memory d, H.KeyProof memory k) = _deliverAs(t, id, SELLER_PK);
        H.EarlyAccept memory m = _earlyFor(t, id, d, BW_PK);

        uint8[3] memory modes = _wrongModes();
        for (uint256 i; i < modes.length; i++) {
            w.setMode(modes[i]);
            vm.expectRevert(HoldbackRules.BadSignature.selector);
            rules.earlyAccept(t, m, d, "", k);
        }
        w.setMode(HONEST);
        H.EarlyAccept memory forged = _earlyFor(t, id, d, OTHER_PK);
        vm.expectRevert(HoldbackRules.BadSignature.selector);
        rules.earlyAccept(t, forged, d, "", k);
        _is(id, HoldbackRules.Stage.Delivered);

        uint256 walletBefore = usdc.balanceOf(address(w));
        uint256 sellerBefore = usdc.balanceOf(seller);
        vm.recordLogs();
        rules.earlyAccept(t, m, d, "", k);
        _assertLogged(HoldbackRules.KeyReleased.selector, id, address(w), "the key is released to the wallet");
        _is(id, HoldbackRules.Stage.Released);
        assertEq(usdc.balanceOf(seller) - sellerBefore, PRICE, "the seller is paid the price");
        assertEq(usdc.balanceOf(address(w)) - walletBefore, FEE, "the wallet gets the fee back");
        assertEq(_held(t), 0);
    }

    /// The buyer as a wallet early-accepts in Held, the accept carrying the seller-signed delivery. A wrong answer
    /// from the buyer's wallet is refused with BadSignature and lands no delivery; the honest answer lands the
    /// delivery and releases the price in one call.
    function test_buyerWallet_earlyAcceptCarriesTheDelivery() public {
        SwitchWallet w = _wallet(BW_PK);
        H.Terms memory t = _terms();
        t.buyer = address(w);
        bytes32 id = _fundAs(t, BW_PK, SELLER_PK, ADJ_PK);
        (H.Delivery memory d, H.KeyProof memory k) = _deliveryFor(t.buyer);
        bytes memory sellerSig = _deliverySig(id, d, SELLER_PK);
        H.EarlyAccept memory m = _earlyFor(t, id, d, BW_PK);

        uint8[3] memory modes = _wrongModes();
        for (uint256 i; i < modes.length; i++) {
            w.setMode(modes[i]);
            vm.expectRevert(HoldbackRules.BadSignature.selector);
            rules.earlyAccept(t, m, d, sellerSig, k);
        }
        w.setMode(HONEST);
        _is(id, HoldbackRules.Stage.Held);
        assertEq(rules.deliveryHashOf(id), bytes32(0), "no delivery landed");

        uint256 sellerBefore = usdc.balanceOf(seller);
        vm.recordLogs();
        rules.earlyAccept(t, m, d, sellerSig, k);
        _assertLogged(HoldbackRules.KeyReleased.selector, id, address(w), "the key is released to the wallet");
        _is(id, HoldbackRules.Stage.Released);
        assertEq(rules.deliveryHashOf(id), hx.delivery(id, d));
        assertEq(usdc.balanceOf(seller) - sellerBefore, PRICE);
    }

    // ------------------------------------------------------------ the buyer and the seller: mutual settlement

    /// The buyer as a wallet signs its half of a settlement after a delivery. Every wrong answer and another key's
    /// signature is refused with BadSignature and leaves the deal Delivered; the honest answer splits the price as
    /// signed and returns the fee to the wallet.
    function test_buyerWallet_mutualSettle() public {
        SwitchWallet w = _wallet(BW_PK);
        H.Terms memory t = _terms();
        t.buyer = address(w);
        bytes32 id = _fundAs(t, BW_PK, SELLER_PK, ADJ_PK);
        (H.Delivery memory d, H.KeyProof memory k) = _deliverAs(t, id, SELLER_PK);
        uint256 toSeller = 20_000_000;
        H.Mutual memory mu = _mutualFor(t, id, BW_PK, SELLER_PK, toSeller);

        uint8[3] memory modes = _wrongModes();
        for (uint256 i; i < modes.length; i++) {
            w.setMode(modes[i]);
            vm.expectRevert(HoldbackRules.BadSignature.selector);
            rules.mutualSettle(t, mu, d, k);
        }
        w.setMode(HONEST);
        H.Mutual memory forged = _mutualFor(t, id, OTHER_PK, SELLER_PK, toSeller);
        vm.expectRevert(HoldbackRules.BadSignature.selector);
        rules.mutualSettle(t, forged, d, k);
        _is(id, HoldbackRules.Stage.Delivered);

        uint256 walletBefore = usdc.balanceOf(address(w));
        uint256 sellerBefore = usdc.balanceOf(seller);
        rules.mutualSettle(t, mu, d, k);
        _is(id, HoldbackRules.Stage.Settled);
        assertEq(usdc.balanceOf(seller) - sellerBefore, toSeller, "the seller's share");
        assertEq(usdc.balanceOf(address(w)) - walletBefore, PRICE - toSeller + FEE, "the buyer's share and the fee");
        assertEq(_held(t), 0);
    }

    /// The seller as a wallet signs its half of a settlement after a delivery. Every wrong answer and another key's
    /// signature is refused with BadSignature and leaves the deal Delivered; the honest answer pays the wallet its
    /// share.
    function test_sellerWallet_mutualSettle() public {
        SwitchWallet w = _wallet(SW_PK);
        H.Terms memory t = _terms();
        t.seller = address(w);
        bytes32 id = _fundAs(t, BUYER_PK, SW_PK, ADJ_PK);
        (H.Delivery memory d, H.KeyProof memory k) = _deliverAs(t, id, SW_PK);
        uint256 toSeller = 13_000_000;
        H.Mutual memory mu = _mutualFor(t, id, BUYER_PK, SW_PK, toSeller);

        uint8[3] memory modes = _wrongModes();
        for (uint256 i; i < modes.length; i++) {
            w.setMode(modes[i]);
            vm.expectRevert(HoldbackRules.BadSignature.selector);
            rules.mutualSettle(t, mu, d, k);
        }
        w.setMode(HONEST);
        H.Mutual memory forged = _mutualFor(t, id, BUYER_PK, OTHER_PK, toSeller);
        vm.expectRevert(HoldbackRules.BadSignature.selector);
        rules.mutualSettle(t, forged, d, k);
        _is(id, HoldbackRules.Stage.Delivered);

        uint256 walletBefore = usdc.balanceOf(address(w));
        uint256 buyerBefore = usdc.balanceOf(buyer);
        rules.mutualSettle(t, mu, d, k);
        _is(id, HoldbackRules.Stage.Settled);
        assertEq(usdc.balanceOf(address(w)) - walletBefore, toSeller, "the wallet's share");
        assertEq(usdc.balanceOf(buyer) - buyerBefore, PRICE - toSeller + FEE);
    }

    /// Both parties as wallets settle in Held, before any delivery: each wallet's wrong answer alone blocks the
    /// settlement, and two honest wallets close the deal with the split they signed.
    function test_bothWallets_mutualSettleBeforeDelivery() public {
        SwitchWallet bw = _wallet(BW_PK);
        SwitchWallet sw = _wallet(SW_PK);
        H.Terms memory t = _terms();
        t.buyer = address(bw);
        t.seller = address(sw);
        bytes32 id = _fundAs(t, BW_PK, SW_PK, ADJ_PK);
        H.Mutual memory mu = _mutualFor(t, id, BW_PK, SW_PK, 5_000_000);
        H.Delivery memory none;
        H.KeyProof memory noKey;

        bw.setMode(WRONG_MAGIC);
        vm.expectRevert(HoldbackRules.BadSignature.selector);
        rules.mutualSettle(t, mu, none, noKey);
        bw.setMode(HONEST);
        sw.setMode(REVERTS);
        vm.expectRevert(HoldbackRules.BadSignature.selector);
        rules.mutualSettle(t, mu, none, noKey);
        sw.setMode(HONEST);
        _is(id, HoldbackRules.Stage.Held);

        uint256 bwBefore = usdc.balanceOf(address(bw));
        uint256 swBefore = usdc.balanceOf(address(sw));
        rules.mutualSettle(t, mu, none, noKey);
        _is(id, HoldbackRules.Stage.Settled);
        assertEq(usdc.balanceOf(address(sw)) - swBefore, 5_000_000);
        assertEq(usdc.balanceOf(address(bw)) - bwBefore, PRICE - 5_000_000 + FEE);
    }

    // ------------------------------------------------------------ the appeal adjudicator

    /// The appeal adjudicator as a wallet decides a case the primary escalated. Every wrong answer and another key's
    /// signature is refused with BadSignature and leaves the deal Escalated with the whole hold in place; the honest
    /// answer accepts, paying the seller the price and the wallet the fee.
    function test_appealWallet_decidesTheEscalation() public {
        SwitchWallet w = _wallet(AW_PK);
        H.Terms memory t = _terms();
        t.appealAdjudicator = address(w);
        bytes32 id = _fund(t);
        _deliver(t, id);
        rules.decide(t, _primary(t, id, H.OUTCOME_ESCALATE), _noDelivery(), "");
        uint64 at = uint64(block.timestamp);
        vm.warp(at + 1); // the appeal round is the first one after the escalation
        H.Decision memory m = _appealDecision(t, id, H.OUTCOME_ACCEPT, at, address(w), AW_PK);

        uint8[3] memory modes = _wrongModes();
        for (uint256 i; i < modes.length; i++) {
            w.setMode(modes[i]);
            vm.expectRevert(HoldbackRules.BadSignature.selector);
            rules.decide(t, m, _noDelivery(), "");
        }
        w.setMode(HONEST);
        H.Decision memory forged = _appealDecision(t, id, H.OUTCOME_ACCEPT, at, address(w), OTHER_PK);
        vm.expectRevert(HoldbackRules.BadSignature.selector);
        rules.decide(t, forged, _noDelivery(), "");
        _is(id, HoldbackRules.Stage.Escalated);
        assertEq(_held(t), PRICE + FEE);

        uint256 walletBefore = usdc.balanceOf(address(w));
        uint256 sellerBefore = usdc.balanceOf(seller);
        vm.recordLogs();
        rules.decide(t, m, _noDelivery(), "");
        _assertLogged(HoldbackRules.Decided.selector, id, address(w), "the wallet is the deciding adjudicator");
        _is(id, HoldbackRules.Stage.Released);
        assertEq(usdc.balanceOf(seller) - sellerBefore, PRICE);
        assertEq(usdc.balanceOf(address(w)) - walletBefore, FEE, "the wallet is paid the fee");
    }

    /// The rules contract emitted, in the recorded logs, an event `sig` for deal `id` whose second indexed topic is
    /// `who`: the recipient of KeyReleased, the adjudicator of Decided.
    function _assertLogged(bytes32 sig, bytes32 id, address who, string memory why) internal {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 found;
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].emitter != address(rules) || logs[i].topics.length < 3 || logs[i].topics[0] != sig) continue;
            if (logs[i].topics[1] == id && logs[i].topics[2] == bytes32(uint256(uint160(who)))) found++;
        }
        assertEq(found, 1, why);
    }

    /// The appeal adjudicator as a wallet rejects an escalated case: the price goes back to the buyer and the fee to
    /// the wallet.
    function test_appealWallet_rejectsTheEscalation() public {
        SwitchWallet w = _wallet(AW_PK);
        H.Terms memory t = _terms();
        t.appealAdjudicator = address(w);
        bytes32 id = _fund(t);
        _deliver(t, id);
        rules.decide(t, _primary(t, id, H.OUTCOME_ESCALATE), _noDelivery(), "");
        uint64 at = uint64(block.timestamp);
        vm.warp(at + 1);
        uint256 buyerBefore = usdc.balanceOf(buyer);
        uint256 walletBefore = usdc.balanceOf(address(w));
        rules.decide(t, _appealDecision(t, id, H.OUTCOME_REJECT, at, address(w), AW_PK), _noDelivery(), "");
        _is(id, HoldbackRules.Stage.Refunded);
        assertEq(usdc.balanceOf(buyer) - buyerBefore, PRICE);
        assertEq(usdc.balanceOf(address(w)) - walletBefore, FEE);
    }
}
