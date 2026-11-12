// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {HoldbackRules} from "../../src/HoldbackRules.sol";
import {IHoldbackRules} from "../../src/IHoldbackRules.sol";
import {HoldbackTypes as H} from "../../src/HoldbackTypes.sol";
import {DrandQuicknetBeacon} from "../../src/DrandQuicknetBeacon.sol";
import {Base} from "./Base.sol";

/// T-209: HoldbackRules deployed with the drand quicknet verifier. Fallback and appeal decisions must carry the real
/// quicknet signature of the round settlement state fixes; the value is sha256(signature) and the seed follows from
/// it. The rounds are real (fixtures/beacon/drand-quicknet.json): the Base clock starts at 1790000000 and the terms'
/// judgeBy is 1790172800. With the margin of Ethereum mainnet and Sepolia, 29 s (ADR-0032), the fallback round is
/// 32456489, the first after judgeBy - 1 + 29 (published at 1790172831), and the round after an escalation at 1790000000
/// is 32398889, the first after 1790000029 (published at 1790000031).
contract DrandDecideTest is Base {
    DrandQuicknetBeacon internal drand;

    uint64 internal constant FALLBACK_ROUND = 32_456_489;
    bytes internal constant FALLBACK_SIG =
        hex"80e0f0939fbf00616f0b7c6c72f49ac3830e71a9de74caf893d8e2ab87e09cf4c4c25e22ade438341af31e5b8e8ef19a";
    bytes32 internal constant FALLBACK_RAND = 0xef651f11574106af1fa2a82281a0f2035ade32ab6436a38aadefb87c44d45c42;
    uint64 internal constant APPEAL_ROUND = 32_398_889;
    bytes internal constant APPEAL_SIG =
        hex"aadc47543192e0e9a42d523c61497580755ffa8b27904517dfe9fe8598405ae9b31d5193ece7c71e38cada7d76581584";
    bytes32 internal constant APPEAL_RAND = 0xdc2dd34fdb40f96278691242ba26f20f9f4e212c6ea4afe1b630aa9749eeed55;

    function setUp() public override {
        super.setUp();
        drand = new DrandQuicknetBeacon();
        rules = new HoldbackRules(escrow, address(collector3009), MARGIN, drand, address(usdc), DRAND_MARGIN);
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
        vm.expectEmit(address(rules));
        emit IHoldbackRules.FallbackTriggered(id, FALLBACK_ROUND);
        rules.triggerFallback(t);
        assertEq(drand.roundAt(t.timing.judgeBy - 1 + DRAND_MARGIN) + 1, FALLBACK_ROUND, "the fixture round");
        vm.warp(1_790_172_831); // round 32456489 is published at judgeBy + 31 s
    }

    function test_fallback_decidesWithTheRealQuicknetRound() public {
        (H.Terms memory t, bytes32 id) = _toFallback();
        H.Decision memory m = _drandDecision(id, H.ROLE_FALLBACK, H.OUTCOME_ACCEPT, FALLBACK_ROUND, FALLBACK_SIG);
        assertEq(m.beaconValue, FALLBACK_RAND, "value = sha256(signature) = drand's randomness");
        m = _signDecision(t, id, m, fallbackAdj, FB_PK);
        rules.decide(t, m, _noDelivery(), "");
        assertEq(uint8(_stage(id)), uint8(IHoldbackRules.Stage.Released));
    }

    function test_appeal_afterEscalation_decidesWithTheNextRealRound() public {
        (H.Terms memory t, bytes32 id) = _funded();
        _deliver(t, id);
        rules.decide(t, _primary(t, id, H.OUTCOME_ESCALATE), _noDelivery(), "");
        assertEq(drand.roundAt(block.timestamp + DRAND_MARGIN) + 1, APPEAL_ROUND);
        vm.warp(block.timestamp + 31); // round 32398889 is published at 1790000031
        H.Decision memory m = _drandDecision(id, H.ROLE_APPEAL, H.OUTCOME_REJECT, APPEAL_ROUND, APPEAL_SIG);
        assertEq(m.beaconValue, APPEAL_RAND);
        m = _signDecision(t, id, m, appealAdj, AP_PK);
        rules.decide(t, m, _noDelivery(), "");
        assertEq(uint8(_stage(id)), uint8(IHoldbackRules.Stage.Refunded));
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
        vm.expectRevert(IHoldbackRules.BadSeed.selector);
        rules.decide(t, m, _noDelivery(), "");
    }

    function test_fallback_refusesAChosenSeedWithAValidProof() public {
        (H.Terms memory t, bytes32 id) = _toFallback();
        H.Decision memory m = _drandDecision(id, H.ROLE_FALLBACK, H.OUTCOME_ACCEPT, FALLBACK_ROUND, FALLBACK_SIG);
        m.seed = keccak256("shopped panel");
        m = _signDecision(t, id, m, fallbackAdj, FB_PK);
        vm.expectRevert(IHoldbackRules.BadSeed.selector);
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
        vm.expectRevert(IHoldbackRules.BadSeed.selector);
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
        vm.expectRevert(IHoldbackRules.BadSignature.selector);
        rules.decide(t, m, _noDelivery(), "");
    }
}
