// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title IHoldbackBeacon
/// @notice The public randomness a fallback or appeal panel seed comes from (ADR-0018). The rules contract
///         fixes the round from settlement state and asks the beacon for the value that round proves; the decider
///         never chooses it. A deployment names its beacon once, in the rules contract's constructor.
interface IHoldbackBeacon {
    /// @notice The latest round published at or before time `t`, in drand's arithmetic: 0 before genesis, round 1 at
    ///         genesis, then one round per period: `(t - genesis) / period + 1`.
    function roundAt(uint256 t) external view returns (uint64);

    /// @notice The beacon value of `round`, proven by `proof`. Reverts when the proof does not verify for that round.
    function beaconValue(uint64 round, bytes calldata proof) external view returns (bytes32);
}
