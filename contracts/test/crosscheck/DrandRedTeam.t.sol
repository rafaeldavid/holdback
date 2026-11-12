// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {HoldbackRules} from "../../src/HoldbackRules.sol";
import {HoldbackTypes as H} from "../../src/HoldbackTypes.sol";
import {IHoldbackBeacon} from "../../src/IHoldbackBeacon.sol";
import {DrandQuicknetBeacon} from "../../src/DrandQuicknetBeacon.sol";
import {Base} from "../unit/Base.sol";

/// Opens the beacon's decompression to the differential tests below. A test contract only.
contract BeaconHarness is DrandQuicknetBeacon {
    function decompress(bytes calldata s) external view returns (bytes memory) {
        return _decompress(s);
    }
}

/// The attacker's contract for the "wrong round" finding. It lands a step that fixes an escalation round (the
/// primary's escalation; the party appeal it also gated left with `fileAppeal`, T-346) only when the seed that round
/// will give suits its caller. The caller proves it already holds the round's signature: `beaconValue` reverts for
/// anything drand did not publish. So the call succeeds only in a block that was put together after drand published
/// the round the contract treats as "strictly after" that block.
contract SeedGatedFiler {
    error SeedDoesNotSuit(bytes32 seed);

    function _seed(HoldbackRules rules, bytes32 id, uint8 attempt, bytes calldata nextRoundSignature)
        internal
        view
        returns (bytes32)
    {
        IHoldbackBeacon beacon = rules.BEACON();
        uint64 round = beacon.roundAt(block.timestamp) + 1; // the round HoldbackRules.decide will demand
        return H.panelSeed(id, H.ROLE_APPEAL, attempt, beacon.beaconValue(round, nextRoundSignature));
    }

    function escalateIfSeedSuits(
        HoldbackRules rules,
        H.Terms calldata t,
        H.Decision calldata m,
        H.Delivery calldata dv,
        bytes32 id,
        bytes calldata nextRoundSignature,
        uint256 modulus,
        uint256 wanted
    ) external returns (bytes32 seed) {
        seed = _seed(rules, id, m.attempt, nextRoundSignature);
        if (uint256(seed) % modulus != wanted) revert SeedDoesNotSuit(seed);
        rules.decide(t, m, dv, "");
    }
}

