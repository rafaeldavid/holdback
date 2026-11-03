// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {HoldbackRules} from "../../src/HoldbackRules.sol";
import {HoldbackTypes as H} from "../../src/HoldbackTypes.sol";
import {LocalMulticall3} from "../../script/LocalMulticall3.sol";
import {LocalUSDC} from "../../script/LocalUSDC.sol";
import {Base} from "../unit/Base.sol";

/// Red-team cross-check of PA-M2's framing and fix. The operator-fee bundle (ADR-0023 EVM amendment) is atomic only
/// in the sense that both legs land together when it lands. Each leg is independently valid, so either can be
/// copied out of the mempool:
/// - the fee leg alone (PA-M2): the fee is paid, the deal is not funded through that node;
/// - the fund leg alone (not in the review): the deal is funded, the fee is not paid, and the node can still
///   submit the fee leg on its own until fundBy. On real USDC the buyer can race it with `cancelAuthorization`,
///   which LocalUSDC does not model, and which also makes `authorizationState` an unsafe "fee was paid" signal.
contract BundleAtomicityTest is Base {
    bytes32 internal constant TRANSFER_WITH_AUTHORIZATION_TYPEHASH =
        0x7c7c6cdb67a18743f49ec6fa9b35f50d52ed05cbed4cc592e13b44501c1a2267;
    uint256 internal constant OPERATOR_FEE = 2_600;

    LocalMulticall3 internal mc;
    address internal operatorFeeTo;

    function setUp() public override {
        super.setUp();
        usdc = new LocalUSDC();
        usdc.mint(buyer, 1_000_000_000);
        _bond(adjudicator, BOND);
        mc = new LocalMulticall3();
        operatorFeeTo = makeAddr("operator fee");
    }

    function _legs(H.Terms memory t, bytes32 id)
        internal
        view
        returns (bytes memory feeCall, bytes memory fundCall, bytes memory bundle)
    {
        bytes32 nonce = keccak256(abi.encode(id, "operator_fee"));
        bytes32 structHash = keccak256(
            abi.encode(
                TRANSFER_WITH_AUTHORIZATION_TYPEHASH,
                buyer,
                operatorFeeTo,
                OPERATOR_FEE,
                uint256(0),
                uint256(t.timing.fundBy),
                nonce
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", usdc.DOMAIN_SEPARATOR(), structHash));
        feeCall = abi.encodeCall(
            LocalUSDC.transferWithAuthorization,
            (buyer, operatorFeeTo, OPERATOR_FEE, 0, uint256(t.timing.fundBy), nonce, _signRaw(BUYER_PK, digest))
        );
        fundCall = abi.encodeCall(
            HoldbackRules.agreeAndFund,
            (t, _sellerSig(t, SELLER_PK), _acceptance(t, ADJ_PK), _agree(t, BUYER_PK), _erc3009(t, BUYER_PK))
        );
        LocalMulticall3.Call3[] memory calls = new LocalMulticall3.Call3[](2);
        calls[0] = LocalMulticall3.Call3({target: address(usdc), allowFailure: false, callData: feeCall});
        calls[1] = LocalMulticall3.Call3({target: address(rules), allowFailure: false, callData: fundCall});
        bundle = abi.encodeCall(LocalMulticall3.aggregate3, (calls));
    }

    /// A watcher copies the fund leg alone: the deal funds without the fee; the node's bundle reverts; the node can
    /// still collect the fee by sending the fee leg alone before fundBy.
    function test_attack_copyTheFundLegAlone_dealFundsWithoutTheFee_nodeCollectsLater() public {
        H.Terms memory t = _terms();
        bytes32 id = hx.id(t);
        (bytes memory feeCall, bytes memory fundCall, bytes memory bundle) = _legs(t, id);

        vm.prank(makeAddr("watcher"));
        (bool ok,) = address(rules).call(fundCall);
        assertTrue(ok, "the fund leg is callable by anyone");
        assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.Held));
        assertEq(usdc.balanceOf(operatorFeeTo), 0, "no fee was paid");

        vm.prank(relayer);
        (ok,) = address(mc).call(bundle);
        assertFalse(ok, "the bundle reverts on WrongStage");

        // The node still has a valid fee authorization until fundBy.
        vm.prank(relayer);
        (ok,) = address(usdc).call(feeCall);
        assertTrue(ok);
        assertEq(usdc.balanceOf(operatorFeeTo), OPERATOR_FEE);

        // After fundBy it is gone.
        H.Terms memory t2 = _terms();
        (bytes memory feeCall2,,) = _legs(t2, hx.id(t2));
        vm.warp(t2.timing.fundBy);
        (ok,) = address(usdc).call(feeCall2);
        assertFalse(ok, "the fee authorization expires at fundBy");
    }

    /// PA-M2's proposed detection reads `authorizationState(buyer, feeNonce)`. On FiatTokenV2 that flag is also set
    /// by the buyer's `cancelAuthorization` with no payment, so the node must confirm the transfer itself. And the
    /// local token cannot exercise the detection at all: LocalUSDC keeps transferWithAuthorization nonces in its own
    /// private map, which `authorizationState` (inherited from the receive-with-authorization mock) never reads.
    function test_attack_feeNonceSpent_butLocalUsdcAuthorizationStateSaysUnspent() public {
        H.Terms memory t = _terms();
        bytes32 id = hx.id(t);
        (bytes memory feeCall,,) = _legs(t, id);
        bytes32 nonce = keccak256(abi.encode(id, "operator_fee"));
        (, bytes memory before) =
            address(usdc).staticcall(abi.encodeWithSignature("authorizationState(address,bytes32)", buyer, nonce));
        vm.prank(makeAddr("griefer"));
        (bool ok,) = address(usdc).call(feeCall);
        assertTrue(ok);
        (, bytes memory after_) =
            address(usdc).staticcall(abi.encodeWithSignature("authorizationState(address,bytes32)", buyer, nonce));
        // LocalUSDC tracks transferWithAuthorization nonces in a private mapping that `authorizationState` does not
        // read (it reads the receive-with-authorization map), so the detection the review proposes cannot even be
        // exercised against the local token.
        assertEq(abi.decode(before, (bool)), false);
        assertEq(
            abi.decode(after_, (bool)), false, "LocalUSDC.authorizationState does not see transferWithAuthorization"
        );
    }
}
