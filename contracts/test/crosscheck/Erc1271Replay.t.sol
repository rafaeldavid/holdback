// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SignatureCheckerLib} from "solady/utils/SignatureCheckerLib.sol";
import {HoldbackRules} from "../../src/HoldbackRules.sol";
import {HoldbackTypes as H} from "../../src/HoldbackTypes.sol";
import {Base} from "../unit/Base.sol";

/// An ERC-1271 wallet that defers to one EOA owner, the shape behind CPP Cantina 2 3.3.2 (ERC-1271 replay through
/// Permit2) and ERC-7739: two such wallets with the same owner accept the same signatures.
contract OwnedWallet {
    address public immutable owner;

    constructor(address owner_) {
        owner = owner_;
    }

    function isValidSignature(bytes32 hash, bytes calldata sig) external view returns (bytes4) {
        return SignatureCheckerLib.isValidSignatureNowCalldata(owner, hash, sig) ? bytes4(0x1626ba7e) : bytes4(0);
    }

    function approve(address token, address spender) external {
        (bool ok,) = token.call(abi.encodeWithSignature("approve(address,uint256)", spender, type(uint256).max));
        require(ok);
    }
}

/// Red-team cross-check of S5 (marked pass, inferred): make it measured. Wallet A and wallet B share an owner key.
/// A funding signature made for A's deal must not pull from B. Phase one has one collector, ERC-3009 (SC-2).
contract Erc1271ReplayTest is Base {
    uint256 internal constant OWNER_PK = 0x0111E4;
    OwnedWallet internal walletA;
    OwnedWallet internal walletB;

    function setUp() public override {
        super.setUp();
        address owner = vm.addr(OWNER_PK);
        walletA = new OwnedWallet(owner);
        walletB = new OwnedWallet(owner);
        usdc.mint(address(walletA), 1_000_000_000);
        usdc.mint(address(walletB), 1_000_000_000);
    }

    function _dealFor(address who) internal returns (H.Terms memory t) {
        t = _terms();
        t.buyer = who;
        t.nonce = keccak256("same nonce for both wallets");
    }

    // T-356 (SC-2): the Permit2 replay test left with the Permit2 path; phase one funds by ERC-3009 only.

    function test_defense_erc3009FundingSignature_doesNotReplayAcrossWalletsWithOneOwner() public {
        H.Terms memory tA = _dealFor(address(walletA));
        H.Funding memory fA = _erc3009(tA, OWNER_PK);
        vm.prank(relayer);
        bytes32 idA =
            rules.agreeAndFund(tA, _sellerSig(tA, SELLER_PK), _acceptance(tA, ADJ_PK), _agree(tA, OWNER_PK), fA);
        assertEq(uint8(_stage(idA)), uint8(HoldbackRules.Stage.Held), "wallet A funds through ERC-1271");

        H.Terms memory tB = _dealFor(address(walletB));
        bytes memory sellerSig = _sellerSig(tB, SELLER_PK);
        H.Acceptance memory acc = _acceptance(tB, ADJ_PK);
        H.Agree memory ag = _agree(tB, OWNER_PK);
        uint256 balB = usdc.balanceOf(address(walletB));
        vm.expectRevert();
        rules.agreeAndFund(tB, sellerSig, acc, ag, fA);
        assertEq(usdc.balanceOf(address(walletB)), balB);
    }

    /// The Holdback-domain messages bind the signer address too: A's Agree is refused for B even though B would
    /// accept the bytes through ERC-1271.
    function test_defense_agreeForWalletA_refusedForWalletB() public {
        H.Terms memory tA = _dealFor(address(walletA));
        H.Agree memory agA = _agree(tA, OWNER_PK);
        H.Terms memory tB = _dealFor(address(walletB));
        bytes memory sellerSig = _sellerSig(tB, SELLER_PK);
        H.Acceptance memory acc = _acceptance(tB, ADJ_PK);
        H.Funding memory fB = _erc3009(tB, OWNER_PK);
        vm.expectRevert(HoldbackRules.BadSignature.selector);
        rules.agreeAndFund(tB, sellerSig, acc, agA, fB);
    }
}
