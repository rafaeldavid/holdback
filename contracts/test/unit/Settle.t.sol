// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {HoldbackRules} from "../../src/HoldbackRules.sol";
import {HoldbackTypes as H} from "../../src/HoldbackTypes.sol";
import {Base} from "./Base.sol";

contract EarlyAcceptTest is Base {
    event KeyReleased(bytes32 indexed id, address indexed recipient, uint8 path, string scheme, string ciphertext);

    function _early(H.Terms memory t, bytes32 id, uint256 pk) internal view returns (H.EarlyAccept memory m) {
        m = H.EarlyAccept({attempt: 1, nonce: keccak256("early"), expiresAt: type(uint64).max, signature: ""});
        m.signature = _sign(pk, hx.early(id, t.buyer, m));
    }

    function test_pricetoSeller_feeBack_keyReleased_deliveryCarried() public {
        (H.Terms memory t, bytes32 id) = _funded();
        (H.Delivery memory d, H.KeyProof memory k) = _delivery();
        uint256 b0 = usdc.balanceOf(buyer);
        uint256 s0 = usdc.balanceOf(seller);
        H.EarlyAccept memory m = _early(t, id, BUYER_PK);
        bytes memory dsig = _deliverySig(id, d, SELLER_PK);
        vm.expectEmit(true, true, false, true, address(rules));
        emit KeyReleased(id, buyer, 1, KEY_SCHEME, "buyer-envelope");
        vm.prank(relayer);
        rules.earlyAccept(t, m, d, dsig, k);
        assertEq(usdc.balanceOf(seller), s0 + PRICE);
        assertEq(usdc.balanceOf(buyer), b0 + FEE, "no adjudicator judged: the fee returns");
        assertEq(_held(t), 0);
        assertEq(bonds.encumberedOf(adjudicator, address(usdc)), 0);
        assertEq(uint8(rules.dealOf(id).appeal), uint8(HoldbackRules.AppealState.Closed));
    }

    function test_afterOnChainDelivery() public {
        (H.Terms memory t, bytes32 id) = _funded();
        (H.Delivery memory d, H.KeyProof memory k) = _deliver(t, id);
        rules.earlyAccept(t, _early(t, id, BUYER_PK), d, _deliverySig(id, d, SELLER_PK), k);
        assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.Released));
    }

    function test_refuses_notTheBuyer() public {
        (H.Terms memory t, bytes32 id) = _funded();
        (H.Delivery memory d, H.KeyProof memory k) = _delivery();
        H.EarlyAccept memory m = _early(t, id, OTHER_PK);
        bytes memory dsig = _deliverySig(id, d, SELLER_PK);
        vm.expectRevert(HoldbackRules.BadSignature.selector);
        rules.earlyAccept(t, m, d, dsig, k);
    }

    function test_refuses_aKeyNotInTheDelivery() public {
        (H.Terms memory t, bytes32 id) = _funded();
        (H.Delivery memory d, H.KeyProof memory k) = _delivery();
        k.ciphertext = "an envelope the seller never sealed";
        H.EarlyAccept memory m = _early(t, id, BUYER_PK);
        bytes memory dsig = _deliverySig(id, d, SELLER_PK);
        vm.expectRevert(HoldbackRules.BadKeyProof.selector);
        rules.earlyAccept(t, m, d, dsig, k);
    }

    function test_refuses_secondSettle() public {
        (H.Terms memory t, bytes32 id) = _funded();
        (H.Delivery memory d, H.KeyProof memory k) = _delivery();
        H.EarlyAccept memory m = _early(t, id, BUYER_PK);
        bytes memory dsig = _deliverySig(id, d, SELLER_PK);
        rules.earlyAccept(t, m, d, dsig, k);
        vm.expectRevert(abi.encodeWithSelector(HoldbackRules.WrongStage.selector, HoldbackRules.Stage.Released));
        rules.earlyAccept(t, m, d, dsig, k);
    }
}

