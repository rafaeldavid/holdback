// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {HoldbackRules} from "../../src/HoldbackRules.sol";
import {HoldbackTypes as H} from "../../src/HoldbackTypes.sol";
import {Base, TypesHarness} from "./Base.sol";

// The pinned deployed contracts (commit 64be1f1), as the side-by-side harness deploys them (test/differential/Sides.sol).
import {HoldbackRules as OldRules} from "../differential/old/HoldbackRules.64be1f1.sol";
import {HoldbackBonds as OldBonds} from "../differential/old/HoldbackBonds.sol";
import {HoldbackTypes as OldH} from "../differential/old/HoldbackTypes.sol";
import {IHoldbackBeacon as OldBeacon} from "../differential/old/IHoldbackBeacon.sol";

/// T-346 (SC-7, ADR-0031 §8): phase one has no party appeal and no bond. The acceptance still signs `bondReserved`
/// (no signed type changed), and `agreeAndFund` now refuses any value but 0, so every funded deal carries an
/// acceptance that says what is true. The removed entry points are gone from the ABI, and a decision on a settled
/// deal, which was the party appeal's decision, is refused by stage.
///
/// "Failed before" is shown on the same fixture against the pinned deployed contracts (`64be1f1`): they refuse
/// `bondReserved` = 0 and fund with the price (and with uint256 max), so the refusals below are new behaviour.
/// `bondReserved` = 1 was refused before too (it is below the price), for another reason.
/// T-358 (ADR-0033): the pinned contracts' `Terms` has no payment or payout address. This adapter answers Base's
/// `TypesHarness` calls (`id`, `acceptance`) for terms in the current layout by hashing them in the pinned layout,
/// so Base's signing helpers sign what the pinned contract checks. The two new addresses must equal the signing
/// addresses, which is what the pinned contract pays.
contract PinnedTypesAdapter {
    function id(H.Terms calldata t) external view returns (bytes32) {
        return this.pinnedId(PinnedTerms.from(t));
    }

    function pinnedId(OldH.Terms calldata t) external pure returns (bytes32) {
        return OldH.commitmentId(t);
    }

    function acceptance(bytes32 i, H.Terms calldata t, H.Acceptance calldata a) external view returns (bytes32) {
        return this.pinnedAcceptance(
            i, PinnedTerms.from(t), OldH.Acceptance(a.seedCommitment, a.bondReserved, a.nonce, a.expiresAt, a.signature)
        );
    }

    function pinnedAcceptance(bytes32 i, OldH.Terms calldata t, OldH.Acceptance calldata a)
        external
        pure
        returns (bytes32)
    {
        return OldH.acceptanceHash(i, t, a);
    }

    function agree(bytes32 i, address b, H.Agree calldata a) external pure returns (bytes32) {
        return H.agreeHash(i, b, a);
    }
}

library PinnedTerms {
    /// The current terms in the pinned layout: every field but the two addresses ADR-0033 added.
    function from(H.Terms memory t) internal pure returns (OldH.Terms memory o) {
        require(t.buyerPaymentAddress == t.buyer && t.sellerPayoutAddress == t.seller, "the pinned contract pays the signers");
        OldH.Timing memory tm = OldH.Timing(
            t.timing.offerExpiresAt,
            t.timing.fundBy,
            t.timing.deliverBy,
            t.timing.judgeBy,
            t.timing.fallbackBy,
            t.timing.appealWindowSec,
            t.timing.appealDecideSec,
            t.timing.maxSubmissions,
            t.timing.disputeBy,
            t.timing.disputeJudgeSec,
            t.timing.disputeFallbackSec
        );
        o.schemaVersionHash = t.schemaVersionHash;
        o.clubIdHash = t.clubIdHash;
        o.rulebookHash = t.rulebookHash;
        o.buyer = t.buyer;
        o.seller = t.seller;
        o.deliverableHash = t.deliverableHash;
        o.acceptanceHash = t.acceptanceHash;
        o.token = t.token;
        o.price = t.price;
        o.adjudicator = t.adjudicator;
        o.fallbackAdjudicator = t.fallbackAdjudicator;
        o.appealAdjudicator = t.appealAdjudicator;
        o.policyIdHash = t.policyIdHash;
        o.fee = t.fee;
        o.registryHash = t.registryHash;
        o.policyHash = t.policyHash;
        o.timing = tm;
        o.remedyHash = t.remedyHash;
        o.disclosureHash = t.disclosureHash;
        o.buyerKeyHash = t.buyerKeyHash;
        o.nonce = t.nonce;
        o.createdAt = t.createdAt;
    }
}

