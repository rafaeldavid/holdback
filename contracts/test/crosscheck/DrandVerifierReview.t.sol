// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {DrandQuicknetBeacon} from "../../src/DrandQuicknetBeacon.sol";

/// Opens the beacon's internal constants to the test below. A test contract only: it is never deployed elsewhere.
contract BeaconConstants is DrandQuicknetBeacon {
    function publicKey() external pure returns (bytes memory) {
        return _publicKey();
    }

    function negG2() external pure returns (bytes memory) {
        return _negG2();
    }

    function modulus() external view returns (uint256, uint256) {
        return (P_HI, P_LO);
    }

    function half() external pure returns (uint256, uint256) {
        return (HALF_HI, HALF_LO);
    }

    function sqrtExponent() external pure returns (uint256, uint256) {
        return (SQRT_EXP_HI, SQRT_EXP_LO);
    }

    function dstPrime() external pure returns (bytes memory) {
        return abi.encodePacked(DST_A, DST_B, DST_LEN);
    }

    function precompiles() external pure returns (address, address, address, address, uint256) {
        return (MODEXP, G1ADD, PAIRING_CHECK, MAP_FP_TO_G1, PAIRING_GAS);
    }
}

/// T-343 (the drand verifier's own review, docs/reviews/2026-11-11-drand-verifier-review.md). The cases the review
/// found no test for: every constant against its published value, the identity point in its own encoding, more
/// wrong lengths, a real signature of another drand chain, a non-canonical x whose reduction is a point of G1, a
/// caller who forwards too little gas, an EVM without the EIP-2537 precompiles, the hashed point's subgroup, and
/// the round arithmetic at the edges of its types. It also measures what one verification costs. Every vector's
/// source is named beside it.
contract DrandVerifierReviewTest is Test {
    /// The quicknet group public key as drand publishes it: 96 bytes, ZCash compressed G2 (x.c1 then x.c0, flags in
    /// the top three bits). https://api.drand.sh/52db9ba7…84e971/info and the same path on drand.cloudflare.com,
    /// fetched 2026-11-11; both returned this string.
    bytes internal constant PUBLISHED_KEY =
        hex"83cf0f2896adee7eb8b5f01fcad3912212c437e0073e911fb90022d3e760183c8c4b450b6a0a6c3ac6a5776a2d1064510d1fec758c921cc22b0e17e63aaf4bcb5ed66304de9cf809bd274ca73bab4af5a6e9c76a4bc09e76eae8991ef5ece45a";
    /// The scheme's tag: drand crypto/schemes.go, NewPedersenBLSUnchainedG1, "default RFC9380 DST for G1".
    string internal constant PUBLISHED_DST = "BLS_SIG_BLS12381G1_XMD:SHA-256_SSWU_RO_NUL_";
    /// The base field modulus p: EIP-2537, "Curve parameters"; RFC 9380 section 8.8.1.
    uint256 internal constant P_HI = 0x1a0111ea397fe69a4b1ba7b6434bacd7;
    uint256 internal constant P_LO = 0x64774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaaab;

    /// quicknet (52db…e971) round 1000, as in fixtures/beacon/drand-quicknet.json; fetched again 2026-11-11.
    bytes internal constant SIG_1000 =
        hex"b44679b9a59af2ec876b1a6b1ad52ea9b1615fc3982b19576350f93447cb1125e342b73a8dd2bacbe47e4b6b63ed5e39";
    /// The same point in the ZCash uncompressed form (96 bytes) and as an EIP-2537 G1 point (128 bytes), computed
    /// with noble-curves 1.9.1.
    bytes internal constant SIG_1000_UNCOMPRESSED =
        hex"144679b9a59af2ec876b1a6b1ad52ea9b1615fc3982b19576350f93447cb1125e342b73a8dd2bacbe47e4b6b63ed5e3911f92e4521ef54f047b64b85fa98db2d46f0f44add1f60b93f8a0dbddd63b34f238657c2d93aed18b90bddd60a01b6d2";
    bytes internal constant SIG_1000_EIP2537 =
        hex"00000000000000000000000000000000144679b9a59af2ec876b1a6b1ad52ea9b1615fc3982b19576350f93447cb1125e342b73a8dd2bacbe47e4b6b63ed5e390000000000000000000000000000000011f92e4521ef54f047b64b85fa98db2d46f0f44add1f60b93f8a0dbddd63b34f238657c2d93aed18b90bddd60a01b6d2";

    /// Round 1000 of three other drand chains, fetched 2026-11-11.
    /// quicknet-t, the testnet chain cc9c3984…41a9a5 (pl-us.testnet.drand.sh): the same scheme
    /// (bls-unchained-g1-rfc9380) and the same tag under another key. It verifies under its own key off chain.
    bytes internal constant QUICKNET_T_1000 =
        hex"95eefb5d443bb029594b17c83bc20aa5976997cb62cd07bd9f77e66089d49e02292d5f329fd0219daf11ff61ffafe6fe";
    /// default, the chain 8990e7a9…51b2ce (api.drand.sh): pedersen-bls-chained, a 96-byte signature in G2.
    bytes internal constant DEFAULT_1000 =
        hex"99bf96de133c3d3937293cfca10c8152b18ab2d034ccecf115658db324d2edc00a16a2044cd04a8a38e2a307e5ecff3511315be8d282079faf24098f283e0ed2c199663b334d2e84c55c032fe469b212c5c2087ebb83a5b25155c3283f5b79ac";
    /// evmnet, the chain 04f1e906…6ec8c3 (api.drand.sh): bls-bn254-unchained-on-g1, a 64-byte signature on BN254.
    bytes internal constant EVMNET_1000 =
        hex"06fd5996329504d3a56b482d9222bf7205857d0a9559ddd216ca31a286f6a8cc0a120f021aac2f13553fb164f62bc3a5ca32c76dea88a777b39bcf3cac5fdbd6";

    /// Twice the G1 generator, compressed, and the same point with x + p in place of x. x + p is below 2^381, so
    /// it fits the 381 bits of a compressed encoding; a decoder that reduces x mod p reads both as the same point.
    bytes internal constant TWO_G =
        hex"a572cbea904d67468808c8eb50a9450c9721db309128012543902d0ac358a62ae28f75bb8f1c7c42c39a8c5529bf0f4e";
    bytes internal constant TWO_G_X_PLUS_P =
        hex"bf73ddd4c9cd4de0d32470a193f4f1e3fb9926b584ad13e4aac0ffabba099c4f013b75ba40707c427d998c5529beb9f9";
    /// x = 4: on the curve, outside the prime-order subgroup (DrandBeacon.t.sol).
    bytes internal constant OUTSIDE_G1 =
        hex"800000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000004";
    /// x = 1: no curve point has this x (DrandBeacon.t.sol).
    bytes internal constant NOT_ON_THE_CURVE =
        hex"800000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001";

    /// The G2 generator (EIP-2537, "Curve parameters", H2) and its negation (the beacon's NG_0 to NG_7).
    bytes internal constant G2 =
        hex"00000000000000000000000000000000024aa2b2f08f0a91260805272dc51051c6e47ad4fa403b02b4510b647ae3d1770bac0326a805bbefd48056c8c121bdb80000000000000000000000000000000013e02b6052719f607dacd3a088274f65596bd0d09920b61ab5da61bbdc7f5049334cf11213945d57e5ac7d055d042b7e000000000000000000000000000000000ce5d527727d6e118cc9cdc6da2e351aadfd9baa8cbdd3a76d429a695160d12c923ac9cc3baca289e193548608b82801000000000000000000000000000000000606c4a02ea734cc32acd2b02bc28b99cb3e287e85a763af267492ab572e99ab3f370d275cec1da1aaa9075ff05f79be";
    bytes internal constant NEG_G2 =
        hex"00000000000000000000000000000000024aa2b2f08f0a91260805272dc51051c6e47ad4fa403b02b4510b647ae3d1770bac0326a805bbefd48056c8c121bdb80000000000000000000000000000000013e02b6052719f607dacd3a088274f65596bd0d09920b61ab5da61bbdc7f5049334cf11213945d57e5ac7d055d042b7e000000000000000000000000000000000d1b3cc2c7027888be51d9ef691d77bcb679afda66c73f17f9ee3837a55024f78c71363275a75d75d86bab79f74782aa0000000000000000000000000000000013fa4d4a0ad8b1ce186ed5061789213d993923066dddaf1040bc3ff59f825c78df74f2d75467e25e0f55f8a00fa030ed";

    /// The beacon's cap on PAIRING_CHECK, and what two pairs cost (EIP-2537, "Pairing check operation":
    /// 32600 * k + 37700).
    uint256 internal constant PAIRING_GAS = 250_000;
    uint256 internal constant TWO_PAIRS = 102_900;
    /// A refusal below this never reached the pairing: decompression costs at most three MODEXP calls.
    uint256 internal constant BEFORE_THE_PAIRING = 30_000;

    DrandQuicknetBeacon internal beacon;

    function setUp() public {
        beacon = new DrandQuicknetBeacon();
    }

    function _call(uint64 round, bytes memory s, uint256 gasGiven)
        internal
        view
        returns (bool ok, bytes memory ret, uint256 used)
    {
        uint256 g = gasleft();
        (ok, ret) =
            address(beacon).staticcall{gas: gasGiven}(abi.encodeCall(DrandQuicknetBeacon.beaconValue, (round, s)));
        used = g - gasleft();
    }

    /// Refused with the beacon's own error; returns the gas the refusal cost its caller.
    function _refused(uint64 round, bytes memory s) internal view returns (uint256 used) {
        bool ok;
        bytes memory ret;
        (ok, ret, used) = _call(round, s, gasleft());
        assertFalse(ok, "the beacon accepted it");
        assertEq(ret, abi.encodeWithSelector(DrandQuicknetBeacon.InvalidSignature.selector));
    }

    /// Bytes [from, from + len) of `b` as a big-endian integer; len is at most 32.
    function _word(bytes memory b, uint256 from, uint256 len) internal pure returns (uint256 v) {
        for (uint256 i; i < len; i++) {
            v = (v << 8) | uint8(b[from + i]);
        }
    }

    // ------------------------------------------------------------ the constants

    /// Each constant against its published value: the modulus and the two exponents derived from it, the tag, the
    /// public key, the negated generator, the precompile addresses and the cap.
    function test_review_constants_matchThePublishedValues() public {
        BeaconConstants c = new BeaconConstants();

        // p, then (p - 1) / 2 and (p + 1) / 4 by multiplying back.
        (uint256 pHi, uint256 pLo) = c.modulus();
        assertEq(pHi, P_HI);
        assertEq(pLo, P_LO);
        (uint256 halfHi, uint256 halfLo) = c.half();
        (uint256 rootHi, uint256 rootLo) = c.sqrtExponent();
        unchecked {
            assertEq(halfLo * 2 + 1, pLo, "2 * HALF + 1 = p, low word");
            assertEq(halfHi * 2 + (halfLo >> 255), pHi, "2 * HALF + 1 = p, high word");
            assertEq(rootLo * 4 - 1, pLo, "4 * SQRT_EXP - 1 = p, low word");
            assertEq(rootHi * 4 + (rootLo >> 254), pHi, "4 * SQRT_EXP - 1 = p, high word");
        }
        assertEq(pLo % 4, 3, "p = 3 mod 4, so the square root is a power");

        // The tag, with its length byte, as expand_message_xmd appends it (RFC 9380 section 5.3.1, DST_prime).
        assertEq(bytes(PUBLISHED_DST).length, 43);
        assertEq(c.dstPrime(), abi.encodePacked(PUBLISHED_DST, uint8(43)));

        // The public key. EIP-2537 wants x.c0, x.c1, y.c0, y.c1, 64 bytes each; drand publishes x.c1 then x.c0.
        assertEq(PUBLISHED_KEY.length, 96);
        assertEq(uint8(PUBLISHED_KEY[0]) >> 5, 4, "compressed, not infinity, sign bit 0");
        bytes memory key = c.publicKey();
        assertEq(key.length, 256);
        uint256[8] memory w = abi.decode(key, (uint256[8]));
        assertEq(w[0], _word(PUBLISHED_KEY, 48, 16), "x.c0, high word");
        assertEq(w[1], _word(PUBLISHED_KEY, 64, 32), "x.c0, low word");
        assertEq(w[2], _word(PUBLISHED_KEY, 0, 16) & ~(uint256(0xe0) << 120), "x.c1, high word, flags masked");
        assertEq(w[3], _word(PUBLISHED_KEY, 16, 32), "x.c1, low word");
        // y is not published. PAIRING_CHECK fails for a G2 point off the curve or outside the subgroup, so its
        // answer for (identity, key) shows the key is a point of G2. Sign bit 0 says y is the smaller root, and
        // for G2 the comparison reads y.c1 first.
        (bool ok, bytes memory out) = address(0x0f).staticcall(bytes.concat(new bytes(128), key));
        assertTrue(ok, "the key is not a point of G2");
        assertEq(out, abi.encode(uint256(1)));
        assertTrue(w[6] != 0 || w[7] != 0, "y.c1 is zero; the comparison would read y.c0");
        assertTrue(w[6] < halfHi || (w[6] == halfHi && w[7] <= halfLo), "y is the larger root");

        // The negated generator: G2ADD(g2, -g2) is the identity, 256 zero bytes (EIP-2537, "Fine points").
        assertEq(c.negG2(), NEG_G2);
        (ok, out) = address(0x0d).staticcall(bytes.concat(G2, c.negG2()));
        assertTrue(ok);
        assertEq(out, new bytes(256));

        // Addresses (EIP-2537, "Constants") and the cap against the price of two pairs.
        (address modexp, address g1add, address pairing, address map, uint256 cap) = c.precompiles();
        assertEq(modexp, address(0x05));
        assertEq(g1add, address(0x0b));
        assertEq(pairing, address(0x0f));
        assertEq(map, address(0x10));
        assertEq(cap, PAIRING_GAS);
        assertEq(32_600 * 2 + 37_700, TWO_PAIRS);
        assertGt(cap, TWO_PAIRS);
    }

    // ------------------------------------------------------------ the identity point

    /// The identity of G1 has its own compressed encoding: the compression and infinity bits, then zeros. The
    /// beacon refuses the infinity bit before any precompile runs, so PAIRING_CHECK never sees the identity.
    function test_review_theIdentityPoint_refusedBeforeAnyPrecompile() public view {
        bytes memory identity = new bytes(48);
        identity[0] = 0xc0;
        assertLt(_refused(1000, identity), BEFORE_THE_PAIRING);
        identity[0] = 0xe0; // the identity with the sign bit set, which no encoder writes
        assertLt(_refused(1000, identity), BEFORE_THE_PAIRING);
        identity[0] = 0x40; // the infinity bit without the compression bit
        assertLt(_refused(1000, identity), BEFORE_THE_PAIRING);
        assertLt(_refused(1000, new bytes(48)), BEFORE_THE_PAIRING); // 48 zero bytes: not compressed
        // The identity for every round the fixture names, and for round 0, which drand never signs.
        identity[0] = 0xc0;
        uint64[5] memory rounds = [uint64(0), 1, 2, 20_000_000, type(uint64).max];
        for (uint256 i; i < rounds.length; i++) {
            assertLt(_refused(rounds[i], identity), BEFORE_THE_PAIRING);
        }
    }

    // ------------------------------------------------------------ lengths

    /// Only 48 bytes are read. The real round-1000 point in its 96-byte and 128-byte forms, a byte short, and a
    /// single flag byte are refused before any precompile.
    function test_review_otherLengthsOfTheRealPoint_refused() public view {
        bytes memory short = new bytes(47);
        for (uint256 i; i < 47; i++) {
            short[i] = SIG_1000[i];
        }
        assertEq(SIG_1000_UNCOMPRESSED.length, 96);
        assertEq(SIG_1000_EIP2537.length, 128);
        assertLt(_refused(1000, short), BEFORE_THE_PAIRING);
        assertLt(_refused(1000, SIG_1000_UNCOMPRESSED), BEFORE_THE_PAIRING);
        assertLt(_refused(1000, SIG_1000_EIP2537), BEFORE_THE_PAIRING);
        assertLt(_refused(1000, hex"b4"), BEFORE_THE_PAIRING);
        assertLt(_refused(1000, bytes.concat(SIG_1000, SIG_1000)), BEFORE_THE_PAIRING);
    }

    // ------------------------------------------------------------ another drand chain

    /// quicknet-t signs the same message for round 1000 (the unchained message is the round alone) with the same
    /// tag, under another key. The point is in G1, so the pairing runs and answers false: the refusal costs the
    /// pairing, not the whole cap.
    function test_review_aValidSignatureOfAnotherChain_sameScheme_refusedByThePairing() public view {
        uint256 used = _refused(1000, QUICKNET_T_1000);
        assertGt(used, TWO_PAIRS, "the pairing ran");
        assertLt(used, PAIRING_GAS, "and answered false; it did not fail");
    }

    /// The chained default chain signs in G2 (96 bytes) and evmnet signs on BN254 (64 bytes): refused by length.
    /// Their first 48 bytes are refused too.
    function test_review_signaturesOfOtherSchemes_refused() public view {
        assertEq(DEFAULT_1000.length, 96);
        assertEq(EVMNET_1000.length, 64);
        assertLt(_refused(1000, DEFAULT_1000), BEFORE_THE_PAIRING);
        assertLt(_refused(1000, EVMNET_1000), BEFORE_THE_PAIRING);
        bytes memory head = new bytes(48);
        for (uint256 i; i < 48; i++) {
            head[i] = DEFAULT_1000[i];
        }
        _refused(1000, head);
        for (uint256 i; i < 48; i++) {
            head[i] = EVMNET_1000[i];
        }
        _refused(1000, head);
    }

    // ------------------------------------------------------------ a non-canonical x that reduces to a point of G1

    /// 2·G is in G1 and is not round 1000's signature: the pairing runs and answers false. The same point written
    /// with x + p never reaches a precompile. So no round has a second accepted encoding through x + p.
    function test_review_xPlusP_ofAPointInG1_refusedBeforeAnyPrecompile() public view {
        uint256 canonical = _refused(1000, TWO_G);
        assertGt(canonical, TWO_PAIRS);
        assertLt(canonical, PAIRING_GAS);
        assertLt(_refused(1000, TWO_G_X_PLUS_P), BEFORE_THE_PAIRING);
    }

    // ------------------------------------------------------------ a caller who forwards too little gas

    /// The beacon caps PAIRING_CHECK at 250,000 gas and forwards the rest uncapped. Whatever gas the caller gives,
    /// a valid proof reverts or returns its one value, and an invalid proof reverts. No gas amount turns a refusal
    /// into a value or one value into another.
    function test_review_anyGasAmount_aValidProofRevertsOrReturnsItsValue() public {
        bytes memory value = abi.encode(sha256(SIG_1000));
        uint256 firstAccepted;
        for (uint256 g = 5_000; g <= 400_000; g += 2_500) {
            (bool ok, bytes memory ret,) = _call(1000, SIG_1000, g);
            if (ok) {
                assertEq(ret, value, "a value other than sha256(signature)");
                if (firstAccepted == 0) firstAccepted = g;
            } else {
                assertEq(firstAccepted, 0, "refused with more gas than an accepted call had");
            }
            (ok,,) = _call(1001, SIG_1000, g); // a point of G1 for another round
            assertFalse(ok, "another round's signature accepted");
            (ok,,) = _call(1000, OUTSIDE_G1, g); // makes PAIRING_CHECK fail
            assertFalse(ok, "a point outside G1 accepted");
        }
        assertGt(firstAccepted, TWO_PAIRS);
        assertLe(firstAccepted, 200_000, "a valid proof needs no more than this under Prague prices");
        emit log_named_uint("least gas at which round 1000 verifies (2,500 gas steps)", firstAccepted);
    }

    // ------------------------------------------------------------ an EVM without EIP-2537

    /// Cancun has no BLS12-381 precompiles: 0x0b, 0x0f and 0x10 are empty accounts, and a call to one returns no
    /// data. The beacon checks each result's length, so it refuses a real round and never accepts.
    /// forge-config: default.evm_version = "cancun"
    function test_review_withoutThePrecompiles_aRealRoundIsRefused() public {
        (bool ok, bytes memory out) = address(0x10).staticcall(new bytes(64));
        assertTrue(ok && out.length == 0, "this EVM has MAP_FP_TO_G1; the test needs one without it");
        assertLt(_refused(1000, SIG_1000), 60_000);
        vm.expectRevert(DrandQuicknetBeacon.InvalidSignature.selector);
        beacon.hashToG1(bytes32(uint256(1)));
    }

    // ------------------------------------------------------------ the hashed point

    /// hashToG1 never reverts, and its point is in the prime-order subgroup: PAIRING_CHECK fails for any input
    /// outside it (EIP-2537, "Subgroup checks"), and here it answers true for e(H, g2) · e(H, -g2).
    function testFuzz_review_hashToG1_isAPointOfG1(bytes32 message) public view {
        bytes memory h = beacon.hashToG1(message);
        assertEq(h.length, 128);
        (bool ok, bytes memory out) = address(0x0f).staticcall(bytes.concat(h, G2, h, NEG_G2));
        assertTrue(ok, "PAIRING_CHECK failed: the hashed point is not in G1");
        assertEq(out, abi.encode(uint256(1)));
    }

    // ------------------------------------------------------------ round arithmetic

    /// For every 64-bit time (the width of the terms' deadlines) roundAt is drand's formula with no truncation.
    function testFuzz_review_roundAt_exactForEvery64BitTime(uint64 t) public view {
        uint256 genesis = beacon.GENESIS();
        uint256 expected = t < genesis ? 0 : (uint256(t) - genesis) / beacon.PERIOD() + 1;
        assertEq(uint256(beacon.roundAt(t)), expected);
    }

    /// roundAt takes a uint256 and returns a uint64. The first time whose round does not fit 64 bits is
    /// genesis + 3 · (2^64 - 1); from there the round wraps. No deadline in the signed terms can reach it.
    function test_review_roundAt_wrapsOnlyBeyond64BitTimes() public view {
        uint256 genesis = beacon.GENESIS();
        uint256 lastExact = genesis + 3 * uint256(type(uint64).max) - 1;
        assertGt(lastExact, type(uint64).max);
        assertEq(beacon.roundAt(lastExact), type(uint64).max);
        assertEq(beacon.roundAt(lastExact + 1), 0);
        assertEq(beacon.roundAt(lastExact + 4), 1);
    }

    // ------------------------------------------------------------ what one verification costs (review items I-12, I-13)

    /// Gas of beaconValue under Prague prices (foundry.toml, evm_version = "prague"), measured around a call to a
    /// warm beacon. Fusaka's MODEXP prices (EIP-7883) add 58,438 gas to the valid case; the review derives it.
    function test_review_gasOfOneVerification() public {
        beacon.roundAt(0); // warm the account
        (bool ok,, uint256 valid) = _call(1000, SIG_1000, gasleft());
        assertTrue(ok);
        uint256 wrongRound = _refused(1001, SIG_1000);
        uint256 outsideG1 = _refused(1000, OUTSIDE_G1);
        uint256 notOnCurve = _refused(1000, NOT_ON_THE_CURVE);
        uint256 nonCanonical = _refused(1000, TWO_G_X_PLUS_P);
        emit log_named_uint("valid proof (gas)", valid);
        emit log_named_uint("a point of G1 that is not the signature (gas)", wrongRound);
        emit log_named_uint("a curve point outside G1 (gas)", outsideG1);
        emit log_named_uint("an x with no curve point (gas)", notOnCurve);
        emit log_named_uint("an x not below p (gas)", nonCanonical);

        assertGt(valid, TWO_PAIRS);
        assertLt(valid, 175_000, "a valid proof, Prague prices");
        assertLt(wrongRound, 175_000, "a false pairing costs what a true one costs");
        assertGt(outsideG1, PAIRING_GAS, "a failing PAIRING_CHECK burns its whole cap");
        assertLt(outsideG1, PAIRING_GAS + 40_000, "and no more than the cap plus the work before it");
        assertLt(notOnCurve, BEFORE_THE_PAIRING);
        assertLt(nonCanonical, 5_000, "refused before the first MODEXP");
    }
}
