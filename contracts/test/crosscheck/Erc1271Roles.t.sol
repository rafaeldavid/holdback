// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SignatureCheckerLib} from "solady/utils/SignatureCheckerLib.sol";
import {HoldbackRules} from "../../src/HoldbackRules.sol";
import {IHoldbackRules} from "../../src/IHoldbackRules.sol";
import {HoldbackTypes as H} from "../../src/HoldbackTypes.sol";
import {Base} from "../unit/Base.sol";

/// An ERC-1271 wallet for one EOA owner whose answer a test can break: honest, a wrong magic value, a revert, or an
/// empty return.
contract RoleWallet {
    uint8 public constant HONEST = 0;
    uint8 public constant WRONG_MAGIC = 1;
    uint8 public constant REVERTS = 2;
    uint8 public constant EMPTY = 3;

    address public immutable owner;
    uint8 public mode;

    constructor(address owner_) {
        owner = owner_;
    }

    function setMode(uint8 m) external {
        mode = m;
    }

    function isValidSignature(bytes32 hash, bytes calldata sig) external view returns (bytes4) {
        uint8 m = mode;
        if (m == WRONG_MAGIC) return bytes4(0xffffffff);
        if (m == REVERTS) revert("no");
        if (m == EMPTY) {
            assembly {
                return(0, 0)
            }
        }
        return SignatureCheckerLib.isValidSignatureNowCalldata(owner, hash, sig) ? bytes4(0x1626ba7e) : bytes4(0);
    }

    function exec(address to, bytes calldata data) external {
        (bool ok, bytes memory ret) = to.call(data);
        if (!ok) {
            assembly {
                revert(add(ret, 0x20), mload(ret))
            }
        }
    }
}

