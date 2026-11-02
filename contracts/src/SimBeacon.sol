// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IHoldbackBeacon} from "./IHoldbackBeacon.sol";

/// @title SimBeacon
/// @notice The SimChain beacon on a local chain (ADR-0018 §3, T-209 amendment): value(round) = keccak256(simSeed ‖
///         round), one round per second, round(t) = t (drand's formula with genesis 1 s and period 1 s, which equals
///         SimChain's floor(ms / 1000)). A round is available only once the chain clock reaches it, as on SimChain.
/// @dev Local chains only: the constructor refuses any chain ID but anvil's 31337, so a sim beacon can never sit
///      behind a rules contract on a testnet or mainnet. No owner, no setter: the seed is fixed at deploy. Anyone who
///      knows the seed can compute every value, which is the point of a deterministic sim; it is not public
///      randomness, and the drand verifier replaces it on any shared chain.
contract SimBeacon is IHoldbackBeacon {
    uint256 internal constant LOCAL_CHAIN_ID = 31337;

    bytes32 public immutable SIM_SEED;

    error NotALocalChain();
    error RoundUnavailable();

    constructor(bytes32 simSeed) {
        if (block.chainid != LOCAL_CHAIN_ID) revert NotALocalChain();
        SIM_SEED = simSeed;
    }

    function roundAt(uint256 t) public pure returns (uint64) {
        return uint64(t); // (t - 1) / 1 + 1 for t >= 1, and 0 at t = 0
    }

    /// @notice The sim proof is empty: the value is a function of the deploy-time seed and the round.
    function beaconValue(uint64 round, bytes calldata proof) external view returns (bytes32) {
        if (proof.length != 0 || round > roundAt(block.timestamp)) revert RoundUnavailable();
        return keccak256(abi.encodePacked(SIM_SEED, round));
    }
}
