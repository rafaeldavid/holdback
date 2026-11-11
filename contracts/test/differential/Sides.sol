// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AuthCaptureEscrow} from "commerce-payments/AuthCaptureEscrow.sol";
import {ERC3009PaymentCollector} from "commerce-payments/collectors/ERC3009PaymentCollector.sol";
import {Permit2PaymentCollector} from "commerce-payments/collectors/Permit2PaymentCollector.sol";
import {MockERC3009Token} from "commerce-payments-test/mocks/MockERC3009Token.sol";

import {HoldbackRules} from "../../src/HoldbackRules.sol";
import {HoldbackTypes as H} from "../../src/HoldbackTypes.sol";
import {SimBeacon} from "../../script/SimBeacon.sol";
import {TypesHarness} from "../unit/Base.sol";
import {IDeployedVault, RulesHandler} from "../handlers/RulesHandler.sol";

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
///         sides receive the same calls. Since T-346 (SC-7) the two ABIs differ: the pinned sides override the
///         handler's hooks to read the deployed contracts' own word and appeal state, to sign the `bondReserved`
///         they require (the price), and to fund their bond vault. The acceptance's signature is the one byte
///         sequence that differs between the sides' calls; nothing the harness compares shows it.
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
    /// Each adjudicator's bond in each token. Funding and the fallback's decision reserve the price (at most
    /// 60 tUSD) per open deal, so 16 deals on one adjudicator reserve at most 960 tUSD: the old side never refuses
    /// for want of bond, a refusal phase one no longer has (SC-7), and the sides stay comparable.
    uint256 internal constant PINNED_BOND = 1_000_000_000;

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
        hx = new TypesHarness();

        buyer = vm.addr(BUYER_PK);
        seller = vm.addr(SELLER_PK);
        adjudicator = vm.addr(ADJ_PK);
        fallbackAdj = vm.addr(FB_PK);
        appealAdj = vm.addr(AP_PK);
        relayer = makeAddr("relayer");
        usdc.mint(buyer, 1_000_000_000);
        usdc.mint(seller, 1_000_000_000);
    }

    /// Funds the deployed contracts' vault: each adjudicator deposits PINNED_BOND of each token, minted for the
    /// purpose, so its own balance matches the new side's; every actor approves the vault for appeal bonds. No
    /// contract is created, so the two sides' addresses stay aligned.
    function _afterSetUp() internal override {
        IDeployedVault v = IDeployedVault(vault());
        address[2] memory tk = tokens();
        for (uint256 j; j < 2; j++) {
            for (uint256 k; k < N; k++) {
                vm.startPrank(_actor[k]);
                MockERC3009Token(tk[j]).approve(address(v), type(uint256).max);
                vm.stopPrank();
            }
            for (uint256 k = 2; k <= 4; k++) {
                MockERC3009Token(tk[j]).mint(_actor[k], PINNED_BOND);
                vm.prank(_actor[k]);
                v.deposit(tk[j], PINNED_BOND);
            }
        }
    }

    /// The deployed contracts' word: (stage, attempt, appeal, flags, t1, t2, seedTag), seven ABI words.
    function _deployedWord(bytes32 id)
        internal
        view
        returns (uint8 stage, uint8 attempt, uint8 appeal, uint8 flags, uint40 t1, uint40 t2, uint144 tag)
    {
        (bool ok, bytes memory ret) = address(rules).staticcall(abi.encodeCall(HoldbackRules.dealOf, (id)));
        require(ok && ret.length == 224, "the pinned side's dealOf is not the deployed contracts' word");
        return abi.decode(ret, (uint8, uint8, uint8, uint8, uint40, uint40, uint144));
    }

    function _dealOf(bytes32 id) internal view override returns (HoldbackRules.Deal memory d) {
        (uint8 stage, uint8 attempt,,, uint40 t1,, uint144 tag) = _deployedWord(id);
        d = HoldbackRules.Deal({stage: HoldbackRules.Stage(stage), attempt: attempt, t1: t1, seedTag: tag});
    }

    function _deployedAppeal(bytes32 id) internal view override returns (uint8 appeal, uint8 flags, uint40 t2) {
        (,, appeal, flags,, t2,) = _deployedWord(id);
    }

    function _bondReserved(H.Terms memory t) internal pure override returns (uint256) {
        return t.price;
    }

    function _hasDeployedAppeals() internal pure override returns (bool) {
        return true;
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
