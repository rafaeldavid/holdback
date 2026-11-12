// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {AuthCaptureEscrow} from "commerce-payments/AuthCaptureEscrow.sol";
import {MockERC3009Token} from "commerce-payments-test/mocks/MockERC3009Token.sol";
import {HoldbackRules} from "../../src/HoldbackRules.sol";
import {HoldbackTypes as H} from "../../src/HoldbackTypes.sol";
import {TestUSDC} from "../../script/TestUSDC.sol";
import {SwitchWallet} from "../crosscheck/ContractSigners.sol";
import {Base} from "./Base.sol";

/// @title The buyer's payment address and the seller's payout address (T-358, ADR-0033)
/// @notice The terms name four addresses for the parties. `buyer` and `seller` sign; `buyerPaymentAddress` is the
///         escrow's payer (it funds the hold and receives every refund) and `sellerPayoutAddress` its receiver (it
///         receives every payment to the seller). Unless a test says otherwise, all four differ here, and each test
///         checks that the signing addresses' balances do not move. The numbers in the test names follow ADR-0033
///         section 10. Failed before: the parent (`test/differential/parent/`) paid and refunded `seller` and
///         `buyer` and took the funding from `buyer`, so every test below with the addresses apart failed there.
contract TwoAddressesTest is Base {
    uint256 internal constant PAY_PK = 0xBA1D;
    bytes32 internal constant SETTLEMENT_ADDRESSES = keccak256("SettlementAddresses(bytes32,address,address)");
    bytes32 internal constant JOB_CREATED = keccak256("JobCreated(bytes32,address,address,address,uint256)");
    bytes32 internal constant JOB_FUNDED = keccak256("JobFunded(bytes32,address,uint256)");
    bytes32 internal constant PAYMENT_RELEASED = keccak256("PaymentReleased(bytes32,address,uint256)");
    bytes32 internal constant REFUNDED = keccak256("Refunded(bytes32,address,uint256)");

    address internal pay;
    address internal payout;

    struct Bal {
        uint256 buyer;
        uint256 seller;
        uint256 pay;
        uint256 payout;
    }

    function setUp() public override {
        super.setUp();
        pay = vm.addr(PAY_PK);
        payout = makeAddr("payout address");
        usdc.mint(pay, 1_000_000_000);
    }

    // ------------------------------------------------------------ builders

    function _apart() internal returns (H.Terms memory t) {
        t = _terms();
        (t.buyerPaymentAddress, t.sellerPayoutAddress) = (pay, payout);
    }

    function _fundWith(H.Terms memory t, uint256 payPk) internal returns (bytes32 id) {
        vm.prank(relayer);
        id = rules.agreeAndFund(
            t, _sellerSig(t, SELLER_PK), _acceptance(t, ADJ_PK), _agree(t, BUYER_PK), _erc3009(t, payPk)
        );
    }

    function _fundedApart() internal returns (H.Terms memory t, bytes32 id, Bal memory b0) {
        t = _apart();
        b0 = _bal();
        id = _fundWith(t, PAY_PK);
    }

    function _bal() internal view returns (Bal memory b) {
        b = Bal(usdc.balanceOf(buyer), usdc.balanceOf(seller), usdc.balanceOf(pay), usdc.balanceOf(payout));
    }

    /// The deal moved `toPayout` to the payout address and `toPay` net to the payment address, counted from before
    /// funding (so the payment address is down `PRICE + FEE - toPay`), and nothing to or from the signing addresses.
    function _moved(Bal memory b0, uint256 toPayout, uint256 toPay) internal view {
        Bal memory b = _bal();
        assertEq(b.buyer, b0.buyer, "the buyer's signing address holds what it held");
        assertEq(b.seller, b0.seller, "the seller's signing address holds what it held");
        assertEq(b.payout - b0.payout, toPayout, "the payout address received");
        assertEq(b0.pay - b.pay, PRICE + FEE - toPay, "the payment address paid in and got back");
    }

    function _toFallback(H.Terms memory t, bytes32 id) internal {
        _deliver(t, id);
        vm.warp(t.timing.judgeBy);
        rules.triggerFallback(t);
    }

    function _fallbackDecides(H.Terms memory t, bytes32 id, uint8 outcome) internal {
        H.Decision memory m = _beaconDecision(id, H.ROLE_FALLBACK, outcome, t.timing.judgeBy);
        rules.decide(t, _signDecision(t, id, m, fallbackAdj, FB_PK), _noDelivery(), "");
    }

    function _escalate(H.Terms memory t, bytes32 id) internal returns (uint64 at) {
        _deliver(t, id);
        rules.decide(t, _primary(t, id, H.OUTCOME_ESCALATE), _noDelivery(), "");
        at = uint64(block.timestamp);
    }

    function _appealDecides(H.Terms memory t, bytes32 id, uint64 at, uint8 outcome) internal {
        vm.warp(at + 1);
        H.Decision memory m = _beaconDecision(id, H.ROLE_APPEAL, outcome, at + 1);
        rules.decide(t, _signDecision(t, id, m, appealAdj, AP_PK), _noDelivery(), "");
    }

    function _mutual(H.Terms memory t, bytes32 id, H.Payout[] memory payouts) internal view returns (H.Mutual memory m) {
        m.payouts = payouts;
        m.expiresAt = type(uint64).max;
        bytes32 h = hx.mutual(id, t.token, m);
        m.buyerSignature = _sign(BUYER_PK, h);
        m.sellerSignature = _sign(SELLER_PK, h);
    }

    function _two(address a, uint256 x, address b, uint256 y) internal pure returns (H.Payout[] memory p) {
        p = new H.Payout[](2);
        (p[0], p[1]) = (H.Payout(a, x), H.Payout(b, y));
    }

    function _expiry(H.Terms memory t) internal pure returns (uint256) {
        return uint256(t.timing.fallbackBy) + t.timing.appealDecideSec + MARGIN;
    }

    // ------------------------------------------------------------ where each outcome pays (tests 1 to 9)

    function test_01_primaryAccept_paysThePayoutAddress() public {
        (H.Terms memory t, bytes32 id, Bal memory b0) = _fundedApart();
        _deliver(t, id);
        rules.decide(t, _primary(t, id, H.OUTCOME_ACCEPT), _noDelivery(), "");
        _moved(b0, PRICE, 0);
        assertEq(usdc.balanceOf(adjudicator), FEE, "the fee to the primary");
    }

    function test_02_primaryReject_refundsThePaymentAddress() public {
        (H.Terms memory t, bytes32 id, Bal memory b0) = _fundedApart();
        _deliver(t, id);
        rules.decide(t, _primary(t, id, H.OUTCOME_REJECT), _noDelivery(), "");
        _moved(b0, 0, PRICE);
        assertEq(usdc.balanceOf(adjudicator), FEE, "the fee to the primary");
    }

    function test_03_earlyAccept_paysPayout_feeBackToPayment() public {
        (H.Terms memory t, bytes32 id, Bal memory b0) = _fundedApart();
        (H.Delivery memory d, H.KeyProof memory k) = _deliver(t, id);
        rules.earlyAccept(t, _early(t, id, BUYER_PK), d, "", k);
        _moved(b0, PRICE, FEE);
    }

    function test_04_reclaim_refundsPriceAndFeeToPayment() public {
        (H.Terms memory t,, Bal memory b0) = _fundedApart();
        vm.warp(t.timing.deliverBy);
        rules.reclaim(t);
        _moved(b0, 0, PRICE + FEE);
    }

    function test_04_defaultFromTheFallbacksTurn_refundsPayment() public {
        (H.Terms memory t, bytes32 id, Bal memory b0) = _fundedApart();
        _toFallback(t, id);
        vm.warp(t.timing.fallbackBy);
        rules.triggerDefault(t);
        _moved(b0, 0, PRICE + FEE);
    }

    function test_04_defaultAfterAnEscalation_refundsPayment() public {
        (H.Terms memory t, bytes32 id, Bal memory b0) = _fundedApart();
        uint64 at = _escalate(t, id);
        vm.warp(uint256(at) + t.timing.appealDecideSec);
        rules.triggerDefault(t);
        _moved(b0, 0, PRICE + FEE);
    }

    function test_05_escalationMovesNothing_thenAcceptPaysPayout() public {
        (H.Terms memory t, bytes32 id, Bal memory b0) = _fundedApart();
        uint64 at = _escalate(t, id);
        _moved(b0, 0, 0);
        _appealDecides(t, id, at, H.OUTCOME_ACCEPT);
        _moved(b0, PRICE, 0);
        assertEq(usdc.balanceOf(appealAdj), FEE, "the fee to the appeal adjudicator");
    }

    function test_05_escalationThenReject_refundsPayment() public {
        (H.Terms memory t, bytes32 id, Bal memory b0) = _fundedApart();
        uint64 at = _escalate(t, id);
        _appealDecides(t, id, at, H.OUTCOME_REJECT);
        _moved(b0, 0, PRICE);
        assertEq(usdc.balanceOf(appealAdj), FEE, "the fee to the appeal adjudicator");
    }

    function test_06_fallbackAccept_paysPayout() public {
        (H.Terms memory t, bytes32 id, Bal memory b0) = _fundedApart();
        _toFallback(t, id);
        _fallbackDecides(t, id, H.OUTCOME_ACCEPT);
        _moved(b0, PRICE, 0);
        assertEq(usdc.balanceOf(fallbackAdj), FEE);
    }

    function test_06_fallbackReject_refundsPayment() public {
        (H.Terms memory t, bytes32 id, Bal memory b0) = _fundedApart();
        _toFallback(t, id);
        _fallbackDecides(t, id, H.OUTCOME_REJECT);
        _moved(b0, 0, PRICE);
        assertEq(usdc.balanceOf(fallbackAdj), FEE);
    }

    function test_07_mutualSettlement_sharesToPayoutAndPayment() public {
        (H.Terms memory t, bytes32 id, Bal memory b0) = _fundedApart();
        uint256 share = PRICE / 4;
        H.Mutual memory m = _mutual(t, id, _two(payout, share, pay, PRICE - share));
        rules.mutualSettle(t, m, _noDelivery(), _buyerKey());
        _moved(b0, share, PRICE - share + FEE);
        assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.Settled));
    }

    function test_08_settlementToTheSigningSeller_reverts() public {
        (H.Terms memory t, bytes32 id,) = _fundedApart();
        H.Mutual memory m = _mutual(t, id, _two(seller, PRICE / 2, pay, PRICE - PRICE / 2));
        vm.expectRevert(HoldbackRules.InvalidMessage.selector);
        rules.mutualSettle(t, m, _noDelivery(), _buyerKey());
    }

    function test_08_settlementToTheSigningBuyer_reverts() public {
        (H.Terms memory t, bytes32 id,) = _fundedApart();
        H.Mutual memory m = _mutual(t, id, _two(payout, PRICE / 2, buyer, PRICE - PRICE / 2));
        vm.expectRevert(HoldbackRules.InvalidMessage.selector);
        rules.mutualSettle(t, m, _noDelivery(), _buyerKey());
    }

    /// With one address for both money roles, every payout counts as the seller's share (checked first): one capture
    /// of the price, `PaymentReleased` reports it all, and the void returns the fee to the same address.
    function test_09_paymentEqualsPayout_everyPayoutIsCaptured() public {
        H.Terms memory t = _terms();
        (t.buyerPaymentAddress, t.sellerPayoutAddress) = (pay, pay);
        uint256 p0 = usdc.balanceOf(pay);
        bytes32 id = _fundWith(t, PAY_PK);
        H.Mutual memory m = _mutual(t, id, _two(pay, PRICE / 2, pay, PRICE - PRICE / 2));
        vm.recordLogs();
        rules.mutualSettle(t, m, _noDelivery(), _buyerKey());
        (uint256 released, uint256 refunded) = _amounts(vm.getRecordedLogs());
        assertEq(released, PRICE, "PaymentReleased reports every payout");
        assertEq(refunded, FEE, "the fee is voided back");
        assertEq(usdc.balanceOf(pay), p0, "the one address holds P + F again");
    }

    function _amounts(Vm.Log[] memory logs) internal view returns (uint256 released, uint256 refunded) {
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].emitter != address(rules)) continue;
            if (logs[i].topics[0] == PAYMENT_RELEASED) released += abi.decode(logs[i].data, (uint256));
            if (logs[i].topics[0] == REFUNDED) refunded += abi.decode(logs[i].data, (uint256));
        }
    }

    // ------------------------------------------------------------ who can fund (tests 10, 11, 23)

    function test_10_theBuyersSigningKeyCannotFund() public {
        H.Terms memory t = _apart();
        Bal memory b0 = _bal();
        bytes memory ss = _sellerSig(t, SELLER_PK);
        H.Acceptance memory acc = _acceptance(t, ADJ_PK);
        H.Agree memory ag = _agree(t, BUYER_PK);
        H.Funding memory byBuyer = _erc3009(t, BUYER_PK); // the right nonce, signed by the signing key
        vm.expectRevert("MockERC3009: invalid signature");
        rules.agreeAndFund(t, ss, acc, ag, byBuyer);
        assertEq(uint8(_stage(hx.id(t))), uint8(HoldbackRules.Stage.None), "nothing stored");
        _moved(b0, 0, PRICE + FEE);
    }

    function test_11_anAuthorizationForAnotherDeal_doesNotFundThisOne() public {
        H.Terms memory a = _apart();
        H.Terms memory b = _apart(); // another nonce, so another ID and another ERC-3009 nonce
        H.Funding memory forA = _erc3009(a, PAY_PK);
        bytes memory ss = _sellerSig(b, SELLER_PK);
        H.Acceptance memory acc = _acceptance(b, ADJ_PK);
        H.Agree memory ag = _agree(b, BUYER_PK);
        vm.expectRevert("MockERC3009: invalid signature");
        rules.agreeAndFund(b, ss, acc, ag, forA);
        // The right one funds once; the same authorization again finds the deal funded.
        H.Funding memory f = _erc3009(b, PAY_PK);
        rules.agreeAndFund(b, ss, acc, ag, f);
        vm.expectRevert(abi.encodeWithSelector(HoldbackRules.WrongStage.selector, HoldbackRules.Stage.Held));
        rules.agreeAndFund(b, ss, acc, ag, f);
    }

    /// Another operator contract on the same escrow and collector cannot redeem a funding signed for a Crow deal: its
    /// payment record names another operator, so another ERC-3009 nonce.
    function test_23_anotherOperator_cannotRedeemTheFunding() public {
        H.Terms memory t = _apart();
        H.Funding memory f = _erc3009(t, PAY_PK);
        HoldbackRules other = new HoldbackRules(escrow, address(collector3009), MARGIN, sim, address(usdc), _beaconMargin());
        HoldbackRules ours = rules;
        rules = other; // Base's signers sign under `rules`' domain
        bytes memory ss = _sellerSig(t, SELLER_PK);
        H.Acceptance memory acc = _acceptance(t, ADJ_PK);
        H.Agree memory ag = _agree(t, BUYER_PK);
        vm.expectRevert("MockERC3009: invalid signature");
        other.agreeAndFund(t, ss, acc, ag, f);
        rules = ours;
        _fundWith(t, PAY_PK); // the same signature funds the deal it was made for
    }

    // ------------------------------------------------------------ the commitment ID (test 12)

    function test_12_changingEitherAddress_changesTheId() public {
        H.Terms memory t = _apart();
        bytes32 id = hx.id(t);
        bytes memory oldSig = _sellerSig(t, SELLER_PK);
        H.Terms memory u = _copy(t);
        u.sellerPayoutAddress = makeAddr("another payout address");
        assertTrue(hx.id(u) != id, "a new payout address, a new ID");
        H.Terms memory w = _copy(t);
        w.buyerPaymentAddress = buyer;
        assertTrue(hx.id(w) != id, "a new payment address, a new ID");
        H.Acceptance memory acc = _acceptance(u, ADJ_PK);
        H.Agree memory ag = _agree(u, BUYER_PK);
        H.Funding memory f = _erc3009(u, PAY_PK);
        vm.expectRevert(HoldbackRules.BadSignature.selector);
        rules.agreeAndFund(u, oldSig, acc, ag, f);
    }

    function _copy(H.Terms memory t) internal pure returns (H.Terms memory u) {
        u = abi.decode(abi.encode(t), (H.Terms));
    }

    // ------------------------------------------------------------ after the escrow's expiry (test 14)

    function test_14_afterExpiry_onlyThePaymentAddressReclaims_andTheDealCloses() public {
        (H.Terms memory t, bytes32 id, Bal memory b0) = _fundedApart();
        vm.warp(_expiry(t));
        AuthCaptureEscrow.PaymentInfo memory pi = _pi(t);
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(AuthCaptureEscrow.InvalidSender.selector, buyer, pay));
        escrow.reclaim(pi);
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(AuthCaptureEscrow.InvalidSender.selector, relayer, pay));
        escrow.reclaim(pi);
        vm.prank(pay);
        escrow.reclaim(pi);
        _moved(b0, 0, PRICE + FEE);
        rules.reclaim(t);
        assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.Refunded), "the deal still closes");
        _moved(b0, 0, PRICE + FEE);
    }

    // ------------------------------------------------------------ contract wallets (test 15)

    /// A deployed ERC-1271 wallet as the payment address funds (the token asks the wallet), is refunded, and after
    /// the escrow's expiry reclaims on the escrow itself.
    function test_15_erc1271WalletAsPaymentAddress_mockToken() public {
        _walletPays();
    }

    /// The same on `TestUSDC`, the token the Sepolia deployment serves.
    function test_15_erc1271WalletAsPaymentAddress_testUsdc() public {
        usdc = MockERC3009Token(address(new TestUSDC()));
        rules = new HoldbackRules(escrow, address(collector3009), MARGIN, sim, address(usdc), _beaconMargin());
        _walletPays();
    }

    function _walletPays() internal {
        SwitchWallet wallet = new SwitchWallet(vm.addr(PAY_PK));
        usdc.mint(address(wallet), 2 * (PRICE + FEE));
        H.Terms memory t = _terms();
        (t.buyerPaymentAddress, t.sellerPayoutAddress) = (address(wallet), payout);
        uint256 b0 = usdc.balanceOf(buyer);
        bytes32 id = _fundWith(t, PAY_PK);
        assertEq(usdc.balanceOf(address(wallet)), PRICE + FEE, "the wallet funded the hold");
        _deliver(t, id);
        rules.decide(t, _primary(t, id, H.OUTCOME_REJECT), _noDelivery(), "");
        assertEq(usdc.balanceOf(address(wallet)), PRICE + FEE + PRICE, "the price came back to the wallet");
        H.Terms memory u = _terms();
        (u.buyerPaymentAddress, u.sellerPayoutAddress) = (address(wallet), payout);
        _fundWith(u, PAY_PK);
        vm.warp(_expiry(u));
        AuthCaptureEscrow.PaymentInfo memory pi = _pi(u);
        vm.prank(address(wallet));
        escrow.reclaim(pi);
        assertEq(usdc.balanceOf(address(wallet)), 2 * (PRICE + FEE) - FEE, "reclaimed after the expiry");
        assertEq(usdc.balanceOf(buyer), b0, "the buyer's signing address never moved");
    }

    // ------------------------------------------------------------ no comparison (tests 19, 25)

    function test_19_zeroPayoutAddress_funds_andAnAcceptBurnsTheSellersShare() public {
        H.Terms memory t = _terms();
        (t.buyerPaymentAddress, t.sellerPayoutAddress) = (pay, address(0));
        bytes32 id = _fundWith(t, PAY_PK);
        _deliver(t, id);
        rules.decide(t, _primary(t, id, H.OUTCOME_ACCEPT), _noDelivery(), "");
        assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.Released), "the seller named the address; its loss");
    }

    function test_19_rulesContractAsPayout_andAllFourEqual_fund() public {
        H.Terms memory t = _terms();
        (t.buyerPaymentAddress, t.sellerPayoutAddress) = (pay, address(rules));
        _fundWith(t, PAY_PK);
        H.Terms memory u = _terms();
        (u.seller, u.buyerPaymentAddress, u.sellerPayoutAddress) = (buyer, buyer, buyer);
        vm.prank(relayer);
        rules.agreeAndFund(u, _sellerSig(u, BUYER_PK), _acceptance(u, ADJ_PK), _agree(u, BUYER_PK), _erc3009(u, BUYER_PK));
        assertEq(uint8(_stage(hx.id(u))), uint8(HoldbackRules.Stage.Held), "all four equal funds");
    }

    function test_19_zeroPaymentAddress_neverFunds() public {
        H.Terms memory t = _terms();
        t.buyerPaymentAddress = address(0);
        bytes memory ss = _sellerSig(t, SELLER_PK);
        H.Acceptance memory acc = _acceptance(t, ADJ_PK);
        H.Agree memory ag = _agree(t, BUYER_PK);
        H.Funding memory f = _erc3009(t, PAY_PK);
        vm.expectRevert();
        rules.agreeAndFund(t, ss, acc, ag, f);
        assertEq(uint8(_stage(hx.id(t))), uint8(HoldbackRules.Stage.None));
    }

    /// The token store as one deal's payout address: its accept leaves the price in the store, and a second deal
    /// still funds and settles in full (the store's surplus is no deal's hold).
    function test_25_tokenStoreAsPayout_doesNotDisturbAnotherDeal() public {
        address store = escrow.getTokenStore(address(rules));
        H.Terms memory t = _terms();
        (t.buyerPaymentAddress, t.sellerPayoutAddress) = (pay, store);
        bytes32 id = _fundWith(t, PAY_PK);
        _deliver(t, id);
        rules.decide(t, _primary(t, id, H.OUTCOME_ACCEPT), _noDelivery(), "");
        assertEq(usdc.balanceOf(store), PRICE, "stranded in the store");
        (H.Terms memory u, bytes32 j, Bal memory b0) = _fundedApart();
        _deliver(u, j);
        rules.decide(u, _primary(u, j, H.OUTCOME_REJECT), _noDelivery(), "");
        _moved(b0, 0, PRICE);
        assertEq(usdc.balanceOf(store), PRICE, "the second deal took nothing from the surplus");
    }

    // ------------------------------------------------------------ a price of 0 (test 20)

    function test_20_zeroPrice_accept_paysOnlyTheFee() public {
        H.Terms memory t = _apart();
        t.price = 0;
        Bal memory b0 = _bal();
        bytes32 id = _fundWith(t, PAY_PK);
        _deliver(t, id);
        rules.decide(t, _primary(t, id, H.OUTCOME_ACCEPT), _noDelivery(), "");
        Bal memory b = _bal();
        assertEq(b.payout, b0.payout, "the payout address gets 0");
        assertEq(b0.pay - b.pay, FEE, "the payment address paid the fee");
        assertEq(b.buyer, b0.buyer);
        assertEq(b.seller, b0.seller);
    }

    function test_20_zeroPrice_earlyAccept_returnsTheFeeToPayment() public {
        H.Terms memory t = _apart();
        t.price = 0;
        Bal memory b0 = _bal();
        bytes32 id = _fundWith(t, PAY_PK);
        (H.Delivery memory d, H.KeyProof memory k) = _deliver(t, id);
        rules.earlyAccept(t, _early(t, id, BUYER_PK), d, "", k);
        Bal memory b = _bal();
        assertEq(b.pay, b0.pay, "the fee came back to the payment address");
        assertEq(b.payout, b0.payout);
        assertEq(b.buyer, b0.buyer);
        assertEq(b.seller, b0.seller);
    }

    // ------------------------------------------------------------ events (test 21)

    function test_21_events_nameTheSigners_andSettlementAddressesNamesTheMoney() public {
        H.Terms memory t = _apart();
        vm.recordLogs();
        bytes32 id = _fundWith(t, PAY_PK);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 seen;
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].emitter != address(rules)) continue;
            bytes32 sig = logs[i].topics[0];
            if (sig == JOB_CREATED) {
                assertEq(logs[i].topics[2], bytes32(uint256(uint160(buyer))), "JobCreated names the buyer");
                assertEq(logs[i].topics[3], bytes32(uint256(uint160(seller))), "and the seller");
            } else if (sig == JOB_FUNDED) {
                assertEq(logs[i].topics[2], bytes32(uint256(uint160(buyer))), "JobFunded names the buyer");
            } else if (sig == SETTLEMENT_ADDRESSES) {
                seen++;
                assertEq(logs[i].topics[1], id);
                assertEq(logs[i].topics[2], bytes32(uint256(uint160(pay))), "the payment address");
                assertEq(logs[i].topics[3], bytes32(uint256(uint160(payout))), "the payout address");
                assertEq(logs[i].data.length, 0);
            }
        }
        assertEq(seen, 1, "SettlementAddresses once per deal");
        _deliver(t, id);
        vm.recordLogs();
        rules.decide(t, _primary(t, id, H.OUTCOME_ACCEPT), _noDelivery(), "");
        logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].emitter == address(rules) && logs[i].topics[0] == PAYMENT_RELEASED) {
                assertEq(logs[i].topics[2], bytes32(uint256(uint160(seller))), "PaymentReleased names the seller");
            }
            assertTrue(logs[i].topics[0] != SETTLEMENT_ADDRESSES, "not again after funding");
        }
    }
}
