// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SignatureCheckerLib} from "solady/utils/SignatureCheckerLib.sol";
import {HoldbackRules} from "../../src/HoldbackRules.sol";
import {HoldbackTypes as H} from "../../src/HoldbackTypes.sol";
import {Base} from "../unit/Base.sol";

/// An ERC-1271 wallet for one EOA owner whose answer a test can switch at any step: honest, a wrong magic value, a
/// revert, an empty return, or a loop that burns all the gas it is given. Erc1271Roles.t.sol's RoleWallet has the
/// first four; this one adds the gas burn, so one wallet can change its answer between two steps of one deal.
contract SwitchWallet {
    uint8 public constant HONEST = 0;
    uint8 public constant WRONG_MAGIC = 1;
    uint8 public constant REVERTS = 2;
    uint8 public constant EMPTY = 3;
    uint8 public constant BURN = 4;

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
        if (m == BURN) {
            // Never returns: hashes until the call runs out of gas.
            assembly {
                for {} 1 {} { mstore(0, keccak256(0, 0x20)) }
            }
        }
        return SignatureCheckerLib.isValidSignatureNowCalldata(owner, hash, sig) ? bytes4(0x1626ba7e) : bytes4(0);
    }
}

/// Another protocol's contract that relays Holdback steps inside its own function: it writes its own state, then
/// makes the call, and bubbles a revert. It holds no key and is named in no terms.
contract StepRelayer {
    uint256 public relayed;

    function relay(address target, bytes calldata data) external {
        relayed += 1;
        _call(target, data);
    }

    /// Several steps in one call frame, in order; any failure reverts them all.
    function relayAll(address target, bytes[] calldata steps) external {
        for (uint256 i; i < steps.length; ++i) {
            relayed += 1;
            _call(target, steps[i]);
        }
    }

    function _call(address target, bytes calldata data) internal {
        (bool ok, bytes memory ret) = target.call(data);
        if (!ok) {
            assembly {
                revert(add(ret, 0x20), mload(ret))
            }
        }
    }
}

