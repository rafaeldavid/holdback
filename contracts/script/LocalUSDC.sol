// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC3009} from "commerce-payments/interfaces/IERC3009.sol";
import {ERC20} from "solady/tokens/ERC20.sol";
import {SignatureCheckerLib} from "solady/utils/SignatureCheckerLib.sol";

/// @title LocalUSDC
/// @notice Anvil only (T-205): USDC's ERC-3009 as Circle's FiatToken v2.2 has it (stablecoin-evm, v2/EIP3009.sol).
///         receiveWithAuthorization, transferWithAuthorization and cancelAuthorization share one nonce space, which
///         `authorizationState` reads, and each use or cancel is logged, so the operator fee's front-run defence
///         (ADR-0023) can be tested against a cancel. The EIP-712 domain is "USD Coin", version "1". Anyone may mint;
///         it guards no value and is never deployed off anvil.
contract LocalUSDC is ERC20, IERC3009 {
    /// keccak256("TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)")
    bytes32 public constant TRANSFER_WITH_AUTHORIZATION_TYPEHASH =
        0x7c7c6cdb67a18743f49ec6fa9b35f50d52ed05cbed4cc592e13b44501c1a2267;
    /// keccak256("ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)")
    bytes32 public constant RECEIVE_WITH_AUTHORIZATION_TYPEHASH =
        0xd099cc98ef71107a616c4f0f941f04c322d8e254fe26b3c6668db87aae413de8;
    /// keccak256("CancelAuthorization(address authorizer,bytes32 nonce)")
    bytes32 public constant CANCEL_AUTHORIZATION_TYPEHASH =
        0x158b0a9edf7a828aad02f63cd515c68ef2f50ba807396f6d12842833a1597429;

    mapping(address authorizer => mapping(bytes32 nonce => bool)) private _authorizationStates;

    event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce);
    event AuthorizationCanceled(address indexed authorizer, bytes32 indexed nonce);

    function name() public pure override returns (string memory) {
        return "USD Coin";
    }

    function symbol() public pure override returns (string memory) {
        return "USDC";
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /// @notice True once the nonce is used or cancelled, whichever function did it.
    function authorizationState(address authorizer, bytes32 nonce) external view returns (bool) {
        return _authorizationStates[authorizer][nonce];
    }

    function DOMAIN_SEPARATOR() public view override(ERC20, IERC3009) returns (bytes32) {
        return super.DOMAIN_SEPARATOR();
    }

    /// @dev Precomputed, so a signature check does not hash the name each time.
    function _constantNameHash() internal pure override returns (bytes32) {
        return keccak256("USD Coin");
    }

    /// @notice Anyone may relay it (the operator fee, ADR-0023).
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

    /// @notice Only the payee may submit it (CPP's ERC3009PaymentCollector funds the hold this way).
    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes memory signature
    ) external {
        require(to == msg.sender, "LocalUSDC: caller must be the payee");
        _useAuthorization(RECEIVE_WITH_AUTHORIZATION_TYPEHASH, from, to, value, validAfter, validBefore, nonce, signature);
        _transfer(from, to, value);
    }

    /// @notice The authorizer spends an unused nonce without moving anything: no authorization signed over it can
    ///         be used after this, and `authorizationState` reads true as it would after a use.
    function cancelAuthorization(address authorizer, bytes32 nonce, bytes memory signature) external {
        _requireUnused(authorizer, nonce);
        _requireSignature(authorizer, keccak256(abi.encode(CANCEL_AUTHORIZATION_TYPEHASH, authorizer, nonce)), signature);
        _authorizationStates[authorizer][nonce] = true;
        emit AuthorizationCanceled(authorizer, nonce);
    }

    /// @dev FiatToken's order: validity window, unused nonce, signature; then AuthorizationUsed before the Transfer.
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
        require(block.timestamp > validAfter, "LocalUSDC: authorization is not yet valid");
        require(block.timestamp < validBefore, "LocalUSDC: authorization is expired");
        _requireUnused(from, nonce);
        _requireSignature(from, keccak256(abi.encode(typehash, from, to, value, validAfter, validBefore, nonce)), signature);
        _authorizationStates[from][nonce] = true;
        emit AuthorizationUsed(from, nonce);
    }

    function _requireUnused(address authorizer, bytes32 nonce) internal view {
        require(!_authorizationStates[authorizer][nonce], "LocalUSDC: authorization is used or canceled");
    }

    function _requireSignature(address signer, bytes32 structHash, bytes memory signature) internal view {
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR(), structHash));
        require(SignatureCheckerLib.isValidSignatureNow(signer, digest, signature), "LocalUSDC: invalid signature");
    }
}
