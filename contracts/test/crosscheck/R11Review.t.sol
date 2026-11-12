// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AuthCaptureEscrow} from "commerce-payments/AuthCaptureEscrow.sol";

import {HoldbackRules} from "../../src/HoldbackRules.sol";
import {IHoldbackRules} from "../../src/IHoldbackRules.sol";
import {HoldbackTypes as H} from "../../src/HoldbackTypes.sol";
import {Base} from "../unit/Base.sol";

/// T-388 (package R11): what the first whole-diff review measured. Each test pins a fact the report states
/// (`docs/reviews/2026-11-12-phase-one-whole-diff-review.md`). None shows a way to move money outside the signed
/// terms; `test_r11_issue_…` tests show the behaviour behind a recorded finding, as the contract stands.
contract R11ReviewTest is Base {
    // ------------------------------------------------------------ helpers

    function _escalateByPrimary(H.Terms memory t, bytes32 id) internal returns (uint64 at) {
        _deliver(t, id);
        rules.decide(t, _primary(t, id, H.OUTCOME_ESCALATE), _noDelivery(), "");
        at = uint64(block.timestamp);
    }

    function _appealDecision(H.Terms memory t, bytes32 id, uint8 outcome, uint64 at)
        internal
        view
        returns (H.Decision memory m)
    {
        m = _signDecision(t, id, _beaconDecision(id, H.ROLE_APPEAL, outcome, at + 1), appealAdj, AP_PK);
    }

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

    function _state(H.Terms memory t) internal view returns (uint120 capturable, uint120 refundable) {
        (, capturable, refundable) = escrow.paymentState(escrow.getHash(_pi(t)));
    }

    // ------------------------------------------------------------ the escrow's expiry, to the second

    /// The vendored escrow refuses a capture from `authorizationExpiry` on (`AuthCaptureEscrow.sol:277-279`, `>=`) and
    /// opens the payer's own reclaim at the same second (`:325-327`, `<`): the two split time at one instant. A void
    /// has no time check (`:304-316`). Shown through the rules contract: an early accept (a capture) lands one second
    /// before the expiry and reverts at it; the payer's reclaim reverts one second before it and lands at it.
    function test_r11_captureStopsAtTheExpirySecond_andThePayersReclaimOpensThere() public {
        (H.Terms memory t, bytes32 id) = _funded();
        (H.Delivery memory d, H.KeyProof memory k) = _deliver(t, id);
        H.EarlyAccept memory m = _early(t, id, BUYER_PK);
        AuthCaptureEscrow.PaymentInfo memory pi = _pi(t);
        uint256 snap = vm.snapshotState();

        vm.warp(uint256(pi.authorizationExpiry) - 1);
        vm.prank(buyer);
        vm.expectRevert(
            abi.encodeWithSelector(
                AuthCaptureEscrow.BeforeAuthorizationExpiry.selector, pi.authorizationExpiry - 1, pi.authorizationExpiry
            )
        );
        escrow.reclaim(pi);
        rules.earlyAccept(t, m, d, "", k);
        assertEq(
            uint8(_stage(id)), uint8(IHoldbackRules.Stage.Released), "a capture lands one second before the expiry"
        );

        vm.revertToState(snap);
        vm.warp(pi.authorizationExpiry);
        vm.expectRevert(
            abi.encodeWithSelector(
                AuthCaptureEscrow.AfterAuthorizationExpiry.selector, pi.authorizationExpiry, pi.authorizationExpiry
            )
        );
        rules.earlyAccept(t, m, d, "", k);
        uint256 before = usdc.balanceOf(buyer);
        vm.prank(buyer);
        escrow.reclaim(pi);
        assertEq(usdc.balanceOf(buyer) - before, PRICE + FEE, "the payer's reclaim lands at the expiry second");
    }

    /// A void still lands at and after the expiry: with the hold untouched, the timeouts refund through the rules
    /// contract at the expiry second itself, and the payer needs no call of its own.
    function test_r11_voidStillLandsAtTheExpirySecond() public {
        (H.Terms memory t, bytes32 id) = _funded();
        _deliver(t, id);
        AuthCaptureEscrow.PaymentInfo memory pi = _pi(t);
        vm.warp(pi.authorizationExpiry);
        uint256 before = usdc.balanceOf(buyer);
        rules.triggerFallback(t);
        rules.triggerDefault(t);
        assertEq(usdc.balanceOf(buyer) - before, PRICE + FEE, "the void pays the payer at the expiry second");
        (uint120 capturable, uint120 refundable) = _state(t);
        assertEq(capturable, 0);
        assertEq(refundable, 0);
        assertEq(uint8(rules.dealOf(id).reason), uint8(IHoldbackRules.Reason.Defaulted));
    }

    /// No decision window outlives the escrow, even with an expiry margin of 0. The last decision any deal can take is
    /// the appeal adjudicator's, one second before `t1 + appealDecideSec`, after a fallback that escalated at
    /// `fallbackBy - 1`: block time `fallbackBy + appealDecideSec - 2`, two seconds before the expiry
    /// `fallbackBy + appealDecideSec + 0`. Its capture lands.
    function test_r11_lastPossibleDecisionCaptures_withAnExpiryMarginOfZero() public {
        rules = new HoldbackRules(escrow, address(collector3009), 0, sim, address(usdc), _beaconMargin());
        (H.Terms memory t, bytes32 id) = _funded();
        _deliver(t, id);
        vm.warp(t.timing.judgeBy);
        rules.triggerFallback(t);
        vm.warp(uint256(t.timing.fallbackBy) - 1);
        H.Decision memory esc = _beaconDecision(id, H.ROLE_FALLBACK, H.OUTCOME_ESCALATE, t.timing.judgeBy);
        rules.decide(t, _signDecision(t, id, esc, fallbackAdj, FB_PK), _noDelivery(), "");
        uint64 t1 = uint64(block.timestamp);
        assertEq(uint8(_stage(id)), uint8(IHoldbackRules.Stage.Escalated));

        uint256 last = uint256(t1) + t.timing.appealDecideSec - 1;
        assertEq(last + 2, uint256(_pi(t).authorizationExpiry), "the last decision second is two before the expiry");
        vm.warp(last);
        uint256 before = usdc.balanceOf(seller);
        rules.decide(t, _appealDecision(t, id, H.OUTCOME_ACCEPT, t1), _noDelivery(), "");
        assertEq(usdc.balanceOf(seller) - before, PRICE, "the last possible accept still pays the seller");
        assertEq(usdc.balanceOf(appealAdj), FEE, "and the appeal adjudicator its fee");
    }

    // ------------------------------------------------------------ the outcome check

    /// No decision reaches the code that acts on its outcome without `H.isValidOutcome`: an escalation by the appeal
    /// adjudicator, and an outcome above the three for any role, revert in `decide` before `_firstInstance` or
    /// `_escalationDecision` runs. Without the check each would be read as a reject (`HoldbackRules.sol`,
    /// `_firstInstance` and `_escalationDecision`: anything but an accept refunds).
    function test_r11_outcomeCheck_stopsWhatWouldReadAsAReject() public {
        (H.Terms memory t, bytes32 id) = _funded();
        _deliver(t, id);
        H.Decision memory bad = _signDecision(t, id, _decision(H.ROLE_PRIMARY, 3), adjudicator, ADJ_PK);
        vm.expectRevert(IHoldbackRules.InvalidMessage.selector);
        rules.decide(t, bad, _noDelivery(), "");

        rules.decide(t, _primary(t, id, H.OUTCOME_ESCALATE), _noDelivery(), "");
        uint64 at = uint64(block.timestamp);
        vm.warp(at + 1);
        for (uint8 outcome = 2; outcome < 5; ++outcome) {
            H.Decision memory m = _beaconDecision(id, H.ROLE_APPEAL, outcome, at + 1);
            m = _signDecision(t, id, m, appealAdj, AP_PK);
            vm.expectRevert(IHoldbackRules.InvalidMessage.selector);
            rules.decide(t, m, _noDelivery(), "");
        }
        assertEq(uint8(_stage(id)), uint8(IHoldbackRules.Stage.Escalated), "nothing moved");
        assertEq(usdc.balanceOf(escrow.getTokenStore(address(rules))), PRICE + FEE);
    }

    // ------------------------------------------------------------ recorded findings, as the contract stands

    /// Finding (Low): the state model's register (section 8.3, rows 2 to 4) gives the three dispute fields the verdict
    /// "enforce: refuse nonzero"; `agreeAndFund` compares none of them. The schema forbids them in this settlement
    /// mode and core encodes their absence as 0, so such terms reach the contract only when sent to it directly, and
    /// the deal then has an ID no operator can rebuild. No money moves outside the terms.
    function test_r11_issue_disputeFieldsAreSignedAndNotRefused() public {
        H.Terms memory t = _terms();
        t.timing.disputeBy = t.timing.fallbackBy + 1;
        t.timing.disputeJudgeSec = 2;
        t.timing.disputeFallbackSec = 3;
        bytes32 id = _fund(t);
        assertEq(uint8(_stage(id)), uint8(IHoldbackRules.Stage.Held), "terms with dispute fields fund");
    }

    /// Finding (Info): the register's row 11 gives a primary's beacon fields the verdict "enforce empty"; `decide`
    /// reads them for the fallback and the appeal adjudicator only. A primary can sign beacon data nobody proved.
    function test_r11_issue_primaryDecisionMayCarryUnprovenBeaconFields() public {
        (H.Terms memory t, bytes32 id) = _funded();
        _deliver(t, id);
        H.Decision memory m = _decision(H.ROLE_PRIMARY, H.OUTCOME_ACCEPT);
        m.beaconSourceHash = keccak256("drand-quicknet");
        m.beaconRound = 123;
        m.beaconValue = keccak256("not a beacon value");
        m.beaconSignature = hex"deadbeef";
        rules.decide(t, _signDecision(t, id, m, adjudicator, ADJ_PK), _noDelivery(), "");
        assertEq(uint8(_stage(id)), uint8(IHoldbackRules.Stage.Released), "accepted with beacon fields nothing checked");
    }

    /// Finding (Low): a call that carries the buyer's envelope publishes it in its calldata whether or not it lands.
    /// Here a settlement both parties signed, with `releaseKey`, is sent when the default is due; the default lands
    /// first (anyone may send it), the settlement reverts, and the buyer has the whole hold back. The envelope was in
    /// the reverted call's input. The contract's guarantee is about its `KeyReleased` event, which is not emitted.
    function test_r11_issue_dueDefaultBeatsASettlementThatCarriesTheKey() public {
        (H.Terms memory t, bytes32 id) = _funded();
        (H.Delivery memory d, H.KeyProof memory k) = _delivery();
        uint64 at = _escalateByPrimary(t, id);
        H.Payout[] memory p = new H.Payout[](1);
        p[0] = H.Payout(seller, PRICE);
        H.Mutual memory m = _mutual(t, id, p, true, hx.delivery(id, d));

        // Before the deadline the settlement would land: the seller is paid and the key leaves with the payment.
        uint256 snap = vm.snapshotState();
        rules.mutualSettle(t, m, d, k);
        assertEq(uint8(_stage(id)), uint8(IHoldbackRules.Stage.Settled));
        vm.revertToState(snap);

        // At the deadline a stranger's default and the settlement are both valid to send; the default is first.
        vm.warp(uint256(at) + t.timing.appealDecideSec);
        uint256 before = usdc.balanceOf(buyer);
        vm.prank(makeAddr("stranger"));
        rules.triggerDefault(t);
        vm.recordLogs();
        vm.expectRevert(abi.encodeWithSelector(IHoldbackRules.WrongStage.selector, IHoldbackRules.Stage.Refunded));
        rules.mutualSettle(t, m, d, k);
        assertEq(vm.getRecordedLogs().length, 0, "no KeyReleased: the settlement reverted");
        assertEq(usdc.balanceOf(buyer) - before, PRICE + FEE, "the buyer has the whole hold back");
        assertEq(usdc.balanceOf(seller), 1_000_000_000, "the seller was paid nothing");
    }

    // ------------------------------------------------------------ the second family's claims, checked

    /// The second family's claim q14 C4 (rated High there): a stranger uses the buyer's funding authorization at the
    /// token directly, the tokens land in the collector, and the hold can never be made. It does not hold: ERC-3009's
    /// receive authorization can be used only by its payee, the collector, and the collector only by the escrow
    /// (`TokenCollector.sol:43`). The suite's token, the Sepolia test token and the local one all keep that rule
    /// (`TestUSDC.t.sol`, `LocalUSDC.t.sol`). The funding still lands afterwards.
    function test_r11_second_strangerCannotUseTheFundingAuthorization() public {
        H.Terms memory t = _terms();
        AuthCaptureEscrow.PaymentInfo memory pi = _pi(t);
        H.Funding memory f = _erc3009(t, BUYER_PK);
        bytes32 nonce = _payerAgnosticHash(pi);
        vm.prank(makeAddr("stranger"));
        vm.expectRevert(bytes("MockERC3009: caller must be the payee"));
        usdc.receiveWithAuthorization(
            buyer, address(collector3009), pi.maxAmount, 0, pi.preApprovalExpiry, nonce, f.signature
        );
        assertEq(usdc.balanceOf(address(collector3009)), 0, "nothing reached the collector");
        bytes32 id = _fund(t);
        assertEq(uint8(_stage(id)), uint8(IHoldbackRules.Stage.Held), "the funding still lands");
    }

    /// The second family's claim q06 C4 (rated Medium there): a delivery can hold two envelopes addressed to the buyer,
    /// and whoever relays the early accept chooses which one the contract releases. It holds as a fact of the
    /// contract: the key proof takes any entry of the delivery's key list that is addressed to the buyer
    /// (`_requireKeyProof`). It is the buyer's check before it signs: the reference verifier refuses a delivery with
    /// more than one envelope for the buyer (`examples/verify.ts`, "more than one envelope for you").
    function test_r11_second_twoBuyerEnvelopes_theRelayerChoosesWhichIsReleased() public {
        (H.Terms memory t, bytes32 id) = _funded();
        H.KeyProof memory good = _buyerKey();
        H.KeyProof memory junk = _buyerKey();
        junk.ciphertext = "junk";
        bytes32[] memory hashes = new bytes32[](3);
        hashes[0] = hx.key(buyer, junk);
        hashes[1] = hx.key(buyer, good);
        hashes[2] = keccak256("fallback envelope");
        good.keyHashes = hashes;
        junk.keyHashes = hashes;
        junk.index = 0;
        H.Delivery memory d = H.Delivery({
            attempt: 1,
            ciphertextHash: keccak256("ciphertext"),
            plaintextSha256Hash: keccak256("sha256:plain"),
            plaintextMimeHash: keccak256("text/csv"),
            encryptedKeysHash: keccak256(abi.encodePacked(hashes)),
            submittedAt: 1_790_000_000
        });
        H.EarlyAccept memory m = H.EarlyAccept({
            attempt: 1,
            deliveryHash: hx.delivery(id, d),
            nonce: keccak256("early"),
            expiresAt: type(uint64).max,
            signature: ""
        });
        m.signature = _sign(BUYER_PK, hx.early(id, t.buyer, m));

        vm.expectEmit(true, true, false, true, address(rules));
        emit IHoldbackRules.KeyReleased(id, buyer, rules.KEY_EARLY_ACCEPT(), junk.scheme, "junk");
        rules.earlyAccept(t, m, d, _deliverySig(id, d, SELLER_PK), junk);
        assertEq(uint8(_stage(id)), uint8(IHoldbackRules.Stage.Released), "paid, with the envelope the relayer chose");
    }
}
