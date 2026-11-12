// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AuthCaptureEscrow} from "commerce-payments/AuthCaptureEscrow.sol";

import {HoldbackRules} from "../../src/HoldbackRules.sol";
import {RulesHandler} from "../handlers/RulesHandler.sol";
import {StateOracle} from "./StateOracle.sol";

/// @title RulesInvariants
/// @notice T-203: the invariants SimChain property-tests, proved by stateful fuzzing against HoldbackRules and CPP
///         AuthCaptureEscrow v1.1.0. `RulesHandler` drives random interleavings of every external function and every
///         TimeoutKind from random callers with random keys, across every deadline. Each invariant is its own
///         function and is shown to bite by a named mutant (task Evidence). Local EVM only (chain id 31337): no RPC,
///         no broadcast.
/// @dev T-346 (SC-7): phase one has no party appeal and no bond vault. The vault's invariants left with it
///      (`invariant_bondsNeverNegative`, `invariant_encumberedNotDoubleCounted`, `invariant_overturnPaysFromTheBond`;
///      the T-346 task file says why), and so did the bond and appeal actions. The three removed appeal paths the
///      handler keeps for the side-by-side harness are not targeted: the phase-one contract refuses them always.
contract RulesInvariants is Test {
    RulesHandler internal h;
    HoldbackRules internal rules;
    AuthCaptureEscrow internal escrow;
    uint256[2] internal supply;
    bytes32[3] internal codehash;

    function setUp() public {
        h = new RulesHandler();
        (rules,, escrow) = h.system();
        address[2] memory tk = h.tokens();
        for (uint256 j; j < 2; j++) {
            supply[j] = IERC20(tk[j]).totalSupply();
        }
        codehash = [address(rules).codehash, address(escrow).codehash, tk[0].codehash];

        // T-356 (SC-6): `expireOffer` left the phase-one contract; like the appeal actions, its handler action stays
        // for the side-by-side harness only, where it is always refused, so the campaign does not target it.
        bytes4[] memory s = new bytes4[](13);
        s[0] = RulesHandler.offer.selector;
        s[1] = RulesHandler.agreeAndFund.selector;
        s[2] = RulesHandler.deliver.selector;
        s[3] = RulesHandler.decide.selector;
        s[4] = RulesHandler.earlyAccept.selector;
        s[5] = RulesHandler.mutualSettle.selector;
        s[6] = RulesHandler.reclaim.selector;
        s[7] = RulesHandler.triggerFallback.selector;
        s[8] = RulesHandler.triggerDefault.selector;
        s[9] = RulesHandler.cppReclaim.selector;
        s[10] = RulesHandler.stranger.selector;
        s[11] = RulesHandler.warp.selector;
        s[12] = RulesHandler.decideFallback.selector;
        targetContract(address(h));
        targetSelector(StdInvariant.FuzzSelector({addr: address(h), selectors: s}));
    }

    /// Conservation, per token: no unit is created or destroyed, and none leaves the known actors, the escrow and
    /// its token store.
    /// forge-config: default.invariant.runs = 256
    /// forge-config: default.invariant.depth = 100
    function invariant_conservation() public view {
        address[] memory holders = h.holders();
        address[2] memory tk = h.tokens();
        for (uint256 j; j < 2; j++) {
            uint256 sum;
            for (uint256 k; k < holders.length; k++) {
                sum += IERC20(tk[j]).balanceOf(holders[k]);
            }
            assertEq(IERC20(tk[j]).totalSupply(), supply[j], "total supply changed");
            assertEq(sum, supply[j], "tokens left the known holders");
        }
    }

    /// The escrow matches the state: CPP's token store holds exactly the sum of open holds (price + fee for every
    /// Held, Delivered, FallbackJudging or Escalated commitment), and each hold's capturable amount agrees.
    /// forge-config: default.invariant.runs = 256
    /// forge-config: default.invariant.depth = 100
    function invariant_escrowMatchesState() public view {
        address store = escrow.getTokenStore(address(rules));
        address[2] memory tk = h.tokens();
        for (uint256 j; j < 2; j++) {
            assertEq(IERC20(tk[j]).balanceOf(store), h.openHolds(tk[j]), "token store != sum of open holds");
        }
        for (uint256 i; i < h.dealCount(); i++) {
            assertEq(h.capturable(i), h.heldMirror(i), "capturable != the stage's hold");
        }
        assertEq(h.unexpectedMovement(), 0, h.lastViolation());
    }

    /// Settle once: each commitment closes (Released, Refunded or Settled) at most once and never reopens.
    /// forge-config: default.invariant.runs = 256
    /// forge-config: default.invariant.depth = 100
    function invariant_settleOnce() public view {
        for (uint256 i; i < h.dealCount(); i++) {
            assertLe(h.closings(h.dealId(i)), 1, "a commitment settled twice");
        }
        assertEq(h.reopened(), 0, h.lastViolation());
    }

    /// Timeouts: a timeout never succeeds before its deadline, and always succeeds after it, for any caller,
    /// when the stage allows, including after the buyer reclaimed on CPP (T-206: the deal must still close); and
    /// no delivery lands at or after deliverBy, whichever call carries it.
    /// forge-config: default.invariant.runs = 256
    /// forge-config: default.invariant.depth = 100
    function invariant_timeoutsExactlyWhenDue() public view {
        assertEq(h.timeoutMismatch(), 0, h.lastViolation());
    }

    /// No movement without an authorised signature or a due timeout: no call carrying a wrong key succeeds, and
    /// nobody but the rules contract can drive CPP's operator functions.
    /// forge-config: default.invariant.runs = 256
    /// forge-config: default.invariant.depth = 100
    function invariant_noMovementWithoutAuthority() public view {
        assertEq(h.unauthorisedSuccess(), 0, h.lastViolation());
        assertEq(h.strangerSuccess(), 0, h.lastViolation());
    }

    /// T-358 (ADR-0033): on a deal whose payment and payout addresses are apart from its signing addresses (one deal
    /// in four), no call moves the signing addresses' money: the payment address funds and is refunded, the payout
    /// address is paid, and `buyer` and `seller` only sign.
    /// forge-config: default.invariant.runs = 256
    /// forge-config: default.invariant.depth = 100
    function invariant_signingAddressesMoveNoMoney() public view {
        assertEq(h.signerMoved(), 0, h.lastViolation());
    }

    /// The buyer's key only with payment (formal model KeyOnlyWithPayment, ADR-0012): no decision releases it on a
    /// deal that does not stand Released (T-206 H-2).
    /// forge-config: default.invariant.runs = 256
    /// forge-config: default.invariant.depth = 100
    function invariant_keyOnlyWithPayment() public view {
        assertEq(h.keyWithoutPayment(), 0, h.lastViolation());
    }

    /// Every landed delivery stays named on chain (ADR-0029, T-336): a deal the handler delivered stores exactly the
    /// posted delivery's hash, and a deal it did not deliver stores none; a delivery attempt is set on chain exactly
    /// when the handler counted a delivery for that deal; and an authorised `deliver` before deliverBy always lands.
    /// Without the stored hash every later decision and early accept reverts, so settlement stalls (known issue G-5).
    /// forge-config: default.invariant.runs = 256
    /// forge-config: default.invariant.depth = 100
    function invariant_deliveryHashStored() public view {
        uint256 delivered;
        for (uint256 i; i < h.dealCount(); i++) {
            bytes32 id = h.dealId(i);
            bytes32 posted = h.postedHash(id);
            assertEq(rules.deliveryHashOf(id), posted, "the stored delivery hash != the posted delivery's");
            assertEq(h.word(id).attempt != 0, posted != bytes32(0), "a delivery attempt the handler did not count");
            if (posted != bytes32(0)) delivered++;
        }
        assertEq(h.deliveries(), delivered, "the delivery counter != the delivered deals");
        assertEq(h.deliveryHashLost(), 0, h.lastViolation());
        assertEq(h.deliverRefused(), 0, h.lastViolation());
    }

    /// Every authorised, timely decision lands (T-375, triage item 43): a decision from the role whose turn it is,
    /// signed with its key, naming the delivered attempt and the posted delivery, with an outcome the role may give,
    /// before the role's deadline and once its beacon round is public, is never refused (`RulesHandler._timelyDecision`).
    /// It catches a change that breaks the decision path and leaves the stored delivery hash alone, which
    /// `invariant_deliveryHashStored` does not see.
    /// forge-config: default.invariant.runs = 256
    /// forge-config: default.invariant.depth = 100
    function invariant_timelyDecisionsLand() public view {
        assertEq(h.decideRefused(), 0, h.lastViolation());
    }

    /// The state oracle (T-341, refinement gate VG-2): after every step every deal is in a legal state of the
    /// phase-one machine, `docs/audit/state-model.md` section 9 (`StateOracle`): its stored word, its delivery hash
    /// and how it closed match one row of the table, its times keep the row's bounds, and the escrow holds the
    /// row's amounts.
    /// forge-config: default.invariant.runs = 256
    /// forge-config: default.invariant.depth = 100
    function invariant_legalDealStates() public view {
        for (uint256 i; i < h.dealCount(); i++) {
            assertEq(StateOracle.checkDeal(h, i), "", "illegal deal state");
        }
    }

    /// Nothing has an admin path: the deployed code never changes (no selfdestruct, no upgrade) and the rules
    /// contract never holds tokens or ether.
    /// forge-config: default.invariant.runs = 256
    /// forge-config: default.invariant.depth = 100
    function invariant_noAdminPath() public view {
        assertEq(address(rules).codehash, codehash[0], "rules code changed");
        assertEq(address(escrow).codehash, codehash[1], "escrow code changed");
        assertEq(address(h.tokens()[0]).codehash, codehash[2], "token code changed");
        address[2] memory tk = h.tokens();
        for (uint256 j; j < 2; j++) {
            assertEq(IERC20(tk[j]).balanceOf(address(rules)), 0, "rules holds tokens");
        }
        assertEq(address(rules).balance, 0, "rules holds ether");
    }
}
