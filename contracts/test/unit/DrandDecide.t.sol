// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {HoldbackRules} from "../../src/HoldbackRules.sol";
import {HoldbackTypes as H} from "../../src/HoldbackTypes.sol";
import {DrandQuicknetBeacon} from "../../src/DrandQuicknetBeacon.sol";
import {Base} from "./Base.sol";

/// T-209: HoldbackRules deployed with the drand quicknet verifier. Fallback and appeal decisions must carry the real
/// quicknet signature of the round settlement state fixes; the value is sha256(signature) and the seed follows from
/// it. The rounds are real (fixtures/beacon/drand-quicknet.json): the Base clock starts at 1790000000 and the terms'
/// judgeBy is 1790172800, so the fallback round is 32456478 and the first round after an escalation at 1790000000 is
/// 32398879 (published at 1790000001).
contract DrandDecideTest is Base {
    DrandQuicknetBeacon internal drand;

    uint64 internal constant FALLBACK_ROUND = 32_456_478;
    bytes internal constant FALLBACK_SIG =
        hex"b528568aa3bcf0f15bd15391bfd424012dfa4efae8a9b335e3c7aa98871a9108220ac137cf5626cc732db3e1a2e5cdc6";
    bytes32 internal constant FALLBACK_RAND = 0x6e43305f170a9857d0fffa0446668d13dd5907d9eff9f8cee6a3d9774b8a8bad;
    uint64 internal constant APPEAL_ROUND = 32_398_879;
    bytes internal constant APPEAL_SIG =
        hex"8692364a570f4638daa28f489f6ab6c3a3daafc5e80b5fa203f54969b9d104cd2342539a141574dadf291fd1af2df219";
    bytes32 internal constant APPEAL_RAND = 0xcc44c7b6a69f0cc3a74a432f0606011d8856754ca524faffff30741baa0a5f6f;

    function setUp() public override {
        super.setUp();
        drand = new DrandQuicknetBeacon();
        rules = new HoldbackRules(escrow, address(collector3009), address(collectorPermit2), MARGIN, drand);
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
        assertEq(drand.roundAt(t.timing.judgeBy), FALLBACK_ROUND, "the Base clock lands on the fixture round");
    }

    function test_fallback_decidesWithTheRealQuicknetRound() public {
        (H.Terms memory t, bytes32 id) = _toFallback();
        H.Decision memory m = _drandDecision(id, H.ROLE_FALLBACK, H.OUTCOME_ACCEPT, FALLBACK_ROUND, FALLBACK_SIG);
        assertEq(m.beaconValue, FALLBACK_RAND, "value = sha256(signature) = drand's randomness");
        m = _signDecision(t, id, m, fallbackAdj, FB_PK);
        rules.decide(t, m, _noDelivery(), "");
        assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.Released));
    }

    function test_appeal_afterEscalation_decidesWithTheNextRealRound() public {
        (H.Terms memory t, bytes32 id) = _funded();
        _deliver(t, id);
        rules.decide(t, _primary(t, id, H.OUTCOME_ESCALATE), _noDelivery(), "");
        assertEq(drand.roundAt(block.timestamp) + 1, APPEAL_ROUND);
        vm.warp(block.timestamp + 1); // round 32398879 is published at 1790000001
        H.Decision memory m = _drandDecision(id, H.ROLE_APPEAL, H.OUTCOME_REJECT, APPEAL_ROUND, APPEAL_SIG);
        assertEq(m.beaconValue, APPEAL_RAND);
        m = _signDecision(t, id, m, appealAdj, AP_PK);
        rules.decide(t, m, _noDelivery(), "");
        assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.Refunded));
    }

    function test_fallback_refusesTheSimBeaconValue() public {
        (H.Terms memory t, bytes32 id) = _toFallback();
        // A value the decider computed without a proof (here the sim formula) is refused: no proof, no seed.
        H.Decision memory m = _beaconDecision(id, H.ROLE_FALLBACK, H.OUTCOME_ACCEPT, FALLBACK_ROUND);
        m = _signDecision(t, id, m, fallbackAdj, FB_PK);
        vm.expectRevert(DrandQuicknetBeacon.InvalidSignature.selector);
        rules.decide(t, m, _noDelivery(), "");
    }

    function test_fallback_refusesAWrongValue() public {
        (H.Terms memory t, bytes32 id) = _toFallback();
        H.Decision memory m = _drandDecision(id, H.ROLE_FALLBACK, H.OUTCOME_ACCEPT, FALLBACK_ROUND, FALLBACK_SIG);
        m.beaconValue = keccak256("chosen value");
        m.seed = hx.panelSeed(id, H.ROLE_FALLBACK, m.attempt, m.beaconValue);
        m = _signDecision(t, id, m, fallbackAdj, FB_PK);
        vm.expectRevert(HoldbackRules.BadSeed.selector);
        rules.decide(t, m, _noDelivery(), "");
    }

    function test_fallback_refusesAChosenSeedWithAValidProof() public {
        (H.Terms memory t, bytes32 id) = _toFallback();
        H.Decision memory m = _drandDecision(id, H.ROLE_FALLBACK, H.OUTCOME_ACCEPT, FALLBACK_ROUND, FALLBACK_SIG);
        m.seed = keccak256("shopped panel");
        m = _signDecision(t, id, m, fallbackAdj, FB_PK);
        vm.expectRevert(HoldbackRules.BadSeed.selector);
        rules.decide(t, m, _noDelivery(), "");
    }

    function test_fallback_refusesAnotherRoundsProof() public {
        (H.Terms memory t, bytes32 id) = _toFallback();
        // The appeal round's real signature, claimed for the fallback round.
        H.Decision memory m = _drandDecision(id, H.ROLE_FALLBACK, H.OUTCOME_ACCEPT, FALLBACK_ROUND, APPEAL_SIG);
        m = _signDecision(t, id, m, fallbackAdj, FB_PK);
        vm.expectRevert(DrandQuicknetBeacon.InvalidSignature.selector);
        rules.decide(t, m, _noDelivery(), "");
        // And the matching round: the round is fixed by state, not by the message.
        m = _drandDecision(id, H.ROLE_FALLBACK, H.OUTCOME_ACCEPT, APPEAL_ROUND, APPEAL_SIG);
        m = _signDecision(t, id, m, fallbackAdj, FB_PK);
        vm.expectRevert(HoldbackRules.BadSeed.selector);
        rules.decide(t, m, _noDelivery(), "");
    }

    /// The signature bytes are bound by the adjudicator's EIP-712 signature (Beacon.signature is hashed into the
    /// Decision): a relayer cannot attach a proof the adjudicator did not sign.
    function test_proofIsBoundToTheAdjudicatorsSignature() public {
        (H.Terms memory t, bytes32 id) = _toFallback();
        H.Decision memory m = _drandDecision(id, H.ROLE_FALLBACK, H.OUTCOME_ACCEPT, FALLBACK_ROUND, FALLBACK_SIG);
        m.beaconSignature = "";
        m = _signDecision(t, id, m, fallbackAdj, FB_PK); // signed without the proof
        m.beaconSignature = FALLBACK_SIG; // the relayer attaches it
        vm.expectRevert(HoldbackRules.BadSignature.selector);
        rules.decide(t, m, _noDelivery(), "");
    }
}
