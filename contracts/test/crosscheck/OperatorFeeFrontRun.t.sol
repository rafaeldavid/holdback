// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {HoldbackRules} from "../../src/HoldbackRules.sol";
import {HoldbackTypes as H} from "../../src/HoldbackTypes.sol";
import {LocalMulticall3} from "../../script/LocalMulticall3.sol";
import {LocalUSDC} from "../../script/LocalUSDC.sol";
import {Base} from "../unit/Base.sol";

/// Public-audit cross-check, class "ERC-3009 transferWithAuthorization front-running" (EIP-3009 security
/// considerations: a contract that calls transferWithAuthorization can be front-run with the same authorization;
/// receiveWithAuthorization, which requires the caller to be the payee, is the fix). The CPP collector uses
/// receiveWithAuthorization for the hold. The operator-fee bundle (ADR-0023, packages/settlement/evm/evm-settlement.ts)
/// calls transferWithAuthorization through Multicall3, with allowFailure false on both legs, and the fee nonce is fixed
/// per commitment, keccak256(abi.encode(commitmentId, "operator_fee")).
contract OperatorFeeFrontRunTest is Base {
    bytes32 internal constant TRANSFER_WITH_AUTHORIZATION_TYPEHASH =
        0x7c7c6cdb67a18743f49ec6fa9b35f50d52ed05cbed4cc592e13b44501c1a2267;
    uint256 internal constant OPERATOR_FEE = 2_600; // 1 bp of the price, ADR-0023

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

    /// The bundle the EVM settlement adapter sends: [fee transferWithAuthorization, agreeAndFund], neither may fail.
    function _bundle(H.Terms memory t, bytes32 id) internal view returns (bytes memory feeCall, bytes memory bundle) {
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
        bytes memory fundCall = abi.encodeCall(
            HoldbackRules.agreeAndFund,
            (t, _sellerSig(t, SELLER_PK), _acceptance(t, ADJ_PK), _agree(t, BUYER_PK), _erc3009(t, BUYER_PK))
        );
        LocalMulticall3.Call3[] memory calls = new LocalMulticall3.Call3[](2);
        calls[0] = LocalMulticall3.Call3({target: address(usdc), allowFailure: false, callData: feeCall});
        calls[1] = LocalMulticall3.Call3({target: address(rules), allowFailure: false, callData: fundCall});
        bundle = abi.encodeCall(LocalMulticall3.aggregate3, (calls));
    }

    function test_defense_bundleFundsAndPaysTheFee() public {
        H.Terms memory t = _terms();
        bytes32 id = hx.id(t);
        (, bytes memory bundle) = _bundle(t, id);
        vm.prank(relayer);
        (bool ok,) = address(mc).call(bundle);
        assertTrue(ok);
        assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.Held));
        assertEq(usdc.balanceOf(operatorFeeTo), OPERATOR_FEE);
    }

    /// Anyone who sees the bundle in the mempool submits the fee leg alone. The fee is paid as the buyer signed, but the
    /// bundle reverts, now and on every retry, because the nonce is spent and cannot change for this commitment. The
    /// deal funds only through a submission without the fee leg (another operator or direct submission, ADR-0005).
    function test_attack_frontRunFeeLeg_bundleRevertsForever_feePaid_dealUnfunded() public {
        H.Terms memory t = _terms();
        bytes32 id = hx.id(t);
        (bytes memory feeCall, bytes memory bundle) = _bundle(t, id);

        vm.prank(makeAddr("griefer"));
        (bool ok,) = address(usdc).call(feeCall);
        assertTrue(ok, "the fee leg is callable by anyone");
        assertEq(usdc.balanceOf(operatorFeeTo), OPERATOR_FEE);

        for (uint256 i; i < 2; ++i) {
            vm.prank(relayer);
            (ok,) = address(mc).call(bundle);
            assertFalse(ok, "the bundle reverts on the spent fee nonce");
        }
        assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.None));

        _fund(t);
        assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.Held), "funding without the fee leg still works");
    }
}
