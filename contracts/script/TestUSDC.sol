// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "solady/tokens/ERC20.sol";
import {SignatureCheckerLib} from "solady/utils/SignatureCheckerLib.sol";

/// @title TestUSDC
/// @notice The public demo's test token on Sepolia (D42, ADR-0028): "Crow Test USDC", symbol tUSDC, 6 decimals, with
///         USDC's ERC-3009 interface (receiveWithAuthorization and transferWithAuthorization, signature as bytes, one
///         nonce space with authorizationState), so the hold is funded and the operator fee paid as they would be
///         in USDC. It is not Circle's USDC and does not use its name or symbol. Anyone may mint: it guards no value.
///         No owner, pause, freeze, blacklist or upgrade. Test networks only.
contract TestUSDC is ERC20 {
    /// keccak256("TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)")
    bytes32 public constant TRANSFER_WITH_AUTHORIZATION_TYPEHASH =
        0x7c7c6cdb67a18743f49ec6fa9b35f50d52ed05cbed4cc592e13b44501c1a2267;
    /// keccak256("ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)")
    bytes32 public constant RECEIVE_WITH_AUTHORIZATION_TYPEHASH =
        0xd099cc98ef71107a616c4f0f941f04c322d8e254fe26b3c6668db87aae413de8;

    mapping(address authorizer => mapping(bytes32 nonce => bool)) private _used;

    event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce);

    function name() public pure override returns (string memory) {
        return "Crow Test USDC";
    }

    function symbol() public pure override returns (string memory) {
        return "tUSDC";
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Open mint: test tokens for anyone, as many as asked.
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function authorizationState(address authorizer, bytes32 nonce) external view returns (bool) {
        return _used[authorizer][nonce];
    }

    function transferWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes memory signature
    ) external {
        _useAuthorization(TRANSFER_WITH_AUTHORIZATION_TYPEHASH, from, to, value, validAfter, validBefore, nonce, signature);
        _transfer(from, to, value);
    }

    /// @notice As USDC's: only the payee may submit it, so a front-runner cannot move the funds elsewhere.
    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes memory signature
    ) external {
        require(to == msg.sender, "TestUSDC: caller must be the payee");
        _useAuthorization(RECEIVE_WITH_AUTHORIZATION_TYPEHASH, from, to, value, validAfter, validBefore, nonce, signature);
        _transfer(from, to, value);
    }

    function _useAuthorization(
        bytes32 typehash,
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes memory signature
    ) internal {
        require(block.timestamp > validAfter, "TestUSDC: authorization is not yet valid");
        require(block.timestamp < validBefore, "TestUSDC: authorization is expired");
        require(!_used[from][nonce], "TestUSDC: authorization is used");
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01", DOMAIN_SEPARATOR(), keccak256(abi.encode(typehash, from, to, value, validAfter, validBefore, nonce))
            )
        );
        require(SignatureCheckerLib.isValidSignatureNow(from, digest, signature), "TestUSDC: invalid signature");
        _used[from][nonce] = true;
        emit AuthorizationUsed(from, nonce);
    }

    /// @dev As USDC: Permit2 gets no allowance unless the holder approves it.
    function _givePermit2InfiniteAllowance() internal pure override returns (bool) {
        return false;
    }
}
