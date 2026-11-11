// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SignatureCheckerLib} from "solady/utils/SignatureCheckerLib.sol";
import {HoldbackRules} from "../../src/HoldbackRules.sol";
import {HoldbackTypes as H} from "../../src/HoldbackTypes.sol";
import {SignerBase} from "./ContractSigners.sol";

/// Account code that answers ERC-1271 for the account's own key, as EIP-7702 account implementations do.
contract SelfKeyAccount {
    function isValidSignature(bytes32 hash, bytes calldata sig) external view returns (bytes4) {
        if (sig.length != 65) return bytes4(0xffffffff);
        address who = ecrecover(hash, uint8(sig[64]), bytes32(sig[0:32]), bytes32(sig[32:64]));
        return who == address(this) && who != address(0) ? bytes4(0x1626ba7e) : bytes4(0xffffffff);
    }
}

/// Account code with no ERC-1271 function: a batch executor only.
contract ExecutorOnlyAccount {
    function execute(address to, bytes calldata data) external {
        (bool ok,) = to.call(data);
        require(ok);
    }
}

/// Account code that answers ERC-1271 for a session key fixed in the code, and not for the account's own key.
contract SessionKeyAccount {
    address public immutable sessionKey;

    constructor(address k) {
        sessionKey = k;
    }

    function isValidSignature(bytes32 hash, bytes calldata sig) external view returns (bytes4) {
        if (sig.length != 65) return bytes4(0xffffffff);
        address who = ecrecover(hash, uint8(sig[64]), bytes32(sig[0:32]), bytes32(sig[32:64]));
        return who == sessionKey && who != address(0) ? bytes4(0x1626ba7e) : bytes4(0xffffffff);
    }
}

/// Calls Solady's check directly, the one `HoldbackRules._requireSigned` makes.
contract CheckerHarness {
    function check(address signer, bytes32 digest, bytes calldata sig) external view returns (bool) {
        return SignatureCheckerLib.isValidSignatureNowCalldata(signer, digest, sig);
    }
}

contract Poke {
    function poke() external {}
}

