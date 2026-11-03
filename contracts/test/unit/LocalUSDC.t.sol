// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {LocalUSDC} from "../../script/LocalUSDC.sol";

/// The anvil token: FiatToken v2.2's ERC-3009 nonces (one space for receive, transfer and cancel), so the operator
/// fee's front-run defence (ADR-0023) can be tested against a cancel.
contract LocalUSDCTest is Test {
    event Transfer(address indexed from, address indexed to, uint256 amount);
    event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce);
    event AuthorizationCanceled(address indexed authorizer, bytes32 indexed nonce);

    LocalUSDC internal token;
    uint256 internal constant KEY = 0xA11CE;
    address internal alice;
    address internal constant BOB = address(0xB0B);

    function setUp() public {
        token = new LocalUSDC();
        alice = vm.addr(KEY);
        token.mint(alice, 100e6);
        vm.warp(1_800_000_000);
    }

    function _signed(uint256 key, bytes32 structHash) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(key, keccak256(abi.encodePacked("\x19\x01", token.DOMAIN_SEPARATOR(), structHash)));
        return abi.encodePacked(r, s, v);
    }

    function _sign(bytes32 typehash, address to, uint256 value, bytes32 nonce) internal view returns (bytes memory) {
        return _signed(KEY, keccak256(abi.encode(typehash, alice, to, value, 0, block.timestamp + 60, nonce)));
    }

    function _cancel(uint256 key, bytes32 nonce) internal view returns (bytes memory) {
        return _signed(key, keccak256(abi.encode(token.CANCEL_AUTHORIZATION_TYPEHASH(), alice, nonce)));
    }

    function test_metadata_typehashes_andTheMocksDomain() public view {
        assertEq(token.name(), "USD Coin");
        assertEq(token.symbol(), "USDC");
        assertEq(token.decimals(), 6);
        assertEq(
            token.TRANSFER_WITH_AUTHORIZATION_TYPEHASH(),
            keccak256(
                "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
            )
        );
        assertEq(
            token.RECEIVE_WITH_AUTHORIZATION_TYPEHASH(),
            keccak256(
                "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
            )
        );
        assertEq(token.CANCEL_AUTHORIZATION_TYPEHASH(), keccak256("CancelAuthorization(address authorizer,bytes32 nonce)"));
        // The adapter signs for { name: "USD Coin", version: "1" } on anvil (packages/settlement/evm/world.ts).
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("USD Coin"),
                keccak256("1"),
                block.chainid,
                address(token)
            )
        );
        assertEq(token.DOMAIN_SEPARATOR(), domain);
    }

    function test_transferWithAuthorization_logsTheUseBeforeTheTransfer_andSpendsTheSharedNonce() public {
        bytes32 nonce = keccak256("fee");
        bytes memory sig = _sign(token.TRANSFER_WITH_AUTHORIZATION_TYPEHASH(), BOB, 1e6, nonce);
        vm.expectEmit(address(token));
        emit AuthorizationUsed(alice, nonce);
        vm.expectEmit(address(token));
        emit Transfer(alice, BOB, 1e6);
        vm.prank(address(0xDEAD)); // anyone may relay it
        token.transferWithAuthorization(alice, BOB, 1e6, 0, block.timestamp + 60, nonce, sig);
        assertEq(token.balanceOf(BOB), 1e6);
        assertTrue(token.authorizationState(alice, nonce));
        vm.expectRevert(bytes("LocalUSDC: authorization is used or canceled"));
        token.transferWithAuthorization(alice, BOB, 1e6, 0, block.timestamp + 60, nonce, sig);
        // The same nonce under receiveWithAuthorization: one nonce space, as USDC's.
        bytes memory receiveSig = _sign(token.RECEIVE_WITH_AUTHORIZATION_TYPEHASH(), BOB, 1e6, nonce);
        vm.prank(BOB);
        vm.expectRevert(bytes("LocalUSDC: authorization is used or canceled"));
        token.receiveWithAuthorization(alice, BOB, 1e6, 0, block.timestamp + 60, nonce, receiveSig);
    }

    function test_receiveWithAuthorization_onlyThePayee_andSpendsTheSharedNonce() public {
        bytes32 nonce = keccak256("hold");
        bytes memory sig = _sign(token.RECEIVE_WITH_AUTHORIZATION_TYPEHASH(), BOB, 2e6, nonce);
        vm.expectRevert(bytes("LocalUSDC: caller must be the payee"));
        token.receiveWithAuthorization(alice, BOB, 2e6, 0, block.timestamp + 60, nonce, sig);
        vm.expectEmit(address(token));
        emit AuthorizationUsed(alice, nonce);
        vm.prank(BOB);
        token.receiveWithAuthorization(alice, BOB, 2e6, 0, block.timestamp + 60, nonce, sig);
        assertEq(token.balanceOf(BOB), 2e6);
        assertTrue(token.authorizationState(alice, nonce));
        bytes memory cancel = _cancel(KEY, nonce);
        vm.expectRevert(bytes("LocalUSDC: authorization is used or canceled"));
        token.cancelAuthorization(alice, nonce, cancel);
    }

    function test_cancelAuthorization_spendsTheNonce_movesNothing_andBlocksTheSignedTransfer() public {
        bytes32 nonce = keccak256("fee");
        bytes memory transferSig = _sign(token.TRANSFER_WITH_AUTHORIZATION_TYPEHASH(), BOB, 1e6, nonce);
        bytes memory cancel = _cancel(KEY, nonce);
        bytes memory byBob = _cancel(0xB0B, nonce);
        vm.expectRevert(bytes("LocalUSDC: invalid signature"));
        token.cancelAuthorization(alice, nonce, byBob);
        vm.expectEmit(address(token));
        emit AuthorizationCanceled(alice, nonce);
        vm.prank(address(0xDEAD)); // anyone may relay the authorizer's cancel
        token.cancelAuthorization(alice, nonce, cancel);
        // authorizationState reads true with no payment: it cannot tell a cancel from a use.
        assertTrue(token.authorizationState(alice, nonce));
        assertEq(token.balanceOf(alice), 100e6);
        vm.expectRevert(bytes("LocalUSDC: authorization is used or canceled"));
        token.transferWithAuthorization(alice, BOB, 1e6, 0, block.timestamp + 60, nonce, transferSig);
        vm.expectRevert(bytes("LocalUSDC: authorization is used or canceled"));
        token.cancelAuthorization(alice, nonce, cancel);
        assertEq(token.balanceOf(BOB), 0);
    }

    function test_refuses_wrongSigner_expired_notYetValid() public {
        bytes32 nonce = keccak256("n");
        bytes memory sig = _sign(token.TRANSFER_WITH_AUTHORIZATION_TYPEHASH(), BOB, 1e6, nonce);
        vm.expectRevert(bytes("LocalUSDC: invalid signature"));
        token.transferWithAuthorization(alice, BOB, 2e6, 0, block.timestamp + 60, nonce, sig);
        vm.expectRevert(bytes("LocalUSDC: authorization is expired"));
        token.transferWithAuthorization(alice, BOB, 1e6, 0, block.timestamp, nonce, sig);
        vm.expectRevert(bytes("LocalUSDC: authorization is not yet valid"));
        token.transferWithAuthorization(alice, BOB, 1e6, block.timestamp, block.timestamp + 60, nonce, sig);
        assertFalse(token.authorizationState(alice, nonce));
    }
}