contract MutualSettleTest is Base {
    address internal constant THIRD = address(0x9999);

    function _mutual(H.Terms memory t, bytes32 id, H.Payout[] memory payouts, bool releaseKey, bytes32 dh)
        internal
        view
        returns (H.Mutual memory m)
    {
        m.hasDelivery = dh != bytes32(0);
        m.deliveryHash = dh;
        m.payouts = payouts;
        m.releaseKey = releaseKey;
        m.nonce = keccak256("mutual");
        m.expiresAt = type(uint64).max;
        bytes32 h = hx.mutual(id, t.token, m);
        m.buyerSignature = _sign(BUYER_PK, h);
        m.sellerSignature = _sign(SELLER_PK, h);
    }

    function _split(uint256 toSeller, uint256 toThird, uint256 toBuyer) internal view returns (H.Payout[] memory p) {
        p = new H.Payout[](3);
        p[0] = H.Payout(seller, toSeller);
        p[1] = H.Payout(THIRD, toThird);
        p[2] = H.Payout(buyer, toBuyer);
    }

    function test_paysAnySplit_feeBackToBuyer_releasesKey() public {
        (H.Terms memory t, bytes32 id) = _funded();
        (H.Delivery memory d, H.KeyProof memory k) = _deliver(t, id);
        uint256 b0 = usdc.balanceOf(buyer);
        uint256 s0 = usdc.balanceOf(seller);
        H.Mutual memory m = _mutual(t, id, _split(13_000_000, 3_000_000, 10_000_000), true, hx.delivery(id, d));
        vm.prank(relayer);
        rules.mutualSettle(t, m, d, k);
        assertEq(usdc.balanceOf(seller), s0 + 13_000_000);
        assertEq(usdc.balanceOf(THIRD), 3_000_000);
        assertEq(usdc.balanceOf(buyer), b0 + 10_000_000 + FEE);
        assertEq(_held(t), 0);
        assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.Settled));
        assertEq(bonds.encumberedOf(adjudicator, address(usdc)), 0);
    }

    function test_beforeDelivery_noKey() public {
        (H.Terms memory t, bytes32 id) = _funded();
        H.Payout[] memory p = new H.Payout[](1);
        p[0] = H.Payout(buyer, PRICE);
        H.Mutual memory m = _mutual(t, id, p, false, bytes32(0));
        H.KeyProof memory none;
        rules.mutualSettle(t, m, _noDelivery(), none);
        assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.Settled));
        assertEq(_held(t), 0);
    }

    function test_refuses_payoutsNotSummingToThePrice() public {
        (H.Terms memory t, bytes32 id) = _funded();
        H.Payout[] memory p = new H.Payout[](1);
        p[0] = H.Payout(seller, PRICE + FEE);
        H.Mutual memory m = _mutual(t, id, p, false, bytes32(0));
        H.KeyProof memory none;
        vm.expectRevert(HoldbackRules.InvalidMessage.selector);
        rules.mutualSettle(t, m, _noDelivery(), none);
    }

    function test_refuses_oneSignatureOnly() public {
        (H.Terms memory t, bytes32 id) = _funded();
        H.Payout[] memory p = new H.Payout[](1);
        p[0] = H.Payout(seller, PRICE);
        H.Mutual memory m = _mutual(t, id, p, false, bytes32(0));
        m.sellerSignature = m.buyerSignature;
        H.KeyProof memory none;
        vm.expectRevert(HoldbackRules.BadSignature.selector);
        rules.mutualSettle(t, m, _noDelivery(), none);
    }

    function test_refuses_secondSettle() public {
        (H.Terms memory t, bytes32 id) = _funded();
        H.Payout[] memory p = new H.Payout[](1);
        p[0] = H.Payout(seller, PRICE);
        H.Mutual memory m = _mutual(t, id, p, false, bytes32(0));
        H.KeyProof memory none;
        rules.mutualSettle(t, m, _noDelivery(), none);
        vm.expectRevert(abi.encodeWithSelector(HoldbackRules.WrongStage.selector, HoldbackRules.Stage.Settled));
        rules.mutualSettle(t, m, _noDelivery(), none);
    }
}