/// T-343 red team of DrandQuicknetBeacon and its use in HoldbackRules.decide. Five goals: forge a proof, break a
/// real one, burn a caller's gas, get a wrong round, get an acceptance on a wrong chain. A test named
/// `test_attack_…` is an attack that failed: it asserts the refusal. A test named `test_issue_…` is an attack that
/// worked: it passes, and its assertions are the weakness. `test_boundary_…` shows what the contract relies on.
/// Vectors come from reports/scratch/t343-redteam/gen-vectors.mjs (noble-curves 1.9.1), except the real quicknet
/// rounds, which are the ones in fixtures/beacon/drand-quicknet.json.
contract DrandRedTeamTest is Base {
    DrandQuicknetBeacon internal drand;
    BeaconHarness internal harness;
    SeedGatedFiler internal filer;

    bytes4 internal constant INVALID = bytes4(keccak256("InvalidSignature()"));
    uint256 internal constant PAIRING_GAS = 250_000; // the beacon's cap on PAIRING_CHECK
    uint256 internal constant TWO_PAIRS = 102_900; // EIP-2537: 32600 * 2 + 37700
    uint256 internal constant BEFORE_THE_PAIRING = 30_000; // decompression alone, Prague prices
    uint256 internal constant GENESIS = 1692803367;

    // Real quicknet rounds (fixtures/beacon/drand-quicknet.json).
    bytes internal constant SIG_1 =
        hex"b55e7cb2d5c613ee0b2e28d6750aabbb78c39dcc96bd9d38c2c2e12198df95571de8e8e402a0cc48871c7089a2b3af4b";
    bytes internal constant SIG_1000 =
        hex"b44679b9a59af2ec876b1a6b1ad52ea9b1615fc3982b19576350f93447cb1125e342b73a8dd2bacbe47e4b6b63ed5e39";
    uint64 internal constant FALLBACK_ROUND = 32_456_478; // the round at judgeBy 1790172800 (the Base terms)
    bytes internal constant FALLBACK_SIG =
        hex"b528568aa3bcf0f15bd15391bfd424012dfa4efae8a9b335e3c7aa98871a9108220ac137cf5626cc732db3e1a2e5cdc6";
    uint64 internal constant APPEAL_ROUND = 32_398_879; // roundAt(1790000000) + 1; drand publishes it at 1790000001
    bytes internal constant APPEAL_SIG =
        hex"8692364a570f4638daa28f489f6ab6c3a3daafc5e80b5fa203f54969b9d104cd2342539a141574dadf291fd1af2df219";

    // The G2 generator (EIP-2537, "Curve parameters", H2) and its negation, as EIP-2537 points.
    bytes internal constant G2 =
        hex"00000000000000000000000000000000024aa2b2f08f0a91260805272dc51051c6e47ad4fa403b02b4510b647ae3d1770bac0326a805bbefd48056c8c121bdb80000000000000000000000000000000013e02b6052719f607dacd3a088274f65596bd0d09920b61ab5da61bbdc7f5049334cf11213945d57e5ac7d055d042b7e000000000000000000000000000000000ce5d527727d6e118cc9cdc6da2e351aadfd9baa8cbdd3a76d429a695160d12c923ac9cc3baca289e193548608b82801000000000000000000000000000000000606c4a02ea734cc32acd2b02bc28b99cb3e287e85a763af267492ab572e99ab3f370d275cec1da1aaa9075ff05f79be";
    bytes internal constant NEG_G2 =
        hex"00000000000000000000000000000000024aa2b2f08f0a91260805272dc51051c6e47ad4fa403b02b4510b647ae3d1770bac0326a805bbefd48056c8c121bdb80000000000000000000000000000000013e02b6052719f607dacd3a088274f65596bd0d09920b61ab5da61bbdc7f5049334cf11213945d57e5ac7d055d042b7e000000000000000000000000000000000d1b3cc2c7027888be51d9ef691d77bcb679afda66c73f17f9ee3837a55024f78c71363275a75d75d86bab79f74782aa0000000000000000000000000000000013fa4d4a0ad8b1ce186ed5061789213d993923066dddaf1040bc3ff59f825c78df74f2d75467e25e0f55f8a00fa030ed";

    // The cofactor of G1 is h = 3 * 11^2 * 10177^2 * 859267^2 * 52437899^2. One point of each prime order above 3,
    // compressed, and round 1000's real signature plus that point. Order 3 is in DrandEncodings.t.sol.
    bytes internal constant ORDER_11 =
        hex"9943537a80404c4d28321218a29a27e7b08045acd2260948d154ffd077b4ffff9e1d6fb01a327aa8f0f9e47fced10113";
    bytes internal constant SIG_PLUS_ORDER_11 =
        hex"b622e0ca196da7ff06241e71264eef506d848e2ecf6473395c0f332a51913a2ceac4d9c7878df1e8d09d6c470ea37ebd";
    bytes internal constant ORDER_10177 =
        hex"b5d5a608a17cb3aceb4fb5710e11207dfe3ecc393f8eaa294b488f4e7c91713a212a2e5a275fdb72e51b1ce6fbb217ff";
    bytes internal constant SIG_PLUS_ORDER_10177 =
        hex"90d4ea6ded0b60a973edb5155130360e0603ae983d2e62a7829a9b6a0f11b8ce70600c8937ad25b4b11590cbc44c7b21";
    bytes internal constant ORDER_859267 =
        hex"804ebe248f7698cd2007161df6f8444d55fa0f4d89b51184fb02cbea9f8add0b93fd0bdecb6901fbb7bfcd779ea229fa";
    bytes internal constant SIG_PLUS_ORDER_859267 =
        hex"8a51d9827ab5ceb5a9fb953b23731c141c761353fea9e1c19174dbaa76b0908c9328f9ca010ff1d39bfc7987086fe58c";
    bytes internal constant ORDER_52437899 =
        hex"8fc9761568bec2291cfbc30f55b4c883cee2a89ac19447960579aaed1f298d4b8f8b08622c4ede52ac8b064327e73e06";
    bytes internal constant SIG_PLUS_ORDER_52437899 =
        hex"8dbbda7180dbb40f5753299a9867a0254e2496d309fab40318dfcc784f158266f3055c54c57f45cc1fbd1b20cf95b21b";
    // Round 1000's signature plus a random point whose order divides h (not a prime-order point).
    bytes internal constant SIG_PLUS_COFACTOR_POINT =
        hex"82d27d94366609725c7967010dff557063c30660800457f4ae5fe9dee5a45fca8d4b5bc84d33c03f190ce00ac0d9ce5e";

    // Points of G1 built from real signatures, and a signature of round 1000's message under another key.
    bytes internal constant SIG_1000_PLUS_SIG_1 =
        hex"b02dc2ade25bd412a9d0bc55da146d187dd2ae158faaa59bc49709554ca7f9fb7126cc3269a9358a62999ac1f0cfed07";
    bytes internal constant TWO_SIG_1000 =
        hex"a2a7ab089dcaa12c348e3904c0470a0c94fe0be035453ca18af099a47a0c4ea72324e55476e21d79cb3e8a541da52454";
    bytes internal constant OTHER_KEY_SIG_1000 =
        hex"aebbc3ce4bc3d0b93785d87651f4e6340bc22dfcd4fc637b90cfeefae2565ac55f527ee118c8c260f3aa085131678304";

    // Decompression vectors. Each row is 112 bytes: the compressed point (48), then y as noble computes it (64).
    // G1_ROWS: 12 random points of G1; the first four appear with both signs.
    bytes internal constant G1_ROWS =
        hex"a4bb65bec2c85f95e6bade1cfd1cb630d0f2a9b7b65cb8cef85f317242231545f77b01f1baa88de14a07b5eb1ca8f5d1000000000000000000000000000000000e0aeb1248bd4da71b97b551f58ea720bd8bf7af8600a4675513e48d22b1982a6e0994d41b12467e922076440c97b754"
        hex"84bb65bec2c85f95e6bade1cfd1cb630d0f2a9b7b65cb8cef85f317242231545f77b01f1baa88de14a07b5eb1ca8f5d1000000000000000000000000000000000bf626d7f0c298f32f83f2644dbd05b6a6eb53d56d846e58121cee13d3ff5df9b0a26b2a9641b98127de89bbf367f357"
        hex"b10fcf1b39764d7f4b2972ab4e55ae77e68e0c37fb4093cf52fbd3e34df11883af8c771b0a054948c62ade1eb2ae3b9800000000000000000000000000000000160f31072d26e16bec3cadc35a2eb6935edaf730c82b08055cb48dde6c60ed219b5cdeb78c1008f972402afc48af23f3"
        hex"910fcf1b39764d7f4b2972ab4e55ae77e68e0c37fb4093cf52fbd3e34df11883af8c771b0a054948c62ade1eb2ae3b980000000000000000000000000000000003f1e0e30c59052e5edef9f2e91cf644059c54542b5a0aba0a7c44c28a500902834f21472543f70647bed503b75086b8"
        hex"81885d9a5fd5370356dfbbb961e9de6915ef8bd25bafd3e4b28bfd7fc1fdeeb68953589a7271869e132da5930e7814a70000000000000000000000000000000003151536e6fd3bd30d9ff6c7cd6b68ef7a261246c2dcdbeef3e018ac9620306fe60687f622ab70b2d5d4f43157ad652d"
        hex"a1885d9a5fd5370356dfbbb961e9de6915ef8bd25bafd3e4b28bfd7fc1fdeeb68953589a7271869e132da5930e7814a70000000000000000000000000000000016ebfcb35282aac73d7bb0ee75e043e7ea51393e30a836d07350b9f46090c5b438a578088ea88f4ce42a0bcea852457e"
        hex"b50fc7428f273eaacdbc6c91a9793f7d22f7ac17d2c0f3776b9a7048941923dfb0008329f29a4cd6a15e87045bdbfde2000000000000000000000000000000000d9375b0a52c5a3c8a2933eec495ef9ac33a634cb68764d1f552d1a5b0db8f1e799be990fe49961c463f9ff795468555"
        hex"950fc7428f273eaacdbc6c91a9793f7d22f7ac17d2c0f3776b9a7048941923dfb0008329f29a4cd6a15e87045bdbfde2000000000000000000000000000000000c6d9c3994538c5dc0f273c77eb5bd3ca13ce8383cfdaded71de00fb45d56705a510166db30a69e373bf60086ab92556"
        hex"abd2bd69ebc982e21a1c29fe62cee71633ef2727b6978ee0b7ff3cb88c323d8ab2c0a763fd24f7744113b2ab1866edb8000000000000000000000000000000000df6af11129bfe36b3e6e72637e1e06a9df7bc940ec35fdac9629f05fd622c9bbca069c2f5c88a5a3bbbe65b582c870d"
        hex"a5057382a7e7421f92f422f9465452566594e4f3630c5ebe4b9d1dc2ba30fee2ba1137ff200135c6ffe42fa952a142ca0000000000000000000000000000000016cb1b33c04cc6e8c848ede5d640b9f15fd839db43ab017296aa41cad7da6e908eccdbb4b89cc5adf43e9d996b162acf"
        hex"acd9fcc7a15204cbcd705ff43ba48532aeb08631e8eb2ed5fa17f31767d057caa45c4d6ae7cf5cc8f5376543e0439beb0000000000000000000000000000000014429236c3d1b24a2a01442eb24f3d00a81d43fcbdd1977f7fe96ebbfe9971e3d96d4789ff57969feef64e0c7fc63278"
        hex"848f7f6d8aa666b7d1ae87dfe45fd53d5d7d48922f899a6e33260b22f2acdfe7ab2cddd6d7f8840cff56c0a060bbfd080000000000000000000000000000000004bddac5e0becb6e2531fea31d98291ed65e0bdd63f1cc54dba7031dc4aaa21072016f45ef3a0e96e12dc43ebdc5286d"
        hex"88372f5304dfdcbe8b9ad7cfb4dc43fa48472081e3999e9aca30706402a7465f29057c17ea5f3675b6d6fdad4cfd32e70000000000000000000000000000000004d571779c22f35867c03c108b4b9b32cf5eb7822958fc2b4c0a005b3194c396873ad003c1b7d3b63a4598a8daeeae08"
        hex"8d220de51cd3023ce4b5c1efba05874b099550a7c4cdc6ebf4036180bba2b3e213267a3eb45c671b6156f900d1354883000000000000000000000000000000000a941698d90840f3ff6d3a6f1e95404ba816d2f89b900bea89ef1cea9b92e40e75ae9ec92fe514c60ddf3cb06d26ff5b"
        hex"a3513c113ec814e6b0a56375800bb299dee2219b423c67969a6399a7445ae7c389059c49a739d27a4899166746ec2af2000000000000000000000000000000001051ea715ce8608663bdf7047e4b19f1b5e9d59c1cdb9d528b7deed1edee66317104ed5eabf371ce52c4b60767311632"
        hex"b6d09160c525bbe6c216b5f03b61d7f977c8c335a4493054212bbf4e5667357a4056dd3836e7b5ca88515a0c81cb462700000000000000000000000000000000114c7961a6875ef2ce34a9f44cc0a799e9dc5ae44425d4cbe17a2da10a7350a1acf0e26c2f4c3b97ccfdbb3933380328";
    // CURVE_ROWS: 8 random points of E(Fp) outside G1, each with both signs.
    bytes internal constant CURVE_ROWS =
        hex"b1e1a9db05827c9f04191f98cee98333637d78422f4826e454cc68b21a3e4d1f7cc2069e18dcaa76114a76bad96db2db000000000000000000000000000000000e0742b47fd6242db494cfcdef0e804ad53fd87a56ec4d29de3a590032723fb068c2f4ccb8a7e40c21834f756c8ad930"
        hex"91e1a9db05827c9f04191f98cee98333637d78422f4826e454cc68b21a3e4d1f7cc2069e18dcaa76114a76bad96db2db000000000000000000000000000000000bf9cf35b9a9c26c9686d7e8543d2c8c8f37730a9c98c59588f679a0c43eb673b5e90b31f8ac1bf3987bb08a9374d17b"
        hex"a01d6df29d5e8f406cfb884a6b7d5153072d068355d910f3b3dd8df9f227af70a29663d7716083107c26dc7a08f36056000000000000000000000000000000000f8a55919d706fbeebceceb9ce0974b9d41e385981ee73cfba4143cdaf0705f82371b52662e4698015c280aab06d5ec9"
        hex"801d6df29d5e8f406cfb884a6b7d5153072d068355d910f3b3dd8df9f227af70a29663d7716083107c26dc7a08f36056000000000000000000000000000000000a76bc589c0f76db5f4cd8fc7542381d9059132b71969eefacef8ed347a9f02bfb3a4ad84e6f967fa43c7f554f924be2"
        hex"a66952bf341316db9be028cc9cda3ba036a917db304bdba0b32e95a328f4ca3d9a80f9bb3e1030012e420732cf3061f2000000000000000000000000000000000e816e2744057bbbfcb5602a99be42369abd9831cf91e5944240190eac687e0b818d9f02db35858eabb7165be8fd3b0d"
        hex"866952bf341316db9be028cc9cda3ba036a917db304bdba0b32e95a328f4ca3d9a80f9bb3e1030012e420732cf3061f2000000000000000000000000000000000b7fa3c2f57a6ade4e66478ba98d6aa0c9b9b35323f32d2b24f0b9924a4878189d1e60fbd61e7a710e47e9a417026f9e"
        hex"8529b4aec03459f627824328cbfe9d6d67119486b7dd3b01a05f85dbd108d1e5bd48c4dec622245bb98081fc99aff9050000000000000000000000000000000002ba009931b9d1e95f499c2fcae9125b17f459205b479d206be2520db3c719c01b7294030fb87936cba2904a6767194e"
        hex"a529b4aec03459f627824328cbfe9d6d67119486b7dd3b01a05f85dbd108d1e5bd48c4dec622245bb98081fc99aff905000000000000000000000000000000001747115107c614b0ebd20b8678629a7c4c82f264983d759efb4e809342e9dc6403396bfba19b86c8ee5c6fb59898915d"
        hex"82a047e6ea2c3626ca50b6347c629d797497dff26e609b7274cad623ef62cda35b79613b9407c8eeeb3e2465f1a398fc000000000000000000000000000000000600fa9c79e6de97c1df90d06e98e0c66849573ba0d0efefaf86d839cabd6f8ab9194f9d6b2f0b1147905e389991ea26"
        hex"a2a047e6ea2c3626ca50b6347c629d797497dff26e609b7274cad623ef62cda35b79613b9407c8eeeb3e2465f1a398fc000000000000000000000000000000001400174dbf990802893c16e5d4b2cc10fc2df44952b422cfb7a9fa672bf386996592b0614624f4ee726ea1c7666dc085"
        hex"80e9516c8a5b73f9cae87d16f3b2fa346ef52f82c697da18e5a7b1249e1a4f20707389a44f86d189149dcb498a61ffe500000000000000000000000000000000077573d057235428cff6589ce80a79651f1eb8ac1f502b11b68e744b60a93fb7cf7e5184e2e25e52428c6652b78dc042"
        hex"a0e9516c8a5b73f9cae87d16f3b2fa346ef52f82c697da18e5a7b1249e1a4f20707389a44f86d189149dcb498a61ffe500000000000000000000000000000000128b9e19e25c92717b254f195b413372455892d8d434e7adb0a25e559607b66c4f2dae79ce71a1ad777299ad4871ea69"
        hex"b5eeacaeee51cbdf3f9c6131a96b3b5bb92066a22fc65041eafa9831532870a4fbff5a47a29229caac8c26e4db234d2f0000000000000000000000000000000011b0a8870c78a705f4e2b4c8dd325e044db97781564640cbbbd4d2f9d482b1f1958339c707b6616dbc9caaf26fd1fda2"
        hex"95eeacaeee51cbdf3f9c6131a96b3b5bb92066a22fc65041eafa9831532870a4fbff5a47a29229caac8c26e4db234d2f00000000000000000000000000000000085069632d073f945638f2ed66194ed316bdd4039d3ed1f3ab5bffa7222e44328928c637a99d9e91fd62550d902dad09"
        hex"87e647ca6fce7b9bd9edce3cd3bba4e1dab9f37b7d0683d5357513ce908d47156d8007d9110278fc4b137b98d38b252d00000000000000000000000000000000060abc7ae171bca7560c16a55d9b15eb95274e4c56e4d8f09b4f977ab2252005a98336711a74817dca3dcaf351f4e201"
        hex"a7e647ca6fce7b9bd9edce3cd3bba4e1dab9f37b7d0683d5357513ce908d47156d8007d9110278fc4b137b98d38b252d0000000000000000000000000000000013f6556f580e29f2f50f9110e5b096ebcf4ffd389ca039cecbe13b26448bd61e7528c98d96df7e81efc1350cae0ac8aa";
    // EDGE_ROWS, all outside G1, each x with both signs:
    //   rows 0, 1: x = 0 (y = 2 and p - 2);
    //   rows 2 to 7: x^3 mod p has a low word of 2^256 - 2, 2^256 - 4 and 2^256 - 1, so the "+ 4" of x^3 + 4
    //                carries into the high word;
    //   rows 8 to 11: y = (p - 1) / 2 - 4 and (p - 1) / 2 - 7 with their negations, next to the sign rule's boundary.
    bytes internal constant EDGE_ROWS =
        hex"a00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaaa9"
        hex"80000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002"
        hex"ac5bd020a91db48e9af4916d5d4f8b3bf8069ef4c87010c50272e5d8fa229cbd3cc97c392750c6b4ce2f203f0835b4be0000000000000000000000000000000018a5e0fdcc6e9eaafbd4c726ed3bb0c0f55adef20f8856a1370ff4aee2c95baf9644273fc1ba991ba48008d4be64afb3"
        hex"8c5bd020a91db48e9af4916d5d4f8b3bf8069ef4c87010c50272e5d8fa229cbd3cc97c392750c6b4ce2f203f0835b4be00000000000000000000000000000000015b30ec6d1147ef4f46e08f560ffc166f1c6c92e3fcbc1e3020ddf213e79a748867d8beef9966e4157ef72b419afaf8"
        hex"8b89d9cbaa465c89cc0eecd2998d1ee963b0d191979681d037c52f03ac1365a98a3211b011cc8386551932bb06d4c4460000000000000000000000000000000007815007e9f0eb91e6313396d55d8fd36bd7a0365a52f1b2f2cbc202fcb9443bff992df25b2fcce51767aaff7fc815f6"
        hex"ab89d9cbaa465c89cc0eecd2998d1ee963b0d191979681d037c52f03ac1365a98a3211b011cc8386551932bb06d4c44600000000000000000000000000000000127fc1e24f8efb0864ea741f6dee1d03f89fab4e9932210c7465109df9f7b1e81f12d20c5624331aa2975500803794b5"
        hex"b4ae8e97686abee42af136c0b52697964fae85d34989d14cabc86d724542bdb56247358f22371ac1c8d7c8a2cc004c390000000000000000000000000000000010fad1db6edaf842a17a54c16b78d88a5ac6bc9a3d206ca47d855b510de7d0bd9f9ae22aa97c2d0da0102640b4e35eb0"
        hex"94ae8e97686abee42af136c0b52697964fae85d34989d14cabc86d724542bdb56247358f22371ac1c8d7c8a2cc004c39000000000000000000000000000000000906400ecaa4ee57a9a152f4d7d2d44d09b08eeab664a61ae9ab774fe8c925667f111dd407d7d2f219eed9bf4b1c4bfb"
        hex"99a5d58c1f89665cac0f23a742c4f9e7cc8141e44a3fa473da16a46aeaa9da6b369e0e354c3d7d2999709b01a2cb7135000000000000000000000000000000000d0088f51cbff34d258dd3db21a5d66bb23ba5c279c2895fb39869507b587b120f55ffff58a9ffffdcff7fffffffd551"
        hex"b9a5d58c1f89665cac0f23a742c4f9e7cc8141e44a3fa473da16a46aeaa9da6b369e0e354c3d7d2999709b01a2cb7135000000000000000000000000000000000d0088f51cbff34d258dd3db21a5d66bb23ba5c279c2895fb39869507b587b120f55ffff58a9ffffdcff7fffffffd55a"
        hex"8858e1ec28e17e3b12d16288b8c8b4855882ae62cab75143059b72dbccc5d90cd1804f7e3f77af694763c5e7e594e0b9000000000000000000000000000000000d0088f51cbff34d258dd3db21a5d66bb23ba5c279c2895fb39869507b587b120f55ffff58a9ffffdcff7fffffffd54e"
        hex"a858e1ec28e17e3b12d16288b8c8b4855882ae62cab75143059b72dbccc5d90cd1804f7e3f77af694763c5e7e594e0b9000000000000000000000000000000000d0088f51cbff34d258dd3db21a5d66bb23ba5c279c2895fb39869507b587b120f55ffff58a9ffffdcff7fffffffd55d";

    // x values with no curve point that reach the rarest branches of the arithmetic.
    // x = p - 1: x^3 = p - 1, so x^3 + 4 = p + 3 wraps past p to 3 (the subtraction after the add); 3 is not a square.
    // No other x reaches that branch with a cube: p - 2, p - 3 and p - 4 are not cubes mod p.
    bytes internal constant WRAP_NO_POINT =
        hex"9a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaaaa";
    // x^3 = 2^257 - 1 and 2^257 - 3: the add carries into the high word, and the sum is not a square.
    bytes internal constant CARRY_NO_POINT_A =
        hex"95bb2214b3eaf1b7491984dabe08474fc6365065fe1609812a21130ada961ddaadb3fc3d3b0301d4fdb2a54d1f7596e3";
    bytes internal constant CARRY_NO_POINT_B =
        hex"882825379f6fe4bf7900afbf20e628e7e383b67afc05af9e9eb8d22ab85d32f72d367c92de39d3d282f4aa89b97bbccf";

    function setUp() public override {
        super.setUp();
        drand = new DrandQuicknetBeacon();
        harness = new BeaconHarness();
        filer = new SeedGatedFiler();
        rules = new HoldbackRules(escrow, address(collector3009), MARGIN, drand, address(usdc));
    }

    // ------------------------------------------------------------ helpers

    /// Calls beaconValue on `target`; returns whether it answered, what it returned and the gas the call cost.
    function _try(address target, uint64 round, bytes memory s)
        internal
        view
        returns (bool ok, bytes memory ret, uint256 used)
    {
        uint256 g = gasleft();
        (ok, ret) = target.staticcall(abi.encodeCall(DrandQuicknetBeacon.beaconValue, (round, s)));
        used = g - gasleft();
    }

    /// Refused with the beacon's own error; returns the gas of the refusal.
    function _refused(uint64 round, bytes memory s) internal view returns (uint256 used) {
        bool ok;
        bytes memory ret;
        (ok, ret, used) = _try(address(drand), round, s);
        assertFalse(ok, "the beacon accepted it");
        assertEq(ret, abi.encodeWithSelector(INVALID), "refused, but not with InvalidSignature");
    }

    /// The pairing ran and failed (a point outside G1 burns the whole cap).
    function _refusedByAFailingPairing(uint64 round, bytes memory s) internal view {
        uint256 used = _refused(round, s);
        assertGt(used, PAIRING_GAS, "the pairing did not burn its cap: something else refused it");
        assertLt(used, PAIRING_GAS + 40_000, "more than the cap plus the work before it");
    }

    /// The pairing ran and answered false (a point of G1 that is not the signature).
    function _refusedByAFalsePairing(uint64 round, bytes memory s) internal view {
        uint256 used = _refused(round, s);
        assertGt(used, TWO_PAIRS);
        assertLt(used, PAIRING_GAS);
    }

    function _row(bytes memory rows, uint256 i) internal pure returns (bytes memory s, bytes memory expected) {
        s = new bytes(48);
        bytes memory x = new bytes(48);
        bytes memory y = new bytes(64);
        for (uint256 j; j < 48; j++) {
            s[j] = rows[i * 112 + j];
            x[j] = s[j];
        }
        x[0] = x[0] & 0x1f;
        for (uint256 j; j < 64; j++) {
            y[j] = rows[i * 112 + 48 + j];
        }
        expected = bytes.concat(new bytes(16), x, y);
    }

    /// Each row decompresses to noble's point; PAIRING_CHECK agrees on whether it is in G1; the beacon refuses it.
    function _checkRows(bytes memory rows, bool inG1) internal view returns (uint256 n) {
        n = rows.length / 112;
        assertEq(rows.length, n * 112);
        for (uint256 i; i < n; i++) {
            (bytes memory s, bytes memory expected) = _row(rows, i);
            assertEq(harness.decompress(s), expected, "decompression differs from noble");
            (bool ok, bytes memory out) =
                address(0x0f).staticcall{gas: 300_000}(bytes.concat(expected, G2, expected, NEG_G2));
            if (inG1) {
                assertTrue(ok, "PAIRING_CHECK refused a point of G1");
                assertEq(out, abi.encode(uint256(1)));
                _refusedByAFalsePairing(1000, s);
            } else {
                assertFalse(ok, "PAIRING_CHECK took a point outside G1");
                _refusedByAFailingPairing(1000, s);
            }
        }
    }

    function _raw(bytes memory callData) internal view returns (bool ok, bytes memory ret) {
        (ok, ret) = address(drand).staticcall(callData);
    }

    function _drandDecision(bytes32 id, uint8 role, uint8 outcome, uint64 round, bytes memory sig)
        internal
        view
        returns (H.Decision memory m)
    {
        m = _decision(role, outcome);
        m.beaconSourceHash = keccak256("drand-quicknet");
        m.beaconRound = round;
        m.beaconValue = sha256(sig);
        m.beaconSignature = sig;
        m.seed = hx.panelSeed(id, role, m.attempt, m.beaconValue);
    }

    function _toFallback() internal returns (H.Terms memory t, bytes32 id) {
        (t, id) = _funded();
        _deliver(t, id);
        vm.warp(t.timing.judgeBy);
        rules.triggerFallback(t);
        assertEq(drand.roundAt(t.timing.judgeBy), FALLBACK_ROUND);
    }

    function _timeOf(uint256 round) internal pure returns (uint256) {
        return GENESIS + (round - 1) * 3; // drand common/time.go, TimeOfRound
    }

    // ============================================================ goal 1: forge

    /// Attack: a real signature plus a point of small order. The pairing value of such a sum equals the real
    /// signature's, so a verifier with no subgroup check would take it, and each sum would be a second seed for the
    /// round. Expected: refused. Result: PAIRING_CHECK fails for every one (orders 11, 10177, 859267, 52437899 and
    /// a mixed-order point; order 3 is in DrandEncodings.t.sol).
    function test_attack_forge_realSignaturePlusASmallOrderPoint_refusedByThePairing() public view {
        _refusedByAFailingPairing(1000, SIG_PLUS_ORDER_11);
        _refusedByAFailingPairing(1000, SIG_PLUS_ORDER_10177);
        _refusedByAFailingPairing(1000, SIG_PLUS_ORDER_859267);
        _refusedByAFailingPairing(1000, SIG_PLUS_ORDER_52437899);
        _refusedByAFailingPairing(1000, SIG_PLUS_COFACTOR_POINT);
    }

    /// Attack: the small-order points alone, for several rounds. Expected and result: PAIRING_CHECK fails.
    function test_attack_forge_smallOrderPointsAlone_refusedByThePairing() public view {
        uint64[3] memory rounds = [uint64(0), 1000, type(uint64).max];
        for (uint256 i; i < rounds.length; i++) {
            _refusedByAFailingPairing(rounds[i], ORDER_11);
            _refusedByAFailingPairing(rounds[i], ORDER_10177);
            _refusedByAFailingPairing(rounds[i], ORDER_859267);
            _refusedByAFailingPairing(rounds[i], ORDER_52437899);
        }
    }

    /// Attack: find an x whose decompressed y differs from the reference (a wrong y would be a different point).
    /// Expected and result: every random point of G1 and every random curve point outside it decompresses to
    /// noble's point, with either sign.
    function test_attack_forge_decompression_matchesNobleOnRandomPoints() public view {
        assertEq(_checkRows(G1_ROWS, true), 16);
        assertEq(_checkRows(CURVE_ROWS, false), 16);
    }

    /// Attack: the edge values of the two-word arithmetic: x = 0, a carry out of the low word in x^3 + 4, and y
    /// next to (p - 1) / 2. Expected and result: noble's point each time.
    function test_attack_forge_decompression_matchesNobleAtTheArithmeticEdges() public view {
        assertEq(_checkRows(EDGE_ROWS, false), 12);
    }

    /// Attack: the branches no curve point reaches. x = p - 1 is the only x whose x^3 + 4 wraps past p with a cube
    /// (p - 2, p - 3, p - 4 are not cubes; -4 is not a cube either, so y = 0 never occurs). Expected and result:
    /// refused by the square-root check, before the pairing.
    function test_attack_forge_wrapAndCarryWithNoPoint_refusedBeforeThePairing() public {
        bytes[3] memory xs = [WRAP_NO_POINT, CARRY_NO_POINT_A, CARRY_NO_POINT_B];
        for (uint256 i; i < xs.length; i++) {
            assertLt(_refused(1000, xs[i]), BEFORE_THE_PAIRING);
            bytes memory s = xs[i];
            s[0] = s[0] | 0x20;
            assertLt(_refused(1000, s), BEFORE_THE_PAIRING);
            vm.expectRevert(INVALID);
            harness.decompress(xs[i]);
        }
    }

    /// Attack: points of G1 an attacker can compute from published rounds (a sum of two signatures, a double), and
    /// a signature of the same message under another key. Expected and result: the pairing answers false.
    function test_attack_forge_pointsBuiltFromRealSignatures_refused() public view {
        uint64[4] memory rounds = [uint64(1), 1000, 1001, 2000];
        for (uint256 i; i < rounds.length; i++) {
            _refusedByAFalsePairing(rounds[i], SIG_1000_PLUS_SIG_1);
            _refusedByAFalsePairing(rounds[i], TWO_SIG_1000);
            _refusedByAFalsePairing(rounds[i], OTHER_KEY_SIG_1000);
        }
    }

    /// Attack: a real signature for a round that is a re-reading of its own round number (little-endian, shifted,
    /// off by one, 0, the maximum). Expected and result: refused.
    function test_attack_forge_realSignatureForAMisreadRound_refused() public view {
        uint64[7] memory rounds = [
            uint64(0xe803000000000000), // 1000 as 8 little-endian bytes
            uint64(1000) << 32,
            uint64(1000) << 8,
            999,
            1001,
            0,
            type(uint64).max
        ];
        for (uint256 i; i < rounds.length; i++) {
            _refusedByAFalsePairing(rounds[i], SIG_1000);
        }
    }

    /// Attack: calldata that is not the canonical ABI encoding. Expected: the call reverts, or returns the one
    /// value sha256(the 48 signature bytes). Result: so it does. The calldata is malleable; the value is not.
    function test_attack_forge_dirtyCalldata_neverASecondValue() public view {
        bytes4 sel = DrandQuicknetBeacon.beaconValue.selector;
        bytes memory value = abi.encode(sha256(SIG_1000));
        bool ok;
        bytes memory ret;

        // The canonical encoding, for reference.
        (ok, ret) = _raw(abi.encodePacked(sel, uint256(1000), uint256(0x40), uint256(48), SIG_1000, bytes16(0)));
        assertTrue(ok);
        assertEq(ret, value);
        // Non-zero padding after the 48 bytes.
        (ok, ret) =
            _raw(abi.encodePacked(sel, uint256(1000), uint256(0x40), uint256(48), SIG_1000, bytes16(type(uint128).max)));
        assertTrue(ok);
        assertEq(ret, value);
        // No padding at all, and trailing bytes after the padding.
        (ok, ret) = _raw(abi.encodePacked(sel, uint256(1000), uint256(0x40), uint256(48), SIG_1000));
        assertTrue(ok);
        assertEq(ret, value);
        (ok, ret) =
            _raw(abi.encodePacked(sel, uint256(1000), uint256(0x40), uint256(48), SIG_1000, bytes16(0), keccak256("x")));
        assertTrue(ok);
        assertEq(ret, value);
        // The signature placed further on, behind 32 bytes the decoder skips.
        (ok, ret) = _raw(
            abi.encodePacked(sel, uint256(1000), uint256(0x60), keccak256("gap"), uint256(48), SIG_1000, bytes16(0))
        );
        assertTrue(ok);
        assertEq(ret, value);

        // Dirty high bits in the round word: the decoder refuses, so 2^64 + 1000 is not read as round 1000.
        (ok,) = _raw(abi.encodePacked(sel, (uint256(1) << 64) | 1000, uint256(0x40), uint256(48), SIG_1000, bytes16(0)));
        assertFalse(ok);
        (ok,) =
            _raw(abi.encodePacked(sel, (uint256(1) << 255) | 1000, uint256(0x40), uint256(48), SIG_1000, bytes16(0)));
        assertFalse(ok);
        // Dirty high bits in the length word, and a length that runs past the calldata.
        (ok,) = _raw(abi.encodePacked(sel, uint256(1000), uint256(0x40), (uint256(1) << 64) | 48, SIG_1000, bytes16(0)));
        assertFalse(ok);
        (ok,) = _raw(abi.encodePacked(sel, uint256(1000), uint256(0x40), uint256(48), bytes32(SIG_1000)));
        assertFalse(ok);
        // An offset of zero makes the round word the length word: with round 48 the "signature" is the offset word
        // and what follows it. It starts with a zero byte, so the flags refuse it.
        (ok, ret) = _raw(abi.encodePacked(sel, uint256(48), uint256(0), uint256(48), SIG_1000, bytes16(0)));
        assertFalse(ok);
        assertEq(ret, abi.encodeWithSelector(INVALID));
        // An offset that points back at the selector's neighbourhood or far past the end.
        (ok,) = _raw(abi.encodePacked(sel, uint256(1000), type(uint256).max - 3, uint256(48), SIG_1000, bytes16(0)));
        assertFalse(ok);
        (ok,) = _raw(abi.encodePacked(sel, uint256(1000), uint256(1) << 32, uint256(48), SIG_1000, bytes16(0)));
        assertFalse(ok);
    }

    /// Attack: 200 strings of 48 bytes with the compressed flag, for as many rounds (a keccak counter, so the run
    /// is the same every time). Expected: refused, at a bounded cost. Result: none verified. A string whose x has a
    /// curve point reaches the pairing and burns the cap; no refusal cost more than the cap plus 40,000 gas.
    function test_attack_forge_twoHundredCompressedStrings_refusedAtABoundedCost() public {
        uint256 worst;
        uint256 reachedThePairing;
        for (uint256 i; i < 200; i++) {
            bytes32 head = keccak256(abi.encode("t343 head", i));
            bytes32 tail = keccak256(abi.encode("t343 tail", i));
            bytes memory s = abi.encodePacked(head, bytes16(tail));
            s[0] = (s[0] & 0x1f) | (i % 2 == 0 ? bytes1(0xa0) : bytes1(0x80));
            uint256 used = _refused(uint64(uint256(tail)), s);
            if (used > worst) worst = used;
            if (used > PAIRING_GAS) reachedThePairing++;
        }
        assertLt(worst, PAIRING_GAS + 40_000);
        assertGt(reachedThePairing, 40, "too few strings had a curve point to say anything about the pairing");
        emit log_named_uint("strings of 200 that reached the pairing", reachedThePairing);
        emit log_named_uint("dearest refusal by the beacon (gas)", worst);
    }

    /// Attack: a round whose hash to G1 differs from the reference (the signature of such a round would be refused,
    /// or another message's signature taken). Expected and result: rounds 0, 2, 2^32, 2^63 and 2^64 - 1 hash to
    /// noble's point; the message is sha256 of the round as 8 big-endian bytes.
    function test_attack_break_hashToG1_matchesNobleForUnusualRounds() public view {
        uint64[5] memory rounds = [uint64(0), 2, uint64(1) << 32, uint64(1) << 63, type(uint64).max];
        bytes32[5] memory messages = [
            bytes32(0xaf5570f5a1810b7af78caf4bc70a660f0df51e42baf91d4de5b2328de0e83dfc),
            0xcd04a4754498e06db5a13c5f371f1f04ff6d2470f24aa9bd886540e5dce77f70,
            0xcbbc48750debb8535093b3deaf88ac7f4cff87425576a58de2bac754acdb4616,
            0xb1b0bee5378188f5250138bcce25855f2617f9c55b20b9628e13d367c47404a9,
            0x12a3ae445661ce5dee78d0650d33362dec29c4f82af05e7e57fb595bbbacf0ca
        ];
        bytes[5] memory points = [
            bytes(
                hex"00000000000000000000000000000000037966060904391933774a727140660c027947ddf85135f9eeb2dded31d6c679acc77a46f3232bde578314d0c60410460000000000000000000000000000000012ddf5b27acb5fdac6154bca177ce9fcf5175dbc2ca82397d75643201cd01939d49e8128042978258c1b1f7795e4007f"
            ),
            hex"000000000000000000000000000000000c734ef6e2d05f82648627a31e5fd7622373284a96220c1556302b3456382538afad03e3be3e7a6ca95e5985730cf99600000000000000000000000000000000012e140aa51cc3557f60073383c573b99f64b31274ce5f3cc133956d191ca300db54eb9c31c4c386498ea3b7ed95a19d",
            hex"000000000000000000000000000000000048d96eaa9c1d9fea946f660ebc16db3a1cd056406edaa5f8ff0d683827481cc8441f041b0a6687d45868efb60dc9a9000000000000000000000000000000000911b155c5e3bcc0cbe3152590f2ca1f20d1e6e9d141564036da06c6cd4d58071644531c16323fb043e70c238cc46d13",
            hex"0000000000000000000000000000000016542249ce836933d48a62b8fa15c2b741c8a5f5157a27ee55ee35838229580c87b220eeea50d8933b5efcc296645c200000000000000000000000000000000013d81ce46e72f6b675f0d1878389d0bbaf63eb1851e1a80325b7a493295789df94db813d7ca889ffec611fb215184026",
            hex"0000000000000000000000000000000010e8f7c93870eefa465c9c4ead999e4651d13ce1efb9fcf0c914ab634fe350244df38e0b9d32da5324902a69ac16bb3e00000000000000000000000000000000050b5d4c2d905d81366b8387e90aea4791ac00f6ed690d69d34f782e7a22b44c9ebf7a3efcc9ed88b326592c02fecf51"
        ];
        for (uint256 i; i < rounds.length; i++) {
            assertEq(sha256(abi.encodePacked(rounds[i])), messages[i], "the round's message");
            assertEq(drand.hashToG1(messages[i]), points[i], "hash to G1 differs from noble");
        }
    }

    // ============================================================ goal 2: break

    /// Attack: relay a valid fallback decision with too little gas, so the capped pairing call starves. Expected:
    /// the transaction reverts and changes nothing; the same decision settles with more gas. Result: so it does.
    /// One thing to know: in a band of gas limits the revert is `InvalidSignature`, not out-of-gas, although the
    /// signature is valid.
    function test_attack_break_validDecisionWithTooLittleGas_revertsAndSettlesOnRetry() public {
        (H.Terms memory t, bytes32 id) = _toFallback();
        H.Decision memory m = _drandDecision(id, H.ROLE_FALLBACK, H.OUTCOME_ACCEPT, FALLBACK_ROUND, FALLBACK_SIG);
        m = _signDecision(t, id, m, fallbackAdj, FB_PK);
        bytes memory callData = abi.encodeCall(rules.decide, (t, m, _noDelivery(), ""));

        uint256 saidInvalid;
        uint256 firstSettled;
        for (uint256 g = 60_000; g <= 600_000; g += 5_000) {
            (bool ok, bytes memory ret) = address(rules).call{gas: g}(callData);
            if (ok) {
                firstSettled = g;
                break;
            }
            assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.FallbackJudging), "a failed relay changed state");
            if (ret.length == 4 && bytes4(ret) == INVALID) saidInvalid++;
        }
        assertGt(firstSettled, 0, "the decision never settled");
        assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.Released));
        assertGt(saidInvalid, 0, "no gas limit produced InvalidSignature for the valid proof");
        emit log_named_uint("gas limits, 5,000 gas apart, where the valid proof says InvalidSignature", saidInvalid);
        emit log_named_uint("least gas limit at which the valid fallback decision settles", firstSettled);
    }

    /// Attack: the runtime code placed without running the constructor (the artifact's deployedBytecode, as a
    /// genesis allocation or `vm.etch` would place it). The immutable P_LO is then zero. Expected: nothing is
    /// accepted. Result: every real round is refused, and so is everything else tried; such a copy is dead, not
    /// forgeable.
    function test_boundary_break_runtimeCodeWithoutTheConstructor_refusesEveryRealRound() public {
        bytes memory code = vm.getDeployedCode("DrandQuicknetBeacon.sol:DrandQuicknetBeacon");
        assertTrue(keccak256(code) != keccak256(address(drand).code), "the artifact carries P_LO; nothing to test");
        address copy = makeAddr("beacon without constructor");
        vm.etch(copy, code);
        assertEq(DrandQuicknetBeacon(copy).roundAt(GENESIS), 1, "the copy runs");

        bool ok;
        (ok,,) = _try(copy, 1, SIG_1);
        assertFalse(ok);
        (ok,,) = _try(copy, 1000, SIG_1000);
        assertFalse(ok);
        (ok,,) = _try(copy, FALLBACK_ROUND, FALLBACK_SIG);
        assertFalse(ok);
        (ok,,) = _try(copy, 1000, ORDER_11);
        assertFalse(ok);
        (ok,,) = _try(copy, 1000, WRAP_NO_POINT);
        assertFalse(ok);
        bytes memory zero = new bytes(48);
        zero[0] = 0x80;
        (ok,,) = _try(copy, 1000, zero);
        assertFalse(ok);
        // The constructed beacon takes the same real rounds.
        assertEq(drand.beaconValue(1, SIG_1), sha256(SIG_1));
        assertEq(drand.beaconValue(FALLBACK_ROUND, FALLBACK_SIG), sha256(FALLBACK_SIG));
    }

    // ============================================================ goal 3: burn

    /// Attack: make a relayer pay for a refusal. `decide` checks the beacon proof before the adjudicator's
    /// signature, so anyone can write a Decision that reaches the pairing: no adjudicator has to sign it. With a
    /// curve point outside G1 as the proof, the pairing burns its whole cap. Expected: the cost stays near the cap.
    /// Result: 300,823 gas under Prague prices, against 153,985 gas for a wrong point of G1; a wrong round costs
    /// 17,417 gas, because the round is compared before the proof is looked at.
    function test_attack_burn_unsignedDecisionWithAPointOutsideG1_costsItsRelayerTheCapAndLittleMore() public {
        (H.Terms memory t, bytes32 id) = _toFallback();
        H.Decision memory m = _drandDecision(id, H.ROLE_FALLBACK, H.OUTCOME_ACCEPT, FALLBACK_ROUND, ORDER_11);
        m.deliveryHash = _namedDelivery(id); // public: JobSubmitted emitted it
        assertEq(m.signature.length, 0, "nobody signed this decision");

        uint256 g = gasleft();
        try rules.decide(t, m, _noDelivery(), "") {
            fail();
        } catch (bytes memory err) {
            uint256 outsideG1 = g - gasleft();
            assertEq(bytes4(err), INVALID);
            assertGt(outsideG1, PAIRING_GAS);
            assertLt(outsideG1, PAIRING_GAS + 80_000, "dearer than the cap plus 80,000 gas");
            emit log_named_uint("decide, unsigned, proof outside G1 (gas)", outsideG1);
        }

        m = _drandDecision(id, H.ROLE_FALLBACK, H.OUTCOME_ACCEPT, FALLBACK_ROUND, APPEAL_SIG);
        m.deliveryHash = _namedDelivery(id);
        g = gasleft();
        try rules.decide(t, m, _noDelivery(), "") {
            fail();
        } catch (bytes memory err) {
            uint256 wrongPoint = g - gasleft();
            assertEq(bytes4(err), INVALID);
            assertLt(wrongPoint, PAIRING_GAS);
            emit log_named_uint("decide, unsigned, another round's signature (gas)", wrongPoint);
        }

        m = _drandDecision(id, H.ROLE_FALLBACK, H.OUTCOME_ACCEPT, FALLBACK_ROUND + 1, ORDER_11);
        m.deliveryHash = _namedDelivery(id);
        g = gasleft();
        try rules.decide(t, m, _noDelivery(), "") {
            fail();
        } catch (bytes memory err) {
            uint256 wrongRound = g - gasleft();
            assertEq(bytes4(err), HoldbackRules.BadSeed.selector);
            assertLt(wrongRound, 60_000, "a wrong round reached the beacon");
            emit log_named_uint("decide, unsigned, wrong round (gas)", wrongRound);
        }
        assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.FallbackJudging));
    }

    // ============================================================ goal 4: wrong round

    /// Measure: when the rounds `decide` uses are published, against the time that fixes them. The appeal round,
    /// roundAt(t) + 1, is published 3 - ((t - genesis) mod 3) seconds after t: 1, 2 or 3 s. The fallback round,
    /// roundAt(judgeBy), is published (judgeBy - genesis) mod 3 seconds before judgeBy: 0, 1 or 2 s (known, T-225 M1).
    function test_measure_wrongRound_appealRoundPublishesOneToThreeSecondsAfterItsTimestamp() public view {
        for (uint256 t = 1_790_000_000; t < 1_790_000_300; t++) {
            uint256 residue = (t - GENESIS) % 3;
            uint256 appealRound = uint256(drand.roundAt(t)) + 1;
            assertEq(_timeOf(appealRound) - t, 3 - residue);
            assertEq(t - _timeOf(drand.roundAt(t)), residue);
        }
        assertEq((uint256(1_790_000_000) - GENESIS) % 3, 2, "the Base clock is 1 s before a round");
        assertEq(_timeOf(APPEAL_ROUND), 1_790_000_001);
    }

    /// Issue: the appeal round is "the first round strictly after" the block timestamp of the step that fixes it,
    /// and the contract takes that round's proof in a block with the same timestamp. drand published round 32398879
    /// at 1790000001. Here the escalation and the appeal decision that carries that round's signature both land at
    /// block time 1790000000. On a real chain that means the block was put together at least 1 s after its own
    /// timestamp, which block producers do. Expected if the round were unknowable at the fixing step: no
    /// transaction with that timestamp could carry the proof. Result: the contract accepts it.
    function test_issue_wrongRound_appealRoundIsProvenAtTheTimestampThatFixesIt() public {
        (H.Terms memory t, bytes32 id) = _funded();
        _deliver(t, id);
        rules.decide(t, _primary(t, id, H.OUTCOME_ESCALATE), _noDelivery(), "");
        assertEq(block.timestamp, 1_790_000_000);
        assertEq(rules.dealOf(id).t1, 1_790_000_000);
        assertGt(_timeOf(APPEAL_ROUND), block.timestamp, "the round is published after this block's timestamp");

        H.Decision memory m = _drandDecision(id, H.ROLE_APPEAL, H.OUTCOME_REJECT, APPEAL_ROUND, APPEAL_SIG);
        m = _signDecision(t, id, m, appealAdj, AP_PK);
        rules.decide(t, m, _noDelivery(), ""); // no warp: the same timestamp
        assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.Refunded));
    }

    /// Issue: a gate on the escalation (the party-appeal variant of this finding left with `fileAppeal`, T-346,
    /// ADR-0031 §8). Whoever relays the primary's signed escalation (anyone may) lands it
    /// only in a block whose next round gives the appeal panel it wants.
    function test_issue_wrongRound_relayerLandsTheEscalationOnlyWhenTheAppealSeedSuitsIt() public {
        (H.Terms memory t, bytes32 id) = _funded();
        _deliver(t, id);
        H.Decision memory esc = _primary(t, id, H.OUTCOME_ESCALATE);
        bytes32 seed = hx.panelSeed(id, H.ROLE_APPEAL, 1, sha256(APPEAL_SIG));
        uint256 suits = uint256(seed) % 18;

        vm.expectRevert(abi.encodeWithSelector(SeedGatedFiler.SeedDoesNotSuit.selector, seed));
        filer.escalateIfSeedSuits(rules, t, esc, _noDelivery(), id, APPEAL_SIG, 18, (suits + 5) % 18);
        assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.Delivered));

        assertEq(filer.escalateIfSeedSuits(rules, t, esc, _noDelivery(), id, APPEAL_SIG, 18, suits), seed);
        assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.Escalated));
        assertEq(rules.dealOf(id).t1, 1_790_000_000);
    }

    /// Attack: an appeal decision that names a round other than the one state fixes (the round at the fixing time,
    /// already public, or a later one). Expected and result: BadSeed, before the proof is looked at.
    function test_attack_wrongRound_appealDecisionForANeighbouringRound_refused() public {
        (H.Terms memory t, bytes32 id) = _funded();
        _deliver(t, id);
        rules.decide(t, _primary(t, id, H.OUTCOME_ESCALATE), _noDelivery(), "");
        vm.warp(block.timestamp + 10);
        uint64[3] memory rounds = [APPEAL_ROUND - 1, APPEAL_ROUND + 1, APPEAL_ROUND + 3];
        for (uint256 i; i < rounds.length; i++) {
            H.Decision memory m = _drandDecision(id, H.ROLE_APPEAL, H.OUTCOME_REJECT, rounds[i], APPEAL_SIG);
            m = _signDecision(t, id, m, appealAdj, AP_PK);
            vm.expectRevert(HoldbackRules.BadSeed.selector);
            rules.decide(t, m, _noDelivery(), "");
        }
    }

    // ============================================================ goal 5: wrong chain or fork

    /// Attack: a chain whose address 0x0f answers in another shape (another precompile, or a changed one).
    /// Expected and result: the real signature is refused unless the answer is exactly the 32-byte word 1.
    function test_attack_fork_pairingAnswerOfAnotherShape_refused() public {
        bytes[6] memory answers = [
            bytes(""),
            abi.encode(uint256(0)),
            abi.encode(uint256(2)),
            abi.encodePacked(bytes1(0x01), bytes31(0)), // "true" left-aligned
            abi.encodePacked(uint256(1), uint256(0)), // the word 1, then 32 more bytes
            abi.encodePacked(bytes31(uint248(1))) // 31 bytes
        ];
        for (uint256 i; i < answers.length; i++) {
            vm.mockCall(address(0x0f), bytes(""), answers[i]);
            _refused(1000, SIG_1000);
            vm.clearMockedCalls();
        }
        assertEq(drand.beaconValue(1000, SIG_1000), sha256(SIG_1000), "the real precompile is back");
    }

    /// Attack: a chain whose 0x10 or 0x0b answers with another length. Expected and result: refused.
    function test_attack_fork_mapOrAddAnswerOfAnotherLength_refused() public {
        vm.mockCall(address(0x10), bytes(""), new bytes(96));
        _refused(1000, SIG_1000);
        vm.clearMockedCalls();
        vm.mockCall(address(0x10), bytes(""), new bytes(160));
        _refused(1000, SIG_1000);
        vm.clearMockedCalls();
        vm.mockCall(address(0x0b), bytes(""), new bytes(64));
        _refused(1000, SIG_1000);
        vm.clearMockedCalls();
        vm.mockCallRevert(address(0x0b), bytes(""), bytes(""));
        _refused(1000, SIG_1000);
        vm.clearMockedCalls();
    }

    /// Boundary: a chain that prices a two-pair PAIRING_CHECK above the beacon's fixed cap of 250,000 gas (EIP-2537
    /// charges 102,900). forge cannot reprice a precompile, so the failing capped call is simulated: that is what
    /// the beacon sees when the cap is too small. Result: every real round is refused, a valid fallback decision
    /// cannot settle, and the deal can only default to the buyer. The cap is a constant and HoldbackRules.BEACON
    /// is immutable, so nothing short of new contracts repairs it.
    function test_boundary_fork_aPairingPricedAboveTheCap_everyFallbackDealDefaultsToTheBuyer() public {
        (H.Terms memory t, bytes32 id) = _toFallback();
        H.Decision memory m = _drandDecision(id, H.ROLE_FALLBACK, H.OUTCOME_ACCEPT, FALLBACK_ROUND, FALLBACK_SIG);
        m = _signDecision(t, id, m, fallbackAdj, FB_PK);

        vm.mockCallRevert(address(0x0f), bytes(""), bytes(""));
        _refused(FALLBACK_ROUND, FALLBACK_SIG);
        vm.expectRevert(INVALID);
        rules.decide(t, m, _noDelivery(), "");
        uint256 buyerBefore = usdc.balanceOf(buyer);
        vm.warp(t.timing.fallbackBy);
        rules.triggerDefault(t);
        assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.Refunded));
        assertEq(usdc.balanceOf(buyer) - buyerBefore, PRICE + FEE, "the buyer gets price and fee back");
        vm.clearMockedCalls();
    }

    /// Boundary: what the contract trusts. If address 0x0f answered 1 without checking, any curve point would be
    /// a "signature": here a point of order 11 gets a value for round 1000. Only the precompile stands between a
    /// point outside G1 and an accepted second encoding; the contract has no subgroup check of its own.
    function test_boundary_fork_aPairingThatAlwaysAnswersTrue_acceptsAPointOutsideG1() public {
        vm.mockCall(address(0x0f), bytes(""), abi.encode(uint256(1)));
        assertEq(drand.beaconValue(1000, ORDER_11), sha256(ORDER_11));
        assertEq(drand.beaconValue(1000, SIG_PLUS_ORDER_11), sha256(SIG_PLUS_ORDER_11));
        vm.clearMockedCalls();
        _refusedByAFailingPairing(1000, ORDER_11);
    }
}
