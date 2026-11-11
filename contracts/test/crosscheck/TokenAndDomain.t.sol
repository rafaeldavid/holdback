// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {HoldbackRules} from "../../src/HoldbackRules.sol";
import {HoldbackTypes as H} from "../../src/HoldbackTypes.sol";
import {Base} from "../unit/Base.sol";

/// Public-audit cross-check: classes the T-206 suites do not pin. The phantom-token bond deposit left with the bond
/// vault (T-346, ADR-0031 §8).
contract TokenAndDomainTest is Base {
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