/// Shared builders for the contract-signer tests (T-346, ADR-0031 §5): wallets in any role, a delivery whose buyer
/// envelope is keyed to whoever the buyer is, early accepts and settlements for that delivery, and a state digest
/// that a refused step must leave unchanged.
abstract contract SignerBase is Base {
    uint256 internal constant BW_PK = 0xB0B1E7; // the buyer wallet's owner
    uint256 internal constant SW_PK = 0x5E11E7; // the seller wallet's owner
    uint256 internal constant AW_PK = 0xAD1E7; // an adjudicator wallet's owner
    uint256 internal constant FW_PK = 0xFA11E7; // a second adjudicator wallet's owner

    uint8 internal constant HONEST = 0;
    uint8 internal constant WRONG_MAGIC = 1;
    uint8 internal constant REVERTS = 2;
    uint8 internal constant EMPTY = 3;
    uint8 internal constant BURN = 4;

    function _wallet(uint256 ownerPk) internal returns (SwitchWallet w) {
        w = new SwitchWallet(vm.addr(ownerPk));
        usdc.mint(address(w), 1_000_000_000);
    }

    function _wrongModes() internal pure returns (uint8[3] memory) {
        return [WRONG_MAGIC, REVERTS, EMPTY];
    }

    function _fundAs(H.Terms memory t, uint256 buyerPk, uint256 sellerPk, uint256 adjPk)
        internal
        returns (bytes32 id)
    {
        vm.prank(relayer);
        id = rules.agreeAndFund(
            t, _sellerSig(t, sellerPk), _acceptance(t, adjPk), _agree(t, buyerPk), _erc3009(t, buyerPk)
        );
    }

    /// Base's `_delivery()` with the buyer envelope keyed to `recipient` (the terms' buyer, wallet or not).
    function _deliveryFor(address recipient) internal view returns (H.Delivery memory d, H.KeyProof memory k) {
        k = _buyerKey();
        k.keyHashes[1] = hx.key(recipient, k);
        d = H.Delivery({
            attempt: 1,
            ciphertextHash: keccak256("ciphertext"),
            plaintextSha256Hash: keccak256("sha256:plain"),
            plaintextMimeHash: keccak256("text/csv"),
            encryptedKeysHash: keccak256(abi.encodePacked(k.keyHashes)),
            submittedAt: 1_790_000_000
        });
    }

    function _deliverAs(H.Terms memory t, bytes32 id, uint256 sellerPk)
        internal
        returns (H.Delivery memory d, H.KeyProof memory k)
    {
        (d, k) = _deliveryFor(t.buyer);
        rules.deliver(t, d, _deliverySig(id, d, sellerPk));
    }

    /// The buyer's early accept naming delivery `d`.
    function _earlyFor(H.Terms memory t, bytes32 id, H.Delivery memory d, uint256 pk)
        internal
        view
        returns (H.EarlyAccept memory m)
    {
        m = H.EarlyAccept({
            attempt: 1,
            deliveryHash: hx.delivery(id, d),
            nonce: keccak256("early"),
            expiresAt: type(uint64).max,
            signature: ""
        });
        m.signature = _sign(pk, hx.early(id, t.buyer, m));
    }

    /// A settlement both parties sign: `toSeller` of the price to the seller, the rest to the buyer. After a
    /// delivery it names the posted one and releases the buyer's key; before, it names none.
    function _mutualFor(H.Terms memory t, bytes32 id, uint256 buyerPk, uint256 sellerPk, uint256 toSeller)
        internal
        view
        returns (H.Mutual memory mu)
    {
        bytes32 dh = rules.deliveryHashOf(id);
        uint256 n = (toSeller > 0 ? 1 : 0) + (toSeller < t.price ? 1 : 0);
        H.Payout[] memory payouts = new H.Payout[](n);
        uint256 j;
        if (toSeller > 0) payouts[j++] = H.Payout({to: t.seller, amount: toSeller});
        if (toSeller < t.price) payouts[j++] = H.Payout({to: t.buyer, amount: t.price - toSeller});
        mu = H.Mutual({
            hasDelivery: dh != bytes32(0),
            deliveryHash: dh,
            payouts: payouts,
            releaseKey: dh != bytes32(0),
            nonce: keccak256("mutual"),
            expiresAt: type(uint64).max,
            buyerSignature: "",
            sellerSignature: ""
        });
        bytes32 h = hx.mutual(id, t.token, mu);
        mu.buyerSignature = _sign(buyerPk, h);
        mu.sellerSignature = _sign(sellerPk, h);
    }

    /// The fallback's decision after a takeover at judgeBy, signed by `pk` for `who`.
    function _fallbackDecision(H.Terms memory t, bytes32 id, uint8 outcome, address who, uint256 pk)
        internal
        view
        returns (H.Decision memory m)
    {
        m = _beaconDecision(id, H.ROLE_FALLBACK, outcome, t.timing.judgeBy);
        m = _signDecision(t, id, m, who, pk);
    }

    /// The appeal adjudicator's decision on a case escalated at `at` (its round is at + 1), signed by `pk` for `who`.
    function _appealDecision(H.Terms memory t, bytes32 id, uint8 outcome, uint64 at, address who, uint256 pk)
        internal
        view
        returns (H.Decision memory m)
    {
        m = _beaconDecision(id, H.ROLE_APPEAL, outcome, at + 1);
        m = _signDecision(t, id, m, who, pk);
    }

    /// Everything a step can change for this deal: its storage word, the posted delivery, and every party's,
    /// the token store's and `extra`'s balance.
    function _state(H.Terms memory t, bytes32 id, address extra) internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                rules.dealOf(id),
                rules.deliveryHashOf(id),
                usdc.balanceOf(t.buyer),
                usdc.balanceOf(t.seller),
                usdc.balanceOf(t.adjudicator),
                usdc.balanceOf(t.fallbackAdjudicator),
                usdc.balanceOf(t.appealAdjudicator),
                usdc.balanceOf(extra),
                _held(t)
            )
        );
    }

    function _is(bytes32 id, HoldbackRules.Stage s) internal view {
        assertEq(uint8(_stage(id)), uint8(s), "stage");
    }
}
