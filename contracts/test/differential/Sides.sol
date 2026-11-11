// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AuthCaptureEscrow} from "commerce-payments/AuthCaptureEscrow.sol";
import {ERC3009PaymentCollector} from "commerce-payments/collectors/ERC3009PaymentCollector.sol";
import {Permit2PaymentCollector} from "commerce-payments/collectors/Permit2PaymentCollector.sol";
import {MockERC3009Token} from "commerce-payments-test/mocks/MockERC3009Token.sol";

import {HoldbackRules} from "../../src/HoldbackRules.sol";
import {SimBeacon} from "../../script/SimBeacon.sol";
import {TypesHarness} from "../unit/Base.sol";
import {RulesHandler} from "../handlers/RulesHandler.sol";

// The two HoldbackRules copies carry a suffix in their file names, so a lookup by "HoldbackRules.sol:HoldbackRules"
// (`deployCodeTo`, `vm.getCode`) still finds only src/. Nothing imports them by name, so their bytes are unchanged.
import {HoldbackRules as OldRules} from "./old/HoldbackRules.64be1f1.sol";
import {SimBeacon as OldSimBeacon} from "./old/SimBeacon.sol";
import {IHoldbackBeacon as OldBeacon} from "./old/IHoldbackBeacon.sol";
import {HoldbackRules as PlantedRules} from "./planted/HoldbackRules.planted.sol";

/// @title The sides of the side-by-side harness (T-341, refinement gate VG-1)
/// @notice Each side is the invariant handler (`RulesHandler`) in trace mode over one build of the contracts:
///         - `NewSide`: the source under test, `contracts/src/`, deployed by `Base.setUp` unchanged;
///         - `OldSide`: the pinned copy of `contracts/src/` at the deployed commit `64be1f1` (`old/`);
///         - `PlantedSide`: the pinned copy with one planted behaviour change (`planted/`), for the tests that
///           prove the harness and the liveness invariant fail on a real change.
///         The handler drives every side through the new source's ABI (`HoldbackRules`, `HoldbackTypes`), so the
///         sides receive byte-identical calls.
/// @dev Same addresses on both sides. The harness creates each side from the same snapshot, so a side lands at
///      the same address, and every contract it creates lands at the same address as on the other side, as long as
///      the sides create the same number of contracts in the same order. That is why `_setUpWith` repeats
///      `Base.setUp` line for line, with only the beacon and the rules contract swapped. When a change on
///      `contracts-audit-ready` changes `Base.setUp` (new constructor arguments, a token fixed at deploy, no bond
///      vault), keep the creation order of `_setUpWith` level with it: the harness checks the addresses first and
///      names this function when they differ.
contract NewSide is RulesHandler {
    constructor() {
        traceMode = true;
    }
}

/// The old side's world, the pinned 64be1f1 contracts deployed exactly as `Base.setUp` deploys the new ones.
abstract contract PinnedSide is RulesHandler {
    function _rulesWith(SimBeacon beacon) internal virtual returns (HoldbackRules);

    function setUp() public override {
        vm.chainId(31337);
        vm.warp(1_790_000_000);
        escrow = new AuthCaptureEscrow();
        permit2 = deployPermit2();
        collector3009 = new ERC3009PaymentCollector(address(escrow), MULTICALL3);
        collectorPermit2 = new Permit2PaymentCollector(address(escrow), permit2, MULTICALL3);
        usdc = new MockERC3009Token("Mock USDC", "mUSDC", 6);
        sim = SimBeacon(address(new OldSimBeacon(SIM_SEED)));
        rules = _rulesWith(sim);
        bonds = rules.BONDS();
        hx = new TypesHarness();

        buyer = vm.addr(BUYER_PK);
        seller = vm.addr(SELLER_PK);
        adjudicator = vm.addr(ADJ_PK);
        fallbackAdj = vm.addr(FB_PK);
        appealAdj = vm.addr(AP_PK);
        relayer = makeAddr("relayer");
        usdc.mint(buyer, 1_000_000_000);
        usdc.mint(seller, 1_000_000_000);
        _bond(adjudicator, BOND);
        _bond(fallbackAdj, BOND);
        _bond(appealAdj, BOND);
    }
}

contract OldSide is PinnedSide {
    constructor() {
        traceMode = true;
    }

    function _rulesWith(SimBeacon beacon) internal override returns (HoldbackRules) {
        return HoldbackRules(
            address(
                new OldRules(
                    escrow, address(collector3009), address(collectorPermit2), MARGIN, OldBeacon(address(beacon))
                )
            )
        );
    }
}

contract PlantedSide is PinnedSide {
    constructor() {
        traceMode = true;
    }

    function _rulesWith(SimBeacon beacon) internal override returns (HoldbackRules) {
        return HoldbackRules(
            address(
                new PlantedRules(
                    escrow, address(collector3009), address(collectorPermit2), MARGIN, OldBeacon(address(beacon))
                )
            )
        );
    }
}

/// The planted mutant as an invariant-campaign handler (trace mode off), for the liveness tests.
contract PlantedHandler is PinnedSide {
    function _rulesWith(SimBeacon beacon) internal override returns (HoldbackRules) {
        return HoldbackRules(
            address(
                new PlantedRules(
                    escrow, address(collector3009), address(collectorPermit2), MARGIN, OldBeacon(address(beacon))
                )
            )
        );
    }
}
