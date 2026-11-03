// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {console} from "forge-std/console.sol";
import {HoldbackRules} from "../../src/HoldbackRules.sol";
import {HoldbackTypes as H} from "../../src/HoldbackTypes.sol";
import {DrandQuicknetBeacon} from "../../src/DrandQuicknetBeacon.sol";
import {Base} from "./Base.sol";

/// Gas per deal (D4; ADR-0024 §8 asked T-202 to measure). Print the numbers with
/// `forge test --match-contract GasPerDeal --isolate -vv`: --isolate runs each top-level call as its own transaction
/// (21000 intrinsic gas, calldata and cold access included). "Steady" = a warm-up deal already created the operator's
/// TokenStore clone and every recipient already holds the token.
/// Each transaction must stay within a budget about 25% above its --isolate cost. A plain `forge test` (as in CI)
/// measures warm calls without the intrinsic cost, about half as much, so there the budgets only catch a gross
/// regression.
abstract contract GasBase is Base {
    uint256 internal constant FUND_BUDGET = 300_000; // measured 234,024 (--isolate)

    /// The drand quicknet round for the Base terms' judgeBy (fixtures/beacon/drand-quicknet.json).
    uint64 internal constant FALLBACK_ROUND = 32_456_478;
    bytes internal constant FALLBACK_SIG =
        hex"b528568aa3bcf0f15bd15391bfd424012dfa4efae8a9b335e3c7aa98871a9108220ac137cf5626cc732db3e1a2e5cdc6";

    /// T-209: the drand variant redeploys the rules contract behind the quicknet verifier.
    function _drand() internal pure virtual returns (bool);

    function setUp() public override {
        super.setUp();
        if (_drand()) {
            rules = new HoldbackRules(
                escrow, address(collector3009), address(collectorPermit2), MARGIN, new DrandQuicknetBeacon()
            );
            bonds = rules.BONDS();
            _bond(adjudicator, BOND);
            _bond(fallbackAdj, BOND);
            _bond(appealAdj, BOND);
        }
        (H.Terms memory t, bytes32 id) = _funded();
        (H.Delivery memory d,) = _delivery();
        rules.decide(t, _primary(t, id, H.OUTCOME_ACCEPT), d, _deliverySig(id, d, SELLER_PK));
        usdc.mint(address(0x7777), 1);
    }

    function _within(string memory step, uint256 budget) internal view {
        uint256 gas = vm.lastCallGas().gasTotalUsed;
        console.log(step, gas);
        assertLe(gas, budget, step);
    }

    /// Transaction 1 of every deal: agree and fund in one call.
    function _fundMeasured() internal returns (H.Terms memory t, bytes32 id) {
        t = _terms();
        bytes memory s = _sellerSig(t, SELLER_PK);
        H.Acceptance memory a = _acceptance(t, ADJ_PK);
        H.Agree memory g = _agree(t, BUYER_PK);
        H.Funding memory f = _erc3009(t, BUYER_PK);
        vm.prank(relayer);
        id = rules.agreeAndFund(t, s, a, g, f);
        _within("agreeAndFund", FUND_BUDGET);
    }

    /// A fallback decision: the seed comes from the beacon round at judgeBy (sim value, or a verified drand round).
    function _fallbackDecision(uint256 budget) internal {
        (H.Terms memory t, bytes32 id) = _fundMeasured();
        (H.Delivery memory d,) = _delivery();
        rules.deliver(t, d, _deliverySig(id, d, SELLER_PK));
        vm.warp(t.timing.judgeBy);
        rules.triggerFallback(t);
        H.Decision memory m = _beaconDecision(id, H.ROLE_FALLBACK, H.OUTCOME_ACCEPT, uint64(t.timing.judgeBy));
        if (_drand()) {
            m.beaconSourceHash = keccak256("drand-quicknet");
            m.beaconRound = FALLBACK_ROUND;
            m.beaconSignature = FALLBACK_SIG;
            m.beaconValue = sha256(FALLBACK_SIG);
            m.seed = hx.panelSeed(id, H.ROLE_FALLBACK, m.attempt, m.beaconValue);
        }
        m = _signDecision(t, id, m, fallbackAdj, FB_PK);
        rules.decide(t, m, _noDelivery(), "");
        _within(_drand() ? "fallback decide(accept), drand verified" : "fallback decide(accept), sim beacon", budget);
    }
}