contract AppealTest is Base {
    function _accepted() internal returns (H.Terms memory t, bytes32 id) {
        (t, id) = _funded();
        _deliver(t, id);
        rules.decide(t, _primary(t, id, H.OUTCOME_ACCEPT), _noDelivery(), "");
    }

    function _appeal(H.Terms memory t, bytes32 id, uint256 pk) internal view returns (H.Appeal memory a) {
        a = H.Appeal({appellant: 0, groundsHash: keccak256("fails check rows"), bond: 1_300_000, filedAt: uint64(block.timestamp), signature: ""});
        a.signature = _sign(pk, hx.appeal(id, buyer, t.token, a));
    }

    function _filed() internal returns (H.Terms memory t, bytes32 id, uint64 openedAt) {
        (t, id) = _accepted();
        vm.prank(buyer);
        usdc.approve(address(bonds), type(uint256).max);
        rules.fileAppeal(t, _appeal(t, id, BUYER_PK));
        openedAt = uint64(block.timestamp);
    }

    function test_file_holdsTheBond() public {
        (, bytes32 id,) = _filed();
        assertEq(uint8(rules.dealOf(id).appeal), uint8(HoldbackRules.AppealState.Open));
        (address who, uint96 amount) = bonds.appealBondOf(id);
        assertEq(who, buyer);
        assertEq(amount, 1_300_000);
    }

    function test_file_refusesAnotherSigner() public {
        (H.Terms memory t, bytes32 id) = _accepted();
        H.Appeal memory a = _appeal(t, id, OTHER_PK);
        vm.expectRevert(HoldbackRules.BadSignature.selector);
        rules.fileAppeal(t, a);
    }

    function test_file_refusesAfterAppealBy() public {
        (H.Terms memory t, bytes32 id) = _accepted();
        H.Appeal memory a = _appeal(t, id, BUYER_PK);
        vm.warp(block.timestamp + t.timing.appealWindowSec);
        vm.expectRevert(HoldbackRules.DeadlinePassed.selector);
        rules.fileAppeal(t, a);
    }

    function test_file_refusesAfterEarlyAccept_or_secondAppeal() public {
        (H.Terms memory t, bytes32 id,) = _filed();
        H.Appeal memory a = _appeal(t, id, BUYER_PK);
        vm.expectRevert(
            abi.encodeWithSelector(HoldbackRules.WrongAppealState.selector, HoldbackRules.AppealState.Open)
        );
        rules.fileAppeal(t, a);
    }

    function test_upheld_bondGoesToTheFirstAdjudicatorsBond() public {
        (H.Terms memory t, bytes32 id, uint64 openedAt) = _filed();
        H.Decision memory m = _beaconDecision(id, H.ROLE_APPEAL, H.OUTCOME_ACCEPT, openedAt + 1);
        m = _signDecision(t, id, m, appealAdj, AP_PK);
        rules.decide(t, m, _noDelivery(), "");
        assertEq(uint8(rules.dealOf(id).appeal), uint8(HoldbackRules.AppealState.Upheld));
        assertEq(bonds.bondOf(adjudicator, address(usdc)), BOND + 1_300_000);
        assertEq(bonds.encumberedOf(adjudicator, address(usdc)), 0);
    }

    function test_overturned_bondBackToAppellant() public {
        (H.Terms memory t, bytes32 id, uint64 openedAt) = _filed();
        uint256 b0 = usdc.balanceOf(buyer);
        H.Decision memory m = _beaconDecision(id, H.ROLE_APPEAL, H.OUTCOME_REJECT, openedAt + 1);
        m = _signDecision(t, id, m, appealAdj, AP_PK);
        rules.decide(t, m, _noDelivery(), "");
        assertEq(uint8(rules.dealOf(id).appeal), uint8(HoldbackRules.AppealState.Overturned));
        assertEq(usdc.balanceOf(buyer), b0 + 1_300_000);
    }

    function test_appealDecision_refusesAnotherSigner() public {
        (H.Terms memory t, bytes32 id, uint64 openedAt) = _filed();
        H.Decision memory m = _beaconDecision(id, H.ROLE_APPEAL, H.OUTCOME_ACCEPT, openedAt + 1);
        m = _signDecision(t, id, m, appealAdj, ADJ_PK);
        vm.expectRevert(HoldbackRules.BadSignature.selector);
        rules.decide(t, m, _noDelivery(), "");
    }
}
