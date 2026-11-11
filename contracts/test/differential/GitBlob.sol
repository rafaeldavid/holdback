// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title GitBlob
/// @notice T-341: git's object id for a file's bytes, `sha1("blob <length>\0" ‖ bytes)`, so a test can check a
///         vendored file against the id `git rev-parse <commit>:<path>` prints. SHA-1 is used here only because git
///         names its objects with it; nothing in the contracts depends on it. Plain Solidity, test code only.
library GitBlob {
    function id(bytes memory content) internal pure returns (bytes20) {
        return sha1(abi.encodePacked("blob ", _decimal(content.length), bytes1(0), content));
    }

    function _decimal(uint256 v) private pure returns (bytes memory s) {
        if (v == 0) return "0";
        uint256 n;
        for (uint256 x = v; x != 0; x /= 10) {
            n++;
        }
        s = new bytes(n);
        for (; v != 0; v /= 10) {
            s[--n] = bytes1(uint8(48 + v % 10));
        }
    }

    /// FIPS 180-4 SHA-1.
    function sha1(bytes memory data) internal pure returns (bytes20) {
        uint256 len = data.length;
        uint256 padded = ((len + 8) / 64 + 1) * 64;
        bytes memory m = new bytes(padded);
        for (uint256 i; i < len; i++) {
            m[i] = data[i];
        }
        m[len] = 0x80;
        uint256 bits = len * 8;
        for (uint256 i; i < 8; i++) {
            m[padded - 1 - i] = bytes1(uint8(bits >> (8 * i)));
        }
        uint32[5] memory h = [uint32(0x67452301), 0xEFCDAB89, 0x98BADCFE, 0x10325476, 0xC3D2E1F0];
        uint32[80] memory w;
        unchecked {
            for (uint256 off; off < padded; off += 64) {
                for (uint256 t; t < 16; t++) {
                    uint256 p = off + 4 * t;
                    w[t] = (uint32(uint8(m[p])) << 24) | (uint32(uint8(m[p + 1])) << 16)
                        | (uint32(uint8(m[p + 2])) << 8) | uint32(uint8(m[p + 3]));
                }
                for (uint256 t = 16; t < 80; t++) {
                    w[t] = _rotl(w[t - 3] ^ w[t - 8] ^ w[t - 14] ^ w[t - 16], 1);
                }
                uint32 a = h[0];
                uint32 b = h[1];
                uint32 c = h[2];
                uint32 d = h[3];
                uint32 e = h[4];
                for (uint256 t; t < 80; t++) {
                    uint32 f;
                    uint32 k;
                    if (t < 20) {
                        f = (b & c) | (~b & d);
                        k = 0x5A827999;
                    } else if (t < 40) {
                        f = b ^ c ^ d;
                        k = 0x6ED9EBA1;
                    } else if (t < 60) {
                        f = (b & c) | (b & d) | (c & d);
                        k = 0x8F1BBCDC;
                    } else {
                        f = b ^ c ^ d;
                        k = 0xCA62C1D6;
                    }
                    uint32 temp = _rotl(a, 5) + f + e + k + w[t];
                    e = d;
                    d = c;
                    c = _rotl(b, 30);
                    b = a;
                    a = temp;
                }
                h[0] += a;
                h[1] += b;
                h[2] += c;
                h[3] += d;
                h[4] += e;
            }
        }
        return bytes20(
            (uint160(h[0]) << 128) | (uint160(h[1]) << 96) | (uint160(h[2]) << 64) | (uint160(h[3]) << 32)
                | uint160(h[4])
        );
    }

    function _rotl(uint32 x, uint8 n) private pure returns (uint32) {
        unchecked {
            return (x << n) | (x >> (32 - n));
        }
    }
}
