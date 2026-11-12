// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {HoldbackRules} from "../../src/HoldbackRules.sol";
import {IHoldbackRules} from "../../src/IHoldbackRules.sol";
import {HoldbackTypes as H} from "../../src/HoldbackTypes.sol";
import {SignerBase, StepRelayer} from "./ContractSigners.sol";

/// T-346 (ADR-0031 §5: every entry point stays permissionless, so another protocol's contract can relay a step inside
/// its own transaction). For each of the nine entry points, the same signed step is run twice from one state: relayed
/// directly by an EOA, and relayed by a contract from inside its own function. Both runs must end in the same state
/// (the deal's storage word, the posted delivery, every party's balance and the token store's) and emit the same
/// logs, byte for byte; the relaying contract ends with no funds and appears in no log. Two and three steps of one deal
/// in one relayed call land as the same steps relayed one by one.
contract RelayFromContractTest is SignerBase {
    StepRelayer internal relay;
    address internal caller;

    function setUp() public override {
        super.setUp();
        relay = new StepRelayer();
        caller = makeAddr("caller of the relaying contract");
    }

    function _logsHash(Vm.Log[] memory logs) internal view returns (bytes32) {
        for (uint256 i; i < logs.length; ++i) {
            assertTrue(logs[i].emitter != address(relay), "the relaying contract emits nothing");
            for (uint256 j; j < logs[i].topics.length; ++j) {
                assertTrue(logs[i].topics[j] != bytes32(uint256(uint160(address(relay)))), "not in a topic");
                assertTrue(logs[i].topics[j] != bytes32(uint256(uint160(relayer))), "not in a topic");
            }
        }
        return keccak256(abi.encode(logs));
    }

    /// Runs `steps` from the current state twice: each as its own direct relay by an EOA, then all in one call of the
    /// relaying contract. Asserts both runs end alike and the relaying contract gains nothing.
    function _landsAlike(H.Terms memory t, bytes32 id, bytes[] memory steps) internal {
        uint256 snap = vm.snapshotState();

        vm.recordLogs();
        for (uint256 i; i < steps.length; ++i) {
            vm.prank(relayer, relayer);
            (bool ok, bytes memory ret) = address(rules).call(steps[i]);
            assertTrue(ok, string.concat("direct step ", vm.toString(i), " lands: ", vm.toString(ret)));
        }
        bytes32 directLogs = _logsHash(vm.getRecordedLogs());
        bytes32 directState = _state(t, id, address(relay));
        IHoldbackRules.Stage directStage = _stage(id);

        assertTrue(vm.revertToState(snap), "back to the state before the direct run");
        vm.recordLogs();
        vm.prank(caller, caller);
        if (steps.length == 1) relay.relay(address(rules), steps[0]);
        else relay.relayAll(address(rules), steps);
        bytes32 relayedLogs = _logsHash(vm.getRecordedLogs());

        assertEq(uint8(_stage(id)), uint8(directStage), "same stage");
        assertEq(_state(t, id, address(relay)), directState, "same state");
        assertEq(relayedLogs, directLogs, "same logs");
        assertEq(relay.relayed(), steps.length, "the steps ran inside the relaying contract's own function");
        assertEq(usdc.balanceOf(address(relay)), 0, "the relaying contract gains no funds");
    }

    function _one(bytes memory step) internal pure returns (bytes[] memory s) {
        s = new bytes[](1);
        s[0] = step;
    }

    function _fundCall(H.Terms memory t) internal view returns (bytes memory) {
        return abi.encodeCall(
            HoldbackRules.agreeAndFund,
            (t, _sellerSig(t, SELLER_PK), _acceptance(t, ADJ_PK), _agree(t, BUYER_PK), _erc3009(t, BUYER_PK))
        );
    }

    function _deliverCall(H.Terms memory t, bytes32 id) internal view returns (bytes memory) {
        (H.Delivery memory d,) = _delivery();
        return abi.encodeCall(HoldbackRules.deliver, (t, d, _deliverySig(id, d, SELLER_PK)));
    }

    function _acceptCall(H.Terms memory t, bytes32 id) internal view returns (bytes memory) {
        return abi.encodeCall(HoldbackRules.decide, (t, _primary(t, id, H.OUTCOME_ACCEPT), _noDelivery(), bytes("")));
    }

    // ------------------------------------------------------------ one entry point at a time

    /// agreeAndFund relayed from a contract funds the deal exactly as a direct relay does.
    function test_relay_agreeAndFund() public {
        H.Terms memory t = _terms();
        bytes32 id = hx.id(t);
        _landsAlike(t, id, _one(_fundCall(t)));
        _is(id, IHoldbackRules.Stage.Held);
    }

    /// deliver relayed from a contract posts the seller-signed delivery exactly as a direct relay does.
    function test_relay_deliver() public {
        (H.Terms memory t, bytes32 id) = _funded();
        _landsAlike(t, id, _one(_deliverCall(t, id)));
        _is(id, IHoldbackRules.Stage.Delivered);
    }

    /// decide relayed from a contract settles the primary's accept exactly as a direct relay does: the price to the
    /// seller and the fee to the primary, never to the relaying contract.
    function test_relay_decide() public {
        (H.Terms memory t, bytes32 id) = _funded();
        _deliver(t, id);
        _landsAlike(t, id, _one(_acceptCall(t, id)));
        _is(id, IHoldbackRules.Stage.Released);
        assertEq(usdc.balanceOf(adjudicator), FEE);
    }

    /// decide in Held, carrying the delivery it judged, relayed from a contract lands exactly as a direct relay does.
    function test_relay_decideCarryingTheDelivery() public {
        (H.Terms memory t, bytes32 id) = _funded();
        (H.Delivery memory d,) = _delivery();
        bytes memory step = abi.encodeCall(
            HoldbackRules.decide, (t, _primary(t, id, H.OUTCOME_REJECT), d, _deliverySig(id, d, SELLER_PK))
        );
        _landsAlike(t, id, _one(step));
        _is(id, IHoldbackRules.Stage.Refunded);
    }

    /// earlyAccept relayed from a contract releases the price and the buyer's key exactly as a direct relay does.
    function test_relay_earlyAccept() public {
        (H.Terms memory t, bytes32 id) = _funded();
        (H.Delivery memory d, H.KeyProof memory k) = _deliver(t, id);
        bytes memory step = abi.encodeCall(HoldbackRules.earlyAccept, (t, _early(t, id, BUYER_PK), d, bytes(""), k));
        _landsAlike(t, id, _one(step));
        _is(id, IHoldbackRules.Stage.Released);
    }

    /// mutualSettle relayed from a contract pays out the signed split exactly as a direct relay does.
    function test_relay_mutualSettle() public {
        (H.Terms memory t, bytes32 id) = _funded();
        (H.Delivery memory d, H.KeyProof memory k) = _deliver(t, id);
        H.Mutual memory mu = _mutualFor(t, id, BUYER_PK, SELLER_PK, 18_000_000);
        _landsAlike(t, id, _one(abi.encodeCall(HoldbackRules.mutualSettle, (t, mu, d, k))));
        _is(id, IHoldbackRules.Stage.Settled);
    }

    // T-356 (SC-6): `test_relay_expireOffer` left with `expireOffer`; no other entry point changed.

    /// reclaim relayed from a contract returns price and fee to the buyer exactly as a direct relay does.
    function test_relay_reclaim() public {
        (H.Terms memory t, bytes32 id) = _funded();
        vm.warp(t.timing.deliverBy);
        _landsAlike(t, id, _one(abi.encodeCall(HoldbackRules.reclaim, (t))));
        _is(id, IHoldbackRules.Stage.Refunded);
    }

    /// triggerFallback relayed from a contract hands the case to the fallback exactly as a direct relay does.
    function test_relay_triggerFallback() public {
        (H.Terms memory t, bytes32 id) = _funded();
        _deliver(t, id);
        vm.warp(t.timing.judgeBy);
        _landsAlike(t, id, _one(abi.encodeCall(HoldbackRules.triggerFallback, (t))));
        _is(id, IHoldbackRules.Stage.FallbackJudging);
    }

    /// triggerDefault relayed from a contract, after the fallback missed fallbackBy, refunds the buyer exactly as a
    /// direct relay does.
    function test_relay_triggerDefault_afterFallback() public {
        (H.Terms memory t, bytes32 id) = _funded();
        _deliver(t, id);
        vm.warp(t.timing.judgeBy);
        rules.triggerFallback(t);
        vm.warp(t.timing.fallbackBy);
        _landsAlike(t, id, _one(abi.encodeCall(HoldbackRules.triggerDefault, (t))));
        _is(id, IHoldbackRules.Stage.Refunded);
    }

    /// triggerDefault relayed from a contract, after the appeal adjudicator missed its window, refunds the buyer
    /// exactly as a direct relay does.
    function test_relay_triggerDefault_afterEscalation() public {
        (H.Terms memory t, bytes32 id) = _funded();
        _deliver(t, id);
        rules.decide(t, _primary(t, id, H.OUTCOME_ESCALATE), _noDelivery(), "");
        vm.warp(block.timestamp + t.timing.appealDecideSec);
        _landsAlike(t, id, _one(abi.encodeCall(HoldbackRules.triggerDefault, (t))));
        _is(id, IHoldbackRules.Stage.Refunded);
    }

    // ------------------------------------------------------------ several steps of one deal in one call

    /// agreeAndFund then deliver in one call of the relaying contract land as the two steps relayed one by one.
    function test_relay_fundThenDeliver_inOneCall() public {
        H.Terms memory t = _terms();
        bytes32 id = hx.id(t);
        bytes[] memory steps = new bytes[](2);
        steps[0] = _fundCall(t);
        steps[1] = _deliverCall(t, id);
        _landsAlike(t, id, steps);
        _is(id, IHoldbackRules.Stage.Delivered);
    }

    /// deliver then decide in one call of the relaying contract land as the two steps relayed one by one.
    function test_relay_deliverThenDecide_inOneCall() public {
        (H.Terms memory t, bytes32 id) = _funded();
        bytes[] memory steps = new bytes[](2);
        steps[0] = _deliverCall(t, id);
        steps[1] = _acceptCall(t, id); // names `_delivery()`, the delivery step 0 posts
        _landsAlike(t, id, steps);
        _is(id, IHoldbackRules.Stage.Released);
    }

    /// A whole deal, agreeAndFund, deliver and decide, in one call of the relaying contract lands as the three steps
    /// relayed one by one.
    function test_relay_wholeDeal_inOneCall() public {
        H.Terms memory t = _terms();
        bytes32 id = hx.id(t);
        bytes[] memory steps = new bytes[](3);
        steps[0] = _fundCall(t);
        steps[1] = _deliverCall(t, id);
        steps[2] = _acceptCall(t, id);
        _landsAlike(t, id, steps);
        _is(id, IHoldbackRules.Stage.Released);
        assertEq(usdc.balanceOf(adjudicator), FEE);
    }

    /// A relayed call whose second step is refused reverts the first step with it: the delivery does not land on its
    /// own when the decision after it names another attempt. The second step's refusal (InvalidMessage) differs from
    /// any refusal the first step could give, so the revert shows which step was refused.
    function test_relay_refusedSecondStep_revertsTheFirst() public {
        (H.Terms memory t, bytes32 id) = _funded();
        bytes[] memory steps = new bytes[](2);
        steps[0] = _deliverCall(t, id);
        H.Decision memory other = _decision(H.ROLE_PRIMARY, H.OUTCOME_ACCEPT);
        other.attempt = 2;
        other = _signDecision(t, id, other, adjudicator, ADJ_PK);
        steps[1] = abi.encodeCall(HoldbackRules.decide, (t, other, _noDelivery(), bytes("")));
        bytes32 before = _state(t, id, address(relay));
        vm.expectRevert(IHoldbackRules.InvalidMessage.selector);
        relay.relayAll(address(rules), steps);
        assertEq(_state(t, id, address(relay)), before, "nothing landed");
        _is(id, IHoldbackRules.Stage.Held);
    }
}
