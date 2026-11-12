// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AuthCaptureEscrow} from "commerce-payments/AuthCaptureEscrow.sol";
import {MockERC3009Token} from "commerce-payments-test/mocks/MockERC3009Token.sol";

import {HoldbackRules} from "../../src/HoldbackRules.sol";
import {HoldbackTypes as H} from "../../src/HoldbackTypes.sol";
import {Base} from "./Base.sol";

/// @title SC-1: one settlement token per deployment (T-356, ADR-0031 §2)
/// @notice The token is an immutable fixed at deploy. Terms that name any other token never reach `Held`: the
///         refusal is in `agreeAndFund`, before any signature is checked and before anything moves. Every later step
///         finds the deal by the commitment ID, which hashes the terms' token, so a funded deal's terms always name
///         the deployment's token. The escrow's payment record uses the immutable.
contract SingleTokenTest is Base {
    MockERC3009Token internal other;

    function setUp() public override {
        super.setUp();
        other = new MockERC3009Token("Mock EURC", "mEURC", 6);
        other.mint(buyer, 1_000_000_000);
    }

    function test_token_isTheDeployArgument() public view {
        assertEq(rules.TOKEN(), address(usdc));
    }

    /// The refused input: terms in another ERC-3009 token, every message correctly signed for them. Before SC-1 the
    /// same call funded (`test/differential/parent/`, the side-by-side harness's SC-1 entry); now it reverts
    /// `InvalidMessage`, nothing is stored and no token moves.
    function test_otherToken_refusedAtFunding() public {
        H.Terms memory t = _terms();
        t.token = address(other);
        bytes32 id = hx.id(t);
        bytes memory ss = _sellerSig(t, SELLER_PK);
        H.Acceptance memory acc = _acceptance(t, ADJ_PK);
        H.Agree memory ag = _agree(t, BUYER_PK);
        H.Funding memory f = _erc3009(t, BUYER_PK);
        uint256 before = other.balanceOf(buyer);

        vm.expectRevert(HoldbackRules.InvalidMessage.selector);
        rules.agreeAndFund(t, ss, acc, ag, f);

        assertEq(uint8(rules.dealOf(id).stage), uint8(HoldbackRules.Stage.None), "nothing stored");
        assertEq(other.balanceOf(buyer), before, "no token moved");
        assertEq(other.balanceOf(escrow.getTokenStore(address(rules))), 0);
    }

    /// The refusal comes before the signature checks: terms in another token with a wrong seller signature still
    /// answer `InvalidMessage`, not `BadSignature`. (`InvalidMessage` also covers a non-zero `bondReserved` and an
    /// unknown funding method, so the error alone does not name the token; the EVM adapter's refusal does.)
    function test_otherToken_refusedBeforeSignatures() public {
        H.Terms memory t = _terms();
        t.token = address(other);
        H.Acceptance memory acc = _acceptance(t, ADJ_PK);
        H.Agree memory ag = _agree(t, BUYER_PK);
        H.Funding memory f = _erc3009(t, BUYER_PK);
        bytes memory wrong = _sellerSig(t, OTHER_PK);
        vm.expectRevert(HoldbackRules.InvalidMessage.selector);
        rules.agreeAndFund(t, wrong, acc, ag, f);
    }

    /// The deployment's own token still funds, and the escrow's record names the immutable token.
    function test_deploymentToken_funds() public {
        (H.Terms memory t, bytes32 id) = _funded();
        assertEq(uint8(rules.dealOf(id).stage), uint8(HoldbackRules.Stage.Held));
        AuthCaptureEscrow.PaymentInfo memory pi = _pi(t);
        assertEq(pi.token, rules.TOKEN());
        (, uint120 capturable,) = escrow.paymentState(escrow.getHash(pi));
        assertEq(capturable, PRICE + FEE);
    }

    /// A second deployment for another token is another signing domain: the messages signed for one deployment do
    /// not fund the other, even for terms in the other's token.
    function test_secondDeployment_isASeparateDomain() public {
        HoldbackRules second = new HoldbackRules(
            escrow, address(collector3009), MARGIN, sim, address(other)
        );
        H.Terms memory t = _terms();
        t.token = address(other);
        bytes memory ss = _sellerSig(t, SELLER_PK); // signed under `rules`' domain
        H.Acceptance memory acc = _acceptance(t, ADJ_PK);
        H.Agree memory ag = _agree(t, BUYER_PK);
        H.Funding memory f = _erc3009(t, BUYER_PK);
        vm.expectRevert(HoldbackRules.BadSignature.selector);
        second.agreeAndFund(t, ss, acc, ag, f);

        // Signed under its own domain, the same terms fund on the second deployment, in its token.
        rules = second;
        bytes32 id = _fund(t);
        assertEq(uint8(second.dealOf(id).stage), uint8(HoldbackRules.Stage.Held));
        (, uint120 capturable,) = escrow.paymentState(escrow.getHash(_pi(t)));
        assertEq(capturable, PRICE + FEE);
        assertEq(other.balanceOf(escrow.getTokenStore(address(second))), PRICE + FEE);
    }

    /// A step on terms whose token differs from a funded deal's is a step on another commitment ID, which was never
    /// funded: it is refused as `WrongStage(None)` and the funded deal is untouched.
    function test_laterStep_withOtherToken_findsNoDeal() public {
        (H.Terms memory t, bytes32 id) = _funded();
        H.Terms memory u = abi.decode(abi.encode(t), (H.Terms)); // a copy, not an alias
        u.token = address(other);
        vm.warp(t.timing.deliverBy);
        vm.expectRevert(abi.encodeWithSelector(HoldbackRules.WrongStage.selector, HoldbackRules.Stage.None));
        rules.reclaim(u);
        assertEq(uint8(rules.dealOf(id).stage), uint8(HoldbackRules.Stage.Held));
    }
}
