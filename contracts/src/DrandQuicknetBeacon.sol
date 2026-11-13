// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IHoldbackBeacon} from "./IHoldbackBeacon.sol";

/// @title DrandQuicknetBeacon
/// @notice Verifies a drand quicknet round on chain (ADR-0018 §4). Quicknet (chain hash
///         52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971) uses the scheme
///         `bls-unchained-g1-rfc9380`: the signature of round r is a BLS12-381 G1 point (48 bytes compressed) over
///         the message sha256(r as 8 big-endian bytes), hashed to G1 per RFC 9380 with the DST below; the group
///         public key is in G2. The round's randomness is sha256(signature).
/// @dev Uses the EIP-2537 precompiles (Prague): MAP_FP_TO_G1 (0x10), G1ADD (0x0b) and PAIRING_CHECK (0x0f), plus
///      SHA-256 (0x02) and MODEXP (0x05). No owner, no setter, no proxy, no delegatecall: the public key, genesis
///      and period are compile-time constants (a different drand network is a different contract). On a chain
///      without EIP-2537 every proof is refused, never accepted: each precompile result's length is checked.
contract DrandQuicknetBeacon is IHoldbackBeacon {
    /// @notice drand quicknet genesis time and period (https://api.drand.sh/<chain hash>/info).
    uint256 public constant GENESIS = 1692803367;
    uint256 public constant PERIOD = 3;

    /// @dev RFC 9380 domain separation tag of the scheme, "BLS_SIG_BLS12381G1_XMD:SHA-256_SSWU_RO_NUL_" (43 bytes),
    ///      split 32 + 11.
    bytes32 internal constant DST_A = "BLS_SIG_BLS12381G1_XMD:SHA-256_S";
    bytes11 internal constant DST_B = "SWU_RO_NUL_";
    uint8 internal constant DST_LEN = 43;

    /// @dev The quicknet group public key, compressed 83cf0f28…ece45a, as an EIP-2537 G2 point
    ///      (x.c0, x.c1, y.c0, y.c1; 64 bytes each), in eight words. Every constant is a PUSH32 immediate, not a code
    ///      data section, so the no-admin opcode walk sees the whole runtime bytecode.
    uint256 internal constant PK_0 = 0x000000000000000000000000000000000d1fec758c921cc22b0e17e63aaf4bcb;
    uint256 internal constant PK_1 = 0x5ed66304de9cf809bd274ca73bab4af5a6e9c76a4bc09e76eae8991ef5ece45a;
    uint256 internal constant PK_2 = 0x0000000000000000000000000000000003cf0f2896adee7eb8b5f01fcad39122;
    uint256 internal constant PK_3 = 0x12c437e0073e911fb90022d3e760183c8c4b450b6a0a6c3ac6a5776a2d106451;
    uint256 internal constant PK_4 = 0x000000000000000000000000000000000e5db2b6bfbb01c867749cadffca88b3;
    uint256 internal constant PK_5 = 0x6c24f3012ba09fc4d3022c5c37dce0f977d3adb5d183c7477c442b1f04515273;
    uint256 internal constant PK_6 = 0x0000000000000000000000000000000001a714f2edb74119a2f2b0d5a7c75ba9;
    uint256 internal constant PK_7 = 0x02d163700a61bc224ededd8e63aef7be1aaf8e93d7a9718b047ccddb3eb5d68b;

    /// @dev The negated G2 generator, so the check is e(sig, -g2) · e(H(m), pk) = 1.
    uint256 internal constant NG_0 = 0x00000000000000000000000000000000024aa2b2f08f0a91260805272dc51051;
    uint256 internal constant NG_1 = 0xc6e47ad4fa403b02b4510b647ae3d1770bac0326a805bbefd48056c8c121bdb8;
    uint256 internal constant NG_2 = 0x0000000000000000000000000000000013e02b6052719f607dacd3a088274f65;
    uint256 internal constant NG_3 = 0x596bd0d09920b61ab5da61bbdc7f5049334cf11213945d57e5ac7d055d042b7e;
    uint256 internal constant NG_4 = 0x000000000000000000000000000000000d1b3cc2c7027888be51d9ef691d77bc;
    uint256 internal constant NG_5 = 0xb679afda66c73f17f9ee3837a55024f78c71363275a75d75d86bab79f74782aa;
    uint256 internal constant NG_6 = 0x0000000000000000000000000000000013fa4d4a0ad8b1ce186ed5061789213d;
    uint256 internal constant NG_7 = 0x993923066dddaf1040bc3ff59f825c78df74f2d75467e25e0f55f8a00fa030ed;

    /// @dev The base field modulus p as two words (p = P_HI · 2^256 + P_LO), and the exponents for sqrt and sign.
    uint256 internal constant P_HI = 0x1a0111ea397fe69a4b1ba7b6434bacd7;
    /// @dev P_LO is an immutable (a PUSH32 in the runtime code) because the optimizer otherwise stores this
    ///      often-used constant as trailing code data, where the opcode walk cannot tell it from code.
    uint256 internal immutable P_LO;
    uint256 internal constant HALF_HI = 0x0d0088f51cbff34d258dd3db21a5d66b; // (p - 1) / 2
    uint256 internal constant HALF_LO = 0xb23ba5c279c2895fb39869507b587b120f55ffff58a9ffffdcff7fffffffd555;
    uint128 internal constant SQRT_EXP_HI = 0x0680447a8e5ff9a692c6e9ed90d2eb35; // (p + 1) / 4, since p = 3 mod 4
    uint256 internal constant SQRT_EXP_LO = 0xd91dd2e13ce144afd9cc34a83dac3d8907aaffffac54ffffee7fbfffffffeaab;

    address internal constant MODEXP = address(0x05);
    address internal constant G1ADD = address(0x0b);
    address internal constant PAIRING_CHECK = address(0x0f);
    address internal constant MAP_FP_TO_G1 = address(0x10);
    /// @dev Gas forwarded to PAIRING_CHECK: two pairs cost 102,900 under EIP-2537. A failing precompile burns all the
    ///      gas it was given (a point outside G1 makes it fail), so the cap bounds what a bad proof costs its relayer.
    uint256 internal constant PAIRING_GAS = 250_000;

    /// @notice The proof does not verify: not 48 bytes, not a valid compressed G1 point, not in the subgroup, not the
    ///         signature of the round, or a precompile missing or failing.
    error InvalidSignature();

    constructor() {
        P_LO = 0x64774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaaab;
    }

    /// @inheritdoc IHoldbackBeacon
    function roundAt(uint256 t) public pure returns (uint64) {
        return t < GENESIS ? 0 : uint64((t - GENESIS) / PERIOD + 1);
    }

    /// @inheritdoc IHoldbackBeacon
    /// @dev Verifies the 48-byte compressed signature of `round` with one pairing check and returns sha256 of the
    ///      signature bytes. Reverts `InvalidSignature` when it does not verify.
    function beaconValue(uint64 round, bytes calldata signature) external view returns (bytes32) {
        if (signature.length != 48) revert InvalidSignature();
        bytes memory sig = _decompress(signature);
        bytes memory h = hashToG1(sha256(abi.encodePacked(round)));
        (bool ok, bytes memory out) =
            PAIRING_CHECK.staticcall{gas: PAIRING_GAS}(bytes.concat(sig, _negG2(), h, _publicKey()));
        if (!ok || out.length != 32 || uint256(bytes32(out)) != 1) revert InvalidSignature();
        return sha256(signature);
    }

    /// @notice RFC 9380 hash_to_curve for G1 (BLS12381G1_XMD:SHA-256_SSWU_RO_) of a 32-byte message, as an
    ///         EIP-2537 G1 point. MAP_FP_TO_G1 applies the SSWU map, the isogeny and cofactor clearing to each field
    ///         element; clearing is linear, so the sum of the two mapped points is clear_cofactor(Q0 + Q1).
    /// @param message The 32-byte message: sha256 of the round number as 8 big-endian bytes.
    /// @return The point, 128 bytes in EIP-2537's G1 encoding.
    function hashToG1(bytes32 message) public view returns (bytes memory) {
        (bytes32 b1, bytes32 b2, bytes32 b3, bytes32 b4) = _expandMessageXmd(message);
        bytes memory q0 = _call(MAP_FP_TO_G1, _reduce(b1, b2), 128);
        bytes memory q1 = _call(MAP_FP_TO_G1, _reduce(b3, b4), 128);
        return _call(G1ADD, bytes.concat(q0, q1), 128);
    }

    /// @dev expand_message_xmd(msg, DST, 128) with SHA-256 (RFC 9380 §5.3.1): b_in_bytes 32, s_in_bytes 64, ell 4.
    function _expandMessageXmd(bytes32 message)
        internal
        pure
        returns (bytes32 b1, bytes32 b2, bytes32 b3, bytes32 b4)
    {
        bytes memory dstPrime = abi.encodePacked(DST_A, DST_B, DST_LEN);
        bytes32 b0 = sha256(abi.encodePacked(bytes32(0), bytes32(0), message, uint16(128), uint8(0), dstPrime));
        b1 = sha256(abi.encodePacked(b0, uint8(1), dstPrime));
        b2 = sha256(abi.encodePacked(b0 ^ b1, uint8(2), dstPrime));
        b3 = sha256(abi.encodePacked(b0 ^ b2, uint8(3), dstPrime));
        b4 = sha256(abi.encodePacked(b0 ^ b3, uint8(4), dstPrime));
    }

    /// @dev A 64-byte big-endian integer mod p, as a 64-byte EIP-2537 field element.
    function _reduce(bytes32 hi, bytes32 lo) internal view returns (bytes memory) {
        return _modexp(uint256(hi), uint256(lo), hex"01");
    }

    /// @dev Decompresses a ZCash-format G1 point: bit 7 of byte 0 = compressed, bit 6 = infinity, bit 5 = the larger
    ///      of y and p - y. Refuses an uncompressed or infinity encoding, x >= p, and an x with no point on the
    ///      curve. Subgroup membership is checked by PAIRING_CHECK, which fails for a point outside G1.
    function _decompress(bytes calldata s) internal view returns (bytes memory) {
        uint8 flags = uint8(s[0]);
        if (flags & 0xc0 != 0x80) revert InvalidSignature();
        uint256 xHi = uint256(uint128(bytes16(s[0:16]))) & ~(uint256(0xe0) << 120);
        uint256 xLo = uint256(bytes32(s[16:48]));
        if (!_lt(xHi, xLo, P_HI, P_LO)) revert InvalidSignature();
        // y^2 = x^3 + 4
        (uint256 rHi, uint256 rLo) = _words(_modexp(xHi, xLo, hex"03"));
        unchecked {
            uint256 lo = rLo + 4;
            rHi += lo < rLo ? 1 : 0;
            rLo = lo;
        }
        if (!_lt(rHi, rLo, P_HI, P_LO)) (rHi, rLo) = _sub(rHi, rLo, P_HI, P_LO);
        (uint256 yHi, uint256 yLo) = _words(_modexp(rHi, rLo, abi.encodePacked(SQRT_EXP_HI, SQRT_EXP_LO)));
        (uint256 cHi, uint256 cLo) = _words(_modexp(yHi, yLo, hex"02"));
        if (cHi != rHi || cLo != rLo) revert InvalidSignature(); // x^3 + 4 is not a square: no point
        bool larger = _lt(HALF_HI, HALF_LO, yHi, yLo);
        if (larger != (flags & 0x20 != 0)) (yHi, yLo) = _sub(P_HI, P_LO, yHi, yLo);
        return abi.encode(xHi, xLo, yHi, yLo);
    }

    function _publicKey() internal pure returns (bytes memory) {
        return abi.encode(PK_0, PK_1, PK_2, PK_3, PK_4, PK_5, PK_6, PK_7);
    }

    function _negG2() internal pure returns (bytes memory) {
        return abi.encode(NG_0, NG_1, NG_2, NG_3, NG_4, NG_5, NG_6, NG_7);
    }

    function _modexp(uint256 hi, uint256 lo, bytes memory e) internal view returns (bytes memory) {
        return _call(MODEXP, abi.encodePacked(uint256(64), e.length, uint256(64), hi, lo, e, P_HI, P_LO), 64);
    }

    function _call(address precompile, bytes memory input, uint256 outLen) internal view returns (bytes memory out) {
        bool ok;
        (ok, out) = precompile.staticcall(input);
        if (!ok || out.length != outLen) revert InvalidSignature();
    }

    function _words(bytes memory fp) internal pure returns (uint256 hi, uint256 lo) {
        (hi, lo) = abi.decode(fp, (uint256, uint256));
    }

    function _lt(uint256 aHi, uint256 aLo, uint256 bHi, uint256 bLo) internal pure returns (bool) {
        return aHi < bHi || (aHi == bHi && aLo < bLo);
    }

    /// @dev a - b for a >= b, two-word.
    function _sub(uint256 aHi, uint256 aLo, uint256 bHi, uint256 bLo) internal pure returns (uint256, uint256) {
        unchecked {
            return (aHi - bHi - (aLo < bLo ? 1 : 0), aLo - bLo);
        }
    }
}