/// T-346 (ADR-0031 §5, red-team M-4): a party that is an EOA with delegated code (EIP-7702). Solady's
/// `isValidSignatureNowCalldata` picks one check by `extcodesize(signer)`: with no code it recovers the ECDSA signer,
/// and with any code it calls ERC-1271 and nothing else. There is no fallback in either direction. A delegated EOA has
/// code (the 23-byte designator 0xef0100 ‖ address), so its signatures are checked by ERC-1271 alone, run as the
/// delegated code. Its plain key signature keeps working only if that code answers ERC-1271 for the key; code that
/// answers for another key, or not at all, overrides the key. These tests pin that behaviour and show that a deal whose
/// party loses its signature this way still ends by its timeouts. The delegation is attached with forge-std's
/// `vm.signAndAttachDelegation` (forge-std 1.9.6, forge 1.0.0, evm_version prague).
contract Eip7702SignersTest is SignerBase {
    uint256 internal constant SESSION_PK = 0x5E55;

    SelfKeyAccount internal selfKey;
    ExecutorOnlyAccount internal executorOnly;
    SessionKeyAccount internal sessionKey;
    CheckerHarness internal checker;
    Poke internal poker;

    function setUp() public override {
        super.setUp();
        selfKey = new SelfKeyAccount();
        executorOnly = new ExecutorOnlyAccount();
        sessionKey = new SessionKeyAccount(vm.addr(SESSION_PK));
        checker = new CheckerHarness();
        poker = new Poke();
    }

    /// Attaches `impl` as `pk`'s delegated code with a signed EIP-7702 authorization on the next call, and checks the
    /// account now carries the designator.
    function _delegate(uint256 pk, address impl) internal {
        vm.signAndAttachDelegation(impl, pk);
        poker.poke();
        assertEq(vm.addr(pk).code, abi.encodePacked(hex"ef0100", impl), "the delegation designator is in place");
    }

    // ------------------------------------------------------------ which check Solady prefers

    /// Solady's check, called directly: before delegation the account's own key signature is valid (ECDSA). With
    /// session-key code the own-key signature is invalid and the session key's is valid: ERC-1271 alone decides, no
    /// ECDSA fallback. With self-key code the own-key signature is valid again, through ERC-1271. With executor-only
    /// code (no isValidSignature) no signature is valid.
    function test_solady_delegatedEoa_isCheckedByErc1271Only() public {
        bytes32 digest = keccak256("any digest");
        address eoa = vm.addr(OTHER_PK);
        bytes memory ownSig = _signRaw(OTHER_PK, digest);
        bytes memory sessionSig = _signRaw(SESSION_PK, digest);
        assertTrue(checker.check(eoa, digest, ownSig), "no code: ECDSA, the key signs");
        assertFalse(checker.check(eoa, digest, sessionSig), "no code: ECDSA, another key does not");

        _delegate(OTHER_PK, address(sessionKey));
        assertFalse(checker.check(eoa, digest, ownSig), "session code: the account's own key is refused");
        assertTrue(checker.check(eoa, digest, sessionSig), "session code: ERC-1271 accepts the session key");

        _delegate(OTHER_PK, address(selfKey));
        assertTrue(checker.check(eoa, digest, ownSig), "self-key code: the own key signs through ERC-1271");
        assertFalse(checker.check(eoa, digest, sessionSig));

        _delegate(OTHER_PK, address(executorOnly));
        assertFalse(checker.check(eoa, digest, ownSig), "executor code: nothing answers, the own key is refused");
        assertFalse(checker.check(eoa, digest, sessionSig));
    }

    // ------------------------------------------------------------ a plain signature that keeps working

    /// The buyer, an EOA, funds and signs its early accept, then attaches self-key account code before the accept is
    /// relayed. The plain signature still lands the accept (through ERC-1271 now): the seller is paid the price and
    /// the fee returns to the buyer.
    function test_delegatedBuyer_selfKeyCode_plainEarlyAcceptKeepsWorking() public {
        (H.Terms memory t, bytes32 id) = _funded();
        (H.Delivery memory d, H.KeyProof memory k) = _deliver(t, id);
        H.EarlyAccept memory m = _early(t, id, BUYER_PK);

        _delegate(BUYER_PK, address(selfKey));
        uint256 buyerBefore = usdc.balanceOf(buyer);
        uint256 sellerBefore = usdc.balanceOf(seller);
        rules.earlyAccept(t, m, d, "", k);
        _is(id, HoldbackRules.Stage.Released);
        assertEq(usdc.balanceOf(seller) - sellerBefore, PRICE);
        assertEq(usdc.balanceOf(buyer) - buyerBefore, FEE);
    }

    /// The seller, an EOA with self-key code attached after funding, posts its delivery and settles with the buyer
    /// with plain signatures; the primary, an EOA with self-key code, decides with a plain signature.
    function test_delegatedSellerAndPrimary_selfKeyCode_plainSignaturesKeepWorking() public {
        (H.Terms memory t, bytes32 id) = _funded();
        _delegate(SELLER_PK, address(selfKey));
        _delegate(ADJ_PK, address(selfKey));
        _deliver(t, id);
        _is(id, HoldbackRules.Stage.Delivered);
        uint256 sellerBefore = usdc.balanceOf(seller);
        rules.decide(t, _primary(t, id, H.OUTCOME_ACCEPT), _noDelivery(), "");
        _is(id, HoldbackRules.Stage.Released);
        assertEq(usdc.balanceOf(seller) - sellerBefore, PRICE);
        assertEq(usdc.balanceOf(adjudicator), FEE);
    }

    // ------------------------------------------------------------ delegated code that overrides the key

    /// M-4, pinned: the primary, an EOA, signs its decision, then attaches code with no ERC-1271 function. Its
    /// pending signature is lost: the decision is refused with BadSignature. At judgeBy the fallback takes over and
    /// decides, so the deal settles as the terms name.
    function test_delegatedPrimary_codeWithoutErc1271_losesPendingSignature_fallbackDecides() public {
        (H.Terms memory t, bytes32 id) = _funded();
        _deliver(t, id);
        H.Decision memory m = _primary(t, id, H.OUTCOME_ACCEPT);

        _delegate(ADJ_PK, address(executorOnly));
        vm.expectRevert(HoldbackRules.BadSignature.selector);
        rules.decide(t, m, _noDelivery(), "");
        _is(id, HoldbackRules.Stage.Delivered);

        vm.warp(t.timing.judgeBy);
        rules.triggerFallback(t);
        uint256 sellerBefore = usdc.balanceOf(seller);
        rules.decide(t, _fallbackDecision(t, id, H.OUTCOME_ACCEPT, fallbackAdj, FB_PK), _noDelivery(), "");
        _is(id, HoldbackRules.Stage.Released);
        assertEq(usdc.balanceOf(seller) - sellerBefore, PRICE);
        assertEq(usdc.balanceOf(fallbackAdj), FEE);
        assertEq(usdc.balanceOf(adjudicator), 0, "the primary gets nothing");
    }

    /// The primary, an EOA, attaches code that answers ERC-1271 for a session key. Its own key's decision is refused
    /// with BadSignature; the session key's decision for the same account lands and the fee goes to the account.
    /// ERC-1271 wins over the key.
    function test_delegatedPrimary_sessionKeyCode_overridesItsOwnKey() public {
        (H.Terms memory t, bytes32 id) = _funded();
        _deliver(t, id);
        _delegate(ADJ_PK, address(sessionKey));

        H.Decision memory byOwnKey = _primary(t, id, H.OUTCOME_REJECT);
        vm.expectRevert(HoldbackRules.BadSignature.selector);
        rules.decide(t, byOwnKey, _noDelivery(), "");
        H.Decision memory bySession =
            _signDecision(t, id, _decision(H.ROLE_PRIMARY, H.OUTCOME_REJECT), adjudicator, SESSION_PK);
        uint256 buyerBefore = usdc.balanceOf(buyer);
        rules.decide(t, bySession, _noDelivery(), "");
        _is(id, HoldbackRules.Stage.Refunded);
        assertEq(usdc.balanceOf(buyer) - buyerBefore, PRICE);
        assertEq(usdc.balanceOf(adjudicator), FEE, "the fee goes to the delegated account");
    }

    /// The seller, an EOA, signs the terms, then attaches executor-only code before funding. The funding is refused
    /// with BadSignature and nothing moves; after the offer expires anyone records the expiry.
    function test_delegatedSeller_codeWithoutErc1271_beforeFunding_offerExpires() public {
        H.Terms memory t = _terms();
        bytes memory sellerSig = _sellerSig(t, SELLER_PK);
        H.Acceptance memory acc = _acceptance(t, ADJ_PK);
        H.Agree memory ag = _agree(t, BUYER_PK);
        H.Funding memory f = _erc3009(t, BUYER_PK);
        uint256 buyerStart = usdc.balanceOf(buyer);

        _delegate(SELLER_PK, address(executorOnly));
        vm.expectRevert(HoldbackRules.BadSignature.selector);
        rules.agreeAndFund(t, sellerSig, acc, ag, f);
        assertEq(usdc.balanceOf(buyer), buyerStart);

        vm.warp(t.timing.offerExpiresAt);
        rules.expireOffer(t);
        _is(hx.id(t), HoldbackRules.Stage.Expired);
    }
}