/// T-335: the seller and an adjudicator as ERC-1271 contract wallets. Erc1271Replay.t.sol and Erc6492Prepare.t.sol
/// cover the buyer; here the seller signs the terms and the delivery, and the primary and the fallback sign the
/// acceptance and the decision, through `isValidSignature`. Every wrong ERC-1271 answer (a wrong magic value, a revert,
/// an empty return, or an honest wallet's no for another key's signature) is refused with BadSignature, and the step
/// still goes through once the wallet answers honestly.
contract Erc1271RolesTest is Base {
    uint256 internal constant SW_PK = 0x5E11E7;
    uint256 internal constant AW_PK = 0xAD1E7;

    RoleWallet internal sellerWallet;
    RoleWallet internal adjWallet;

    function setUp() public override {
        super.setUp();
        sellerWallet = new RoleWallet(vm.addr(SW_PK));
        adjWallet = new RoleWallet(vm.addr(AW_PK));
    }

    function _wrongModes() internal pure returns (uint8[3] memory) {
        return [uint8(1), 2, 3];
    }

    function _fundAs(H.Terms memory t, uint256 sellerPk, uint256 adjPk) internal returns (bytes32 id) {
        vm.prank(relayer);
        id = rules.agreeAndFund(
            t, _sellerSig(t, sellerPk), _acceptance(t, adjPk), _agree(t, BUYER_PK), _erc3009(t, BUYER_PK)
        );
    }

    // ------------------------------------------------------------ the seller

    function test_sellerWallet_signsTermsAndDelivery_andIsPaid() public {
        H.Terms memory t = _terms();
        t.seller = address(sellerWallet);
        t.sellerPayoutAddress = address(sellerWallet); // ADR-0033: the wallet also holds the money
        bytes32 id = _fundAs(t, SW_PK, ADJ_PK);
        (H.Delivery memory d,) = _delivery();
        rules.deliver(t, d, _deliverySig(id, d, SW_PK));
        assertEq(uint8(_stage(id)), uint8(IHoldbackRules.Stage.Delivered));
        rules.decide(t, _primary(t, id, H.OUTCOME_ACCEPT), _noDelivery(), "");
        assertEq(uint8(_stage(id)), uint8(IHoldbackRules.Stage.Released));
        assertEq(usdc.balanceOf(address(sellerWallet)), PRICE, "the wallet is paid the price");
    }

    function test_sellerWallet_wrongAnswer_refusesTheTerms() public {
        H.Terms memory t = _terms();
        t.seller = address(sellerWallet);
        t.sellerPayoutAddress = address(sellerWallet); // ADR-0033: the wallet also holds the money
        bytes memory s = _sellerSig(t, SW_PK);
        H.Acceptance memory acc = _acceptance(t, ADJ_PK);
        H.Agree memory ag = _agree(t, BUYER_PK);
        H.Funding memory f = _erc3009(t, BUYER_PK);
        uint8[3] memory modes = _wrongModes();
        for (uint256 i; i < modes.length; i++) {
            sellerWallet.setMode(modes[i]);
            vm.expectRevert(IHoldbackRules.BadSignature.selector);
            rules.agreeAndFund(t, s, acc, ag, f);
        }
        sellerWallet.setMode(0);
        rules.agreeAndFund(t, s, acc, ag, f);
        assertEq(uint8(_stage(hx.id(t))), uint8(IHoldbackRules.Stage.Held));
    }

    function test_sellerWallet_wrongAnswer_refusesTheDelivery() public {
        H.Terms memory t = _terms();
        t.seller = address(sellerWallet);
        t.sellerPayoutAddress = address(sellerWallet); // ADR-0033: the wallet also holds the money
        bytes32 id = _fundAs(t, SW_PK, ADJ_PK);
        (H.Delivery memory d,) = _delivery();
        bytes memory sig = _deliverySig(id, d, SW_PK);
        uint8[3] memory modes = _wrongModes();
        for (uint256 i; i < modes.length; i++) {
            sellerWallet.setMode(modes[i]);
            vm.expectRevert(IHoldbackRules.BadSignature.selector);
            rules.deliver(t, d, sig);
        }
        sellerWallet.setMode(0);
        bytes memory otherKey = _deliverySig(id, d, OTHER_PK);
        vm.expectRevert(IHoldbackRules.BadSignature.selector);
        rules.deliver(t, d, otherKey);
        assertEq(uint8(_stage(id)), uint8(IHoldbackRules.Stage.Held));
        rules.deliver(t, d, sig);
        assertEq(uint8(_stage(id)), uint8(IHoldbackRules.Stage.Delivered));
    }

    // ------------------------------------------------------------ the adjudicator

    function test_primaryWallet_acceptsAndDecides_fee() public {
        H.Terms memory t = _terms();
        t.adjudicator = address(adjWallet);
        bytes32 id = _fundAs(t, SELLER_PK, AW_PK);
        assertEq(uint8(_stage(id)), uint8(IHoldbackRules.Stage.Held), "the wallet's acceptance funded the deal");
        _deliver(t, id);
        H.Decision memory m =
            _signDecision(t, id, _decision(H.ROLE_PRIMARY, H.OUTCOME_ACCEPT), address(adjWallet), AW_PK);
        rules.decide(t, m, _noDelivery(), "");
        assertEq(uint8(_stage(id)), uint8(IHoldbackRules.Stage.Released));
        assertEq(usdc.balanceOf(address(adjWallet)), FEE, "the wallet is paid the fee");
    }

    function test_primaryWallet_wrongAnswer_refusesTheAcceptance() public {
        H.Terms memory t = _terms();
        t.adjudicator = address(adjWallet);
        bytes memory s = _sellerSig(t, SELLER_PK);
        H.Acceptance memory acc = _acceptance(t, AW_PK);
        H.Agree memory ag = _agree(t, BUYER_PK);
        H.Funding memory f = _erc3009(t, BUYER_PK);
        uint8[3] memory modes = _wrongModes();
        for (uint256 i; i < modes.length; i++) {
            adjWallet.setMode(modes[i]);
            vm.expectRevert(IHoldbackRules.BadSignature.selector);
            rules.agreeAndFund(t, s, acc, ag, f);
        }
        assertEq(uint8(_stage(hx.id(t))), uint8(IHoldbackRules.Stage.None), "nothing funded without consent");
    }

    function test_primaryWallet_wrongAnswer_refusesTheDecision() public {
        H.Terms memory t = _terms();
        t.adjudicator = address(adjWallet);
        bytes32 id = _fundAs(t, SELLER_PK, AW_PK);
        _deliver(t, id);
        H.Decision memory m =
            _signDecision(t, id, _decision(H.ROLE_PRIMARY, H.OUTCOME_ACCEPT), address(adjWallet), AW_PK);
        uint8[3] memory modes = _wrongModes();
        for (uint256 i; i < modes.length; i++) {
            adjWallet.setMode(modes[i]);
            vm.expectRevert(IHoldbackRules.BadSignature.selector);
            rules.decide(t, m, _noDelivery(), "");
        }
        adjWallet.setMode(0);
        H.Decision memory forged =
            _signDecision(t, id, _decision(H.ROLE_PRIMARY, H.OUTCOME_ACCEPT), address(adjWallet), OTHER_PK);
        vm.expectRevert(IHoldbackRules.BadSignature.selector);
        rules.decide(t, forged, _noDelivery(), "");
        assertEq(uint8(_stage(id)), uint8(IHoldbackRules.Stage.Delivered));
        rules.decide(t, m, _noDelivery(), "");
        assertEq(uint8(_stage(id)), uint8(IHoldbackRules.Stage.Released));
    }

    /// The fallback, as a wallet, signs its decision through ERC-1271 after the takeover.
    function test_fallbackWallet_decidesAfterTakeover() public {
        H.Terms memory t = _terms();
        t.fallbackAdjudicator = address(adjWallet);
        bytes32 id = _fund(t);
        _deliver(t, id);
        vm.warp(t.timing.judgeBy);
        rules.triggerFallback(t);
        H.Decision memory m = _beaconDecision(id, H.ROLE_FALLBACK, H.OUTCOME_REJECT, t.timing.judgeBy);
        m = _signDecision(t, id, m, address(adjWallet), AW_PK);
        adjWallet.setMode(RoleWallet(adjWallet).WRONG_MAGIC());
        vm.expectRevert(IHoldbackRules.BadSignature.selector);
        rules.decide(t, m, _noDelivery(), "");
        assertEq(uint8(_stage(id)), uint8(IHoldbackRules.Stage.FallbackJudging));
        adjWallet.setMode(0);
        rules.decide(t, m, _noDelivery(), "");
        assertEq(uint8(_stage(id)), uint8(IHoldbackRules.Stage.Refunded));
        assertEq(usdc.balanceOf(address(adjWallet)), FEE);
    }
}
