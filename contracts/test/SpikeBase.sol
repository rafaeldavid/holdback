// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {AuthCaptureEscrow} from "commerce-payments/AuthCaptureEscrow.sol";
import {ERC3009PaymentCollector} from "commerce-payments/collectors/ERC3009PaymentCollector.sol";
import {IERC3009} from "commerce-payments/interfaces/IERC3009.sol";
import {MockERC3009Token} from "commerce-payments-test/mocks/MockERC3009Token.sol";

import {HoldbackRules} from "../src/HoldbackRules.sol";

/// Shared fixture for the T-201 spike: CPP v1.1.0 (vendored, unmodified) + a mock USDC with ERC-3009
/// + the HoldbackRules operator. Local EVM only (chain id 31337); no RPC.
abstract contract SpikeBase is Test {
    bytes32 internal constant RECEIVE_WITH_AUTHORIZATION_TYPEHASH =
        0xd099cc98ef71107a616c4f0f941f04c322d8e254fe26b3c6668db87aae413de8;
    address internal constant MULTICALL3 = 0xcA11bde05977b3631167028862bE2a173976CA11;

    AuthCaptureEscrow internal escrow;
    ERC3009PaymentCollector internal collector;
    MockERC3009Token internal usdc;
    HoldbackRules internal rules;

    uint256 internal constant BUYER_PK = 0xB0B;
    uint256 internal constant ADJ_PK = 0xA11CE;
    uint256 internal constant OTHER_PK = 0xBAD;
    address internal buyer;
    address internal seller;
    address internal adjudicator;
    address internal relayer;

    uint120 internal constant PRICE = 26_000_000; // 26 tUSD, 6 decimals
    uint120 internal constant FEE = 500_000; // 0.50 tUSD adjudication fee

    function setUp() public virtual {
        vm.chainId(31337);
        vm.warp(1_790_000_000); // 2026-09, any fixed time works
        escrow = new AuthCaptureEscrow();
        collector = new ERC3009PaymentCollector(address(escrow), MULTICALL3);
        usdc = new MockERC3009Token("Mock USDC", "mUSDC", 6);
        rules = new HoldbackRules(escrow, address(collector));

        buyer = vm.addr(BUYER_PK);
        adjudicator = vm.addr(ADJ_PK);
        seller = makeAddr("seller");
        relayer = makeAddr("relayer");
        usdc.mint(buyer, 1_000_000_000);
    }

    function _terms(bytes32 id) internal view returns (HoldbackRules.Terms memory t) {
        t = HoldbackRules.Terms({
            commitmentId: id,
            buyer: buyer,
            seller: seller,
            adjudicator: adjudicator,
            token: address(usdc),
            price: PRICE,
            adjudicationFee: FEE,
            fundBy: uint48(block.timestamp + 1 hours),
            decideBy: uint48(block.timestamp + 7 days),
            holdExpiry: uint48(block.timestamp + 10 days)
        });
    }

    /// The buyer's funding signature: an ERC-3009 ReceiveWithAuthorization to the CPP collector, whose nonce is
    /// CPP's payer-agnostic PaymentInfo hash. It therefore commits to the operator (HoldbackRules) and, through the
    /// salt, to the full Holdback terms hash.
    function _signFunding(AuthCaptureEscrow.PaymentInfo memory pi, uint256 pk) internal view returns (bytes memory) {
        address payer = pi.payer;
        pi.payer = address(0);
        bytes32 nonce = escrow.getHash(pi);
        pi.payer = payer;
        bytes32 structHash = keccak256(
            abi.encode(
                RECEIVE_WITH_AUTHORIZATION_TYPEHASH,
                payer,
                address(collector),
                uint256(pi.maxAmount),
                uint256(0),
                uint256(pi.preApprovalExpiry),
                nonce
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", IERC3009(pi.token).DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _sign(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _fund(HoldbackRules.Terms memory t) internal {
        bytes memory sig = _signFunding(rules.paymentInfoFor(t), BUYER_PK);
        vm.prank(relayer);
        rules.fund(t, sig);
    }

    function _decisionSig(HoldbackRules.Terms memory t, bool accept, uint256 pk) internal view returns (bytes memory) {
        return _sign(pk, rules.decisionDigest(rules.hashTerms(t), accept));
    }
}