contract GasPerDealTest is GasBase {
    function _drand() internal pure override returns (bool) {
        return false;
    }

    function test_gas_happyPath_decisionCarriesDelivery() public {
        (H.Terms memory t, bytes32 id) = _fundMeasured();
        (H.Delivery memory d,) = _delivery();
        bytes memory ds = _deliverySig(id, d, SELLER_PK);
        H.Decision memory m = _primary(t, id, H.OUTCOME_ACCEPT);
        rules.decide(t, m, d, ds);
        _within("decide(accept), delivery carried", 180_000); // measured 140,315
    }

    function test_gas_deliverOnChain() public {
        (H.Terms memory t, bytes32 id) = _fundMeasured();
        (H.Delivery memory d,) = _delivery();
        bytes memory ds = _deliverySig(id, d, SELLER_PK);
        rules.deliver(t, d, ds);
        _within("optional deliver (seller stops a reclaim)", 80_000); // measured 61,302
        H.Decision memory m = _primary(t, id, H.OUTCOME_ACCEPT);
        rules.decide(t, m, _noDelivery(), "");
        _within("decide(accept) after an on-chain delivery", 160_000); // measured 127,413
    }

    function test_gas_reject() public {
        (H.Terms memory t, bytes32 id) = _fundMeasured();
        (H.Delivery memory d,) = _delivery();
        bytes memory ds = _deliverySig(id, d, SELLER_PK);
        H.Decision memory m = _primary(t, id, H.OUTCOME_REJECT);
        rules.decide(t, m, d, ds);
        _within("decide(reject): fee-only capture + void", 180_000); // measured 140,644
    }

    function test_gas_earlyAccept() public {
        (H.Terms memory t, bytes32 id) = _fundMeasured();
        (H.Delivery memory d, H.KeyProof memory k) = _delivery();
        bytes memory ds = _deliverySig(id, d, SELLER_PK);
        H.EarlyAccept memory m = H.EarlyAccept({attempt: 1, nonce: 0, expiresAt: type(uint64).max, signature: ""});
        m.signature = _sign(BUYER_PK, hx.early(id, buyer, m));
        rules.earlyAccept(t, m, d, ds, k);
        _within("early accept (delivery carried, key released)", 190_000); // measured 148,052
    }

    function test_gas_reclaim() public {
        (H.Terms memory t,) = _fundMeasured();
        vm.warp(t.timing.deliverBy);
        rules.reclaim(t);
        _within("reclaim (permissionless, nothing delivered)", 120_000); // measured 92,557
    }

    function test_gas_mutualSettlement() public {
        (H.Terms memory t, bytes32 id) = _fundMeasured();
        H.Mutual memory m;
        m.payouts = new H.Payout[](2);
        m.payouts[0] = H.Payout(seller, PRICE / 2);
        m.payouts[1] = H.Payout(buyer, PRICE - PRICE / 2);
        m.expiresAt = type(uint64).max;
        bytes32 h = hx.mutual(id, t.token, m);
        m.buyerSignature = _sign(BUYER_PK, h);
        m.sellerSignature = _sign(SELLER_PK, h);
        H.KeyProof memory none;
        rules.mutualSettle(t, m, _noDelivery(), none);
        _within("mutual settlement (half each, before delivery)", 180_000); // measured 143,683
    }

    function test_gas_fallbackDecision() public {
        _fallbackDecision(210_000); // measured 161,076
    }

    function test_gas_default() public {
        (H.Terms memory t, bytes32 id) = _fundMeasured();
        (H.Delivery memory d,) = _delivery();
        rules.deliver(t, d, _deliverySig(id, d, SELLER_PK));
        vm.warp(t.timing.judgeBy);
        rules.triggerFallback(t);
        _within("triggerFallback", 110_000); // measured 82,993
        vm.warp(t.timing.fallbackBy);
        rules.triggerDefault(t);
        _within("triggerDefault (default + apply in one call)", 130_000); // measured 96,716
    }
}

/// T-209: the rules contract behind the drand quicknet verifier (the shared-chain deployment). Only fallback and appeal
/// decisions call the verifier, so only the fallback decision is measured here; the other paths match the sim suite.
contract GasPerDealDrandTest is GasBase {
    function _drand() internal pure override returns (bool) {
        return true;
    }

    function test_gas_fallbackDecision() public {
        _fallbackDecision(380_000); // measured 297,591
    }
}
