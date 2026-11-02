// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title LocalMulticall3
/// @notice Anvil only (T-205): the `aggregate3` entry of Multicall3 (0xcA11bde05977b3631167028862bE2a173976CA11), with
///         the same ABI, so the operator-fee bundle (ADR-0023, EVM mechanism) runs on a chain without the canonical
///         deployment. Stateless, no owner; every call runs with this contract as msg.sender.
contract LocalMulticall3 {
    struct Call3 {
        address target;
        bool allowFailure;
        bytes callData;
    }

    struct Result {
        bool success;
        bytes returnData;
    }

    function aggregate3(Call3[] calldata calls) external payable returns (Result[] memory returnData) {
        uint256 n = calls.length;
        returnData = new Result[](n);
        for (uint256 i; i < n; ++i) {
            (bool ok, bytes memory ret) = calls[i].target.call(calls[i].callData);
            if (!ok && !calls[i].allowFailure) {
                assembly {
                    revert(add(ret, 0x20), mload(ret))
                }
            }
            returnData[i] = Result(ok, ret);
        }
    }
}