contract PhaseOneNoBondsTest is Base {
    /// The settlement view's ABI tuple, from `HoldbackTypes.Terms` (unchanged by T-346).
    string internal constant TERMS_T = "(bytes32,bytes32,bytes32,address,address,bytes32,bytes32,address,uint256,"
        "address,address,address,bytes32,uint256,bytes32,bytes32,"
        "(uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint8,uint64,uint64,uint64),"
        "bytes32,bytes32,bytes32,bytes32,uint64)";
    /// The removed `HoldbackTypes.Appeal` tuple (appellant, groundsHash, bond, filedAt, signature).
    string internal constant APPEAL_T = "(uint8,bytes32,uint256,uint64,bytes)";

    /// The removed entry points, by their signatures in test/differential/old/HoldbackRules.64be1f1.sol.
    function _removedSelectors() internal pure returns (bytes4[4] memory s, string[4] memory names) {
        names = [
            string.concat("fileAppeal(", TERMS_T, ",", APPEAL_T, ")"),
            string.concat("expireAppeal(", TERMS_T, ")"),
            "BONDS()",
            "KEY_APPEAL()"
        ];
        for (uint256 i; i < 4; i++) {
            s[i] = bytes4(keccak256(bytes(names[i])));
        }
    }

    /// Base's acceptance with a chosen `bondReserved`, signed by the primary under the current `rules` domain.
    function _acceptanceWith(H.Terms memory t, uint256 bondReserved) internal view returns (H.Acceptance memory a) {
        a = _acceptance(t, ADJ_PK);
        a.bondReserved = bondReserved;
        a.signature = _sign(ADJ_PK, hx.acceptance(hx.id(t), t, a));
    }

    /// Set while `rules` is the pinned contract: since SC-2 (T-356) the current `Funding` has no `method`, and the
    /// pinned contract's still does, so its `agreeAndFund` is encoded in its own layout, as ERC-3009 (`method` 0).
    bool internal pinned;

    /// Relays `agreeAndFund` in the layout of whichever contract `rules` is; returns the call's outcome.
    function _fundCall(H.Terms memory t, bytes memory s, H.Acceptance memory a, H.Agree memory g, H.Funding memory f)
        internal
        returns (bool ok, bytes memory ret)
    {
        bytes memory data = pinned
            ? abi.encodeWithSelector(
                OldRules.agreeAndFund.selector, PinnedTerms.from(t), s, a, g, OldH.Funding(0, f.signature)
            )
            : abi.encodeCall(HoldbackRules.agreeAndFund, (t, s, a, g, f));
        vm.prank(relayer);
        (ok, ret) = address(rules).call(data);
    }

    function _agreeAndFund(H.Terms memory t, uint256 bondReserved) internal returns (bytes32 id) {
        bytes memory s = _sellerSig(t, SELLER_PK);
        H.Acceptance memory a = _acceptanceWith(t, bondReserved);
        H.Agree memory g = _agree(t, BUYER_PK);
        H.Funding memory f = _erc3009(t, BUYER_PK);
        (bool ok, bytes memory ret) = _fundCall(t, s, a, g, f);
        assertTrue(ok, "agreeAndFund reverted");
        id = abi.decode(ret, (bytes32));
    }

    /// `agreeAndFund` with `bondReserved` reverts InvalidMessage and leaves no trace: no deal, no hold, the buyer's
    /// balance unchanged.
    function _assertRefused(uint256 bondReserved) internal {
        H.Terms memory t = _terms();
        bytes memory s = _sellerSig(t, SELLER_PK);
        H.Acceptance memory a = _acceptanceWith(t, bondReserved);
        H.Agree memory g = _agree(t, BUYER_PK);
        H.Funding memory f = _erc3009(t, BUYER_PK);
        uint256 b0 = usdc.balanceOf(buyer);
        (bool ok, bytes memory ret) = _fundCall(t, s, a, g, f);
        assertFalse(ok, "agreeAndFund funded");
        assertEq(ret, abi.encodeWithSelector(HoldbackRules.InvalidMessage.selector), "refused with InvalidMessage");
        assertEq(uint8(_stage(hx.id(t))), uint8(HoldbackRules.Stage.None), "no deal");
        assertEq(_held(t), 0, "no hold");
        assertEq(usdc.balanceOf(buyer), b0, "the buyer's balance is unchanged");
    }

    /// `agreeAndFund` with `bondReserved` funds: Held, price + fee in CPP's hold, taken from the buyer.
    function _assertFunds(uint256 bondReserved) internal returns (bytes32 id) {
        H.Terms memory t = _terms();
        uint256 b0 = usdc.balanceOf(buyer);
        uint256 h0 = _held(t);
        id = _agreeAndFund(t, bondReserved);
        assertEq(id, hx.id(t));
        assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.Held), "funded");
        assertEq(_held(t) - h0, PRICE + FEE, "the hold is price + fee");
        assertEq(b0 - usdc.balanceOf(buyer), PRICE + FEE, "taken from the buyer");
    }

    // ------------------------------------------------------------ bondReserved must be 0

    function test_refuses_bondReservedEqualToThePrice() public {
        _assertRefused(PRICE);
    }

    function test_refuses_bondReservedOne() public {
        _assertRefused(1);
    }

    function test_refuses_bondReservedUint256Max() public {
        _assertRefused(type(uint256).max);
    }

    function test_funds_bondReservedZero() public {
        _assertFunds(0);
    }

    /// Failed before: on the pinned deployed contracts (`64be1f1`), with the primary's bond in their vault, the same
    /// acceptances give the opposite results for 0, the price and uint256 max. Only 1 (below the price) was refused
    /// on both.
    function test_before_pinnedContractsRefuseZero_andFundWithThePriceAndWithMax() public {
        OldRules old = new OldRules(
            escrow, address(collector3009), address(collectorPermit2), MARGIN, OldBeacon(address(sim))
        );
        OldBonds vault = old.BONDS();
        usdc.mint(adjudicator, 2 * PRICE);
        vm.startPrank(adjudicator);
        usdc.approve(address(vault), 2 * PRICE);
        vault.deposit(address(usdc), 2 * PRICE);
        vm.stopPrank();
        rules = HoldbackRules(address(old)); // Base's signing and hold helpers now target the pinned contract
        hx = TypesHarness(address(new PinnedTypesAdapter())); // and hash the terms in its layout (T-358)
        pinned = true;

        _assertRefused(0);
        _assertRefused(1);
        bytes32 atPrice = _assertFunds(PRICE);
        assertEq(uint8(old.dealOf(atPrice).stage), uint8(OldRules.Stage.Held));
        assertEq(vault.encumberedOf(adjudicator, address(usdc)), PRICE, "the old vault encumbered the price");
        _assertFunds(type(uint256).max);
        assertEq(vault.encumberedOf(adjudicator, address(usdc)), 2 * PRICE, "and the price again");
    }

    // ------------------------------------------------------------ the removed entry points are gone

    /// The selectors computed from the old signatures are the pinned contract's own, and the pinned contract answers
    /// the two views; the current contract has no fallback, so each call reverts with empty return data.
    function test_removedEntryPoints_revertWithEmptyData() public {
        (bytes4[4] memory sel, string[4] memory names) = _removedSelectors();
        OldRules old = new OldRules(
            escrow, address(collector3009), address(collectorPermit2), MARGIN, OldBeacon(address(sim))
        );
        assertEq(sel[0], old.fileAppeal.selector, names[0]);
        assertEq(sel[1], old.expireAppeal.selector, names[1]);
        assertEq(sel[2], old.BONDS.selector, names[2]);
        assertEq(sel[3], old.KEY_APPEAL.selector, names[3]);
        assertTrue(address(old.BONDS()) != address(0), "the pinned contract has a vault");
        assertEq(old.KEY_APPEAL(), 3);

        (H.Terms memory t, bytes32 id) = _funded();
        _deliver(t, id);
        rules.decide(t, _primary(t, id, H.OUTCOME_ACCEPT), _noDelivery(), "");
        OldH.Appeal memory a = OldH.Appeal({
            appellant: 0,
            groundsHash: keccak256("fails check rows"),
            bond: 1_300_000,
            filedAt: uint64(block.timestamp),
            signature: _sign(BUYER_PK, keccak256("any appeal"))
        });
        bytes[4] memory calls = [
            abi.encodeWithSelector(sel[0], t, a),
            abi.encodeWithSelector(sel[1], t),
            abi.encodeWithSelector(sel[2]),
            abi.encodeWithSelector(sel[3])
        ];
        for (uint256 i; i < 4; i++) {
            vm.prank(buyer);
            (bool ok, bytes memory ret) = address(rules).call(calls[i]);
            assertFalse(ok, names[i]);
            assertEq(ret.length, 0, names[i]);
        }
        assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.Released), "the deal stands as decided");
    }

    // ------------------------------------------------------------ a settled deal takes no further decision

    /// The appeal adjudicator's decision on a Released deal was the party appeal's decision. Phase one has none: it
    /// reverts WrongStage(Released), and nothing moves.
    function test_decisionOnAReleasedDeal_revertsWrongStage() public {
        (H.Terms memory t, bytes32 id) = _funded();
        _deliver(t, id);
        rules.decide(t, _primary(t, id, H.OUTCOME_ACCEPT), _noDelivery(), "");
        uint64 round = uint64(rules.dealOf(id).t1) + 1;
        vm.warp(round);
        uint256 b0 = usdc.balanceOf(buyer);
        uint256 s0 = usdc.balanceOf(seller);
        H.Decision memory m = _beaconDecision(id, H.ROLE_APPEAL, H.OUTCOME_REJECT, round);
        m = _signDecision(t, id, m, appealAdj, AP_PK);
        vm.expectRevert(abi.encodeWithSelector(HoldbackRules.WrongStage.selector, HoldbackRules.Stage.Released));
        rules.decide(t, m, _noDelivery(), "");
        assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.Released));
        assertEq(usdc.balanceOf(buyer), b0);
        assertEq(usdc.balanceOf(seller), s0);
    }

    /// The same on a Refunded deal: the seller's former appeal against a reject is refused by stage.
    function test_decisionOnARefundedDeal_revertsWrongStage() public {
        (H.Terms memory t, bytes32 id) = _funded();
        _deliver(t, id);
        rules.decide(t, _primary(t, id, H.OUTCOME_REJECT), _noDelivery(), "");
        uint64 round = uint64(rules.dealOf(id).t1) + 1;
        vm.warp(round);
        H.Decision memory m = _beaconDecision(id, H.ROLE_APPEAL, H.OUTCOME_ACCEPT, round);
        (m.keyScheme, m.keyCiphertext) = ("", "");
        m = _signDecision(t, id, m, appealAdj, AP_PK);
        vm.expectRevert(abi.encodeWithSelector(HoldbackRules.WrongStage.selector, HoldbackRules.Stage.Refunded));
        rules.decide(t, m, _noDelivery(), "");
        assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.Refunded));
    }
}
