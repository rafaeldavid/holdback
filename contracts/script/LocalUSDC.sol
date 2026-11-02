// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {MockERC3009Token} from "commerce-payments-test/mocks/MockERC3009Token.sol";
import {SignatureCheckerLib} from "solady/utils/SignatureCheckerLib.sol";

/// @title LocalUSDC
/// @notice Anvil only (T-205): CPP's MockERC3009Token plus USDC's `transferWithAuthorization`, which the operator fee
///         uses (ADR-0023, EVM mechanism). Anyone may mint; it guards no value and is never deployed off anvil.
contract LocalUSDC is MockERC3009Token {
    /// keccak256("TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)")
    bytes32 public constant TRANSFER_WITH_AUTHORIZATION_TYPEHASH =
        0x7c7c6cdb67a18743f49ec6fa9b35f50d52ed05cbed4cc592e13b44501c1a2267;

    mapping(address => mapping(bytes32 => bool)) private _transferAuthorizations;

    constructor() MockERC3009Token("USD Coin", "USDC", 6) {}

    function transferWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes memory signature
    ) external {
        require(!_transferAuthorizations[from][nonce], "LocalUSDC: authorization is used");
        require(block.timestamp > validAfter, "LocalUSDC: authorization not yet valid");
        require(block.timestamp < validBefore, "LocalUSDC: authorization expired");
        bytes32 structHash =
            keccak256(abi.encode(TRANSFER_WITH_AUTHORIZATION_TYPEHASH, from, to, value, validAfter, validBefore, nonce));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR(), structHash));
        require(SignatureCheckerLib.isValidSignatureNow(from, digest, signature), "LocalUSDC: invalid signature");
        _transferAuthorizations[from][nonce] = true;
        _transfer(from, to, value);
    }
}
