// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title IHoldbackBeacon
/// @notice The public randomness a fallback's or an appeal adjudicator's panel seed comes from (ADR-0018). The rules
///         contract fixes the round from settlement state and asks the beacon for the value that round proves; the
///         decider never chooses it. A deployment names its beacon once, in the rules contract's constructor. In phase
///         one the appeal adjudicator hears escalations only.
interface IHoldbackBeacon {
    /// @notice The latest round published at or before time `t`, in drand's arithmetic: 0 before genesis, round 1 at
    ///         genesis, then one round per period: `(t - genesis) / period + 1`.
    /// @param t A Unix time in seconds.
    /// @return The round number; `roundAt(t) + 1` is the first round published after `t`.
    function roundAt(uint256 t) external view returns (uint64);

    /// @notice The beacon value of `round`, proven by `proof`. Reverts when the proof does not verify for that round.
    /// @param round The round number.
    /// @param proof The round's proof: on drand quicknet, its 48-byte compressed BLS signature.
    /// @return The round's randomness: on drand quicknet, sha256 of the signature.
    function beaconValue(uint64 round, bytes calldata proof) external view returns (bytes32);
}
