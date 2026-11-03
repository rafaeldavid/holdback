// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {TestUSDC} from "../../script/TestUSDC.sol";

/// The demo's test token (D42): USDC's ERC-3009 behaviour under its own name, and no admin.
contract TestUSDCTest is Test {
    TestUSDC internal token;
    uint256 internal constant KEY = 0xA11CE;
    address internal alice;
    address internal constant BOB = address(0xB0B);

    function setUp() public {
        token = new TestUSDC();
        alice = vm.addr(KEY);
        token.mint(alice, 100e6);
        vm.warp(1_800_000_000);
    }

    function _sign(bytes32 typehash, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce)
        internal
        view
        returns (bytes memory)
    {
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01", token.DOMAIN_SEPARATOR(), keccak256(abi.encode(typehash, alice, to, value, validAfter, validBefore, nonce))
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(KEY, digest);
        return abi.encodePacked(r, s, v);
    }

    function test_metadata_isNotCircles() public view {
        assertEq(token.name(), "Crow Test USDC");
        assertEq(token.symbol(), "tUSDC");
        assertEq(token.decimals(), 6);
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("Crow Test USDC"),
                keccak256("1"),
                block.chainid,
                address(token)
            )
        );
        assertEq(token.DOMAIN_SEPARATOR(), domain);
    }

    function test_transferWithAuthorization_movesOnce() public {
        bytes32 nonce = keccak256("fee");
        bytes memory sig = _sign(token.TRANSFER_WITH_AUTHORIZATION_TYPEHASH(), BOB, 1e6, 0, block.timestamp + 60, nonce);
        vm.prank(address(0xDEAD)); // anyone may relay it
        token.transferWithAuthorization(alice, BOB, 1e6, 0, block.timestamp + 60, nonce, sig);
        assertEq(token.balanceOf(BOB), 1e6);
        assertTrue(token.authorizationState(alice, nonce));
        vm.expectRevert(bytes("TestUSDC: authorization is used"));
        token.transferWithAuthorization(alice, BOB, 1e6, 0, block.timestamp + 60, nonce, sig);
    }

    function test_receiveWithAuthorization_onlyThePayee() public {
        bytes32 nonce = keccak256("hold");
        bytes memory sig = _sign(token.RECEIVE_WITH_AUTHORIZATION_TYPEHASH(), BOB, 2e6, 0, block.timestamp + 60, nonce);
        vm.expectRevert(bytes("TestUSDC: caller must be the payee"));
        token.receiveWithAuthorization(alice, BOB, 2e6, 0, block.timestamp + 60, nonce, sig);
        vm.prank(BOB);
        token.receiveWithAuthorization(alice, BOB, 2e6, 0, block.timestamp + 60, nonce, sig);
        assertEq(token.balanceOf(BOB), 2e6);
    }

    function test_refuses_wrongSigner_expired_notYetValid_andOneNonceSpaceForBoth() public {
        bytes32 nonce = keccak256("n");
        bytes memory sig = _sign(token.TRANSFER_WITH_AUTHORIZATION_TYPEHASH(), BOB, 1e6, 0, block.timestamp + 60, nonce);
        vm.expectRevert(bytes("TestUSDC: invalid signature"));
        token.transferWithAuthorization(alice, BOB, 2e6, 0, block.timestamp + 60, nonce, sig);
        vm.expectRevert(bytes("TestUSDC: authorization is expired"));
        token.transferWithAuthorization(alice, BOB, 1e6, 0, block.timestamp, nonce, sig);
        vm.expectRevert(bytes("TestUSDC: authorization is not yet valid"));
        token.transferWithAuthorization(alice, BOB, 1e6, block.timestamp, block.timestamp + 60, nonce, sig);
        // A transfer's nonce, once used, also blocks a receive with the same nonce (USDC keeps one nonce space).
        token.transferWithAuthorization(alice, BOB, 1e6, 0, block.timestamp + 60, nonce, sig);
        bytes memory receiveSig = _sign(token.RECEIVE_WITH_AUTHORIZATION_TYPEHASH(), BOB, 1e6, 0, block.timestamp + 60, nonce);
        vm.prank(BOB);
        vm.expectRevert(bytes("TestUSDC: authorization is used"));
        token.receiveWithAuthorization(alice, BOB, 1e6, 0, block.timestamp + 60, nonce, receiveSig);
    }

    function test_permit2_hasNoStandingAllowance() public view {
        assertEq(token.allowance(alice, 0x000000000022D473030F116dDEE9F6B43aC78BA3), 0);
    }
}
