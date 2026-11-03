// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SafeTransferLib} from "solady/utils/SafeTransferLib.sol";
import {HoldbackRules} from "../../src/HoldbackRules.sol";
import {HoldbackTypes as H} from "../../src/HoldbackTypes.sol";
import {Base} from "../unit/Base.sol";

/// Public-audit cross-check: two classes the T-206 suites do not pin.
contract TokenAndDomainTest is Base {
    /// "Phantom token" deposits (Solmate SafeTransferLib skips the code check, a recurring Code4rena finding): a
    /// deposit in a token with no code must not credit a bond that a later deployment at that address would back.
    /// Solady's SafeTransferLib reverts when the token has no code and returns no data.
    function test_defense_depositInATokenWithNoCode_reverts() public {
        address phantom = address(uint160(uint256(keccak256("not deployed yet"))));
        assertEq(phantom.code.length, 0);
        vm.prank(adjudicator);
        vm.expectRevert(SafeTransferLib.TransferFromFailed.selector);
        bonds.deposit(phantom, 1_000_000);
        assertEq(bonds.bondOf(adjudicator, phantom), 0);
    }

    /// EIP-712 domains cached at deploy (a common audit finding): after a chain split, signatures from the original
    /// chain must not verify. Solady's EIP712 rebuilds the separator when block.chainid differs from the cached one.
    function test_defense_signaturesFromAnotherChainId_refused() public {
        H.Terms memory t = _terms();
        bytes memory sellerSig = _sellerSig(t, SELLER_PK);
        H.Acceptance memory acc = _acceptance(t, ADJ_PK);
        H.Agree memory ag = _agree(t, BUYER_PK);
        H.Funding memory f = _erc3009(t, BUYER_PK);
        bytes32 separator = rules.typedDataHash(bytes32(0));

        vm.chainId(11155111);
        assertTrue(rules.typedDataHash(bytes32(0)) != separator, "the domain follows the chain ID");
        vm.expectRevert(HoldbackRules.BadSignature.selector);
        rules.agreeAndFund(t, sellerSig, acc, ag, f);
    }
}
