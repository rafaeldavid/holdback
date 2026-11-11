// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice T-341: what the side-by-side harness compares after every step, one field at a time.
enum Field {
    Call, // the handler action itself: did it return or revert, and with what data
    Calls, // every checked call to the rules contract, the vault and the escrow inside it: success, and its
    // revert data, or its return data where the handler's call site has it
    Events, // every event emitted during the step, by any contract: emitter, topics, data
    Balances, // both tokens' and ether's balance for every holder in the world
    Holds, // CPP's payment state (collected, capturable, refundable) for every deal
    Bonds, // the vault: bond, encumbered and free per actor and token; the appeal bond and appellant per deal
    Stages, // every deal's ID and stage
    Words, // every deal's stored word (`dealOf`, raw) and stored delivery hash
    Surface, // the rules contract's views and immutables, raw: the EIP-712 domain, a fixed digest, every address,
    // the margin and the constants. A signing domain the parties' clients would not recognise shows here
    Clock // block.timestamp

}

/// @notice One side's view after one step. State fields are ABI-encoded as the observer read them, so an
///         allow-list entry can decode and test the exact difference.
struct Obs {
    bytes4 action;
    bool ok;
    bytes ret;
    bytes[] calls;
    bytes[] events;
    bytes balances;
    bytes holds;
    bytes bonds;
    bytes stages;
    bytes words;
    bytes surface;
    uint256 clock;
}

library Fields {
    uint256 internal constant COUNT = 10;

    function name(Field f) internal pure returns (string memory) {
        string[10] memory n = [
            string("call"),
            "calls",
            "events",
            "balances",
            "holds",
            "bonds",
            "stages",
            "words",
            "surface",
            "clock"
        ];
        return n[uint8(f)];
    }

    function digest(Obs memory o, Field f) internal pure returns (bytes32) {
        if (f == Field.Call) return keccak256(abi.encode(o.ok, o.ret));
        if (f == Field.Calls) return keccak256(abi.encode(o.calls));
        if (f == Field.Events) return keccak256(abi.encode(o.events));
        if (f == Field.Balances) return keccak256(o.balances);
        if (f == Field.Holds) return keccak256(o.holds);
        if (f == Field.Bonds) return keccak256(o.bonds);
        if (f == Field.Stages) return keccak256(o.stages);
        if (f == Field.Words) return keccak256(o.words);
        if (f == Field.Surface) return keccak256(o.surface);
        return keccak256(abi.encode(o.clock));
    }
}
