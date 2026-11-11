// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SignatureCheckerLib} from "solady/utils/SignatureCheckerLib.sol";
import {MockERC3009Token} from "commerce-payments-test/mocks/MockERC3009Token.sol";
import {HoldbackBonds} from "../../src/HoldbackBonds.sol";
import {HoldbackRules} from "../../src/HoldbackRules.sol";
import {HoldbackTypes as H} from "../../src/HoldbackTypes.sol";
import {Base} from "./Base.sol";

/// A token that calls back both ends of a transfer (ERC-777 style): the sender before the balances move
/// (`tokensToSend`) and the recipient after (`tokensReceived`). Withstood.t.sol's HookToken calls the recipient only.
contract BondHookToken is MockERC3009Token {
    mapping(address => bool) public hooked;

    constructor() MockERC3009Token("Bond hook", "BHOOK", 6) {}

    function setHooked(address a, bool on) external {
        hooked[a] = on;
    }

    function _beforeTokenTransfer(address from, address, uint256) internal override {
        if (hooked[from]) HookWallet(from).tokensToSend();
    }

    function _afterTokenTransfer(address, address to, uint256) internal override {
        if (hooked[to]) HookWallet(to).tokensReceived();
    }
}

/// An ERC-1271 wallet for one EOA owner that can bond, fund, appeal and be paid, and that runs one prepared call from
/// a token callback: on the `skip + 1`-th send or receive, as armed. It records whether the nested call succeeded.
contract HookWallet {
    uint8 internal constant ON_SEND = 1;
    uint8 internal constant ON_RECEIVE = 2;

    address public immutable owner;
    uint8 public when;
    uint8 public skip;
    address public target;
    bytes public payload;
    bool public called;
    bool public succeeded;
    bytes public revertData;

    constructor(address owner_) {
        owner = owner_;
    }

    function isValidSignature(bytes32 hash, bytes calldata sig) external view returns (bytes4) {
        return SignatureCheckerLib.isValidSignatureNowCalldata(owner, hash, sig) ? bytes4(0x1626ba7e) : bytes4(0);
    }

    /// The owner's own calls (approve, deposit, withdraw); a revert bubbles up.
    function exec(address to, bytes calldata data) external {
        (bool ok, bytes memory ret) = to.call(data);
        if (!ok) {
            assembly {
                revert(add(ret, 0x20), mload(ret))
            }
        }
    }

    function arm(uint8 when_, uint8 skip_, address target_, bytes calldata payload_) external {
        (when, skip, target, payload, called) = (when_, skip_, target_, payload_, false);
    }

    function tokensToSend() external {
        if (when == ON_SEND) _fire();
    }

    function tokensReceived() external {
        if (when == ON_RECEIVE) _fire();
    }

    function _fire() internal {
        if (skip > 0) {
            skip--;
            return;
        }
        when = 0; // once
        called = true;
        (bool ok, bytes memory ret) = target.call(payload);
        succeeded = ok;
        revertData = ret;
    }
}

/// T-335: reentrancy into the bond vault through a hook token. HoldbackBonds has no reentrancy guard (plan, secure
/// item 4), so these tests re-enter deposit, withdraw, release and encumber, and the rules paths that move vault
/// tokens (appeal bond pull and refund, slash, the decider's fee), from inside each transfer. Each asserts no double
/// credit and no double withdrawal: the vault's balance always equals the bonds and appeal bonds it records.
contract BondsReentrancyTest is Base {
    uint8 internal constant ON_SEND = 1;
    uint8 internal constant ON_RECEIVE = 2;
    uint256 internal constant W_PK = 0x7A11E7;
    uint256 internal constant A = 5_000_000;
    uint256 internal constant APPEAL_BOND = 1_000;

    BondHookToken internal tok;
    HookWallet internal w;

    function setUp() public override {
        super.setUp();
        tok = new BondHookToken();
        w = new HookWallet(vm.addr(W_PK));
        tok.setHooked(address(w), true);
        w.exec(address(tok), abi.encodeCall(tok.approve, (address(bonds), type(uint256).max)));
        // Honest bonders, so the vault holds other people's money a reentry could try to take.
        _bondTok(adjudicator, BOND);
        _bondTok(fallbackAdj, BOND);
        _bondTok(appealAdj, BOND);
        tok.mint(buyer, 1_000_000_000);
    }

    function _bondTok(address a, uint256 amount) internal {
        tok.mint(a, amount);
        vm.startPrank(a);
        tok.approve(address(bonds), amount);
        bonds.deposit(address(tok), amount);
        vm.stopPrank();
    }

    function _vault() internal view returns (uint256) {
        return tok.balanceOf(address(bonds));
    }

    function _wDeposit(uint256 amount) internal {
        tok.mint(address(w), amount);
        w.exec(address(bonds), abi.encodeCall(HoldbackBonds.deposit, (address(tok), amount)));
    }

    /// A deal in the hook token. `walletIsPrimary` names the wallet as primary (it signs the acceptance through
    /// ERC-1271); otherwise the wallet is the buyer and funds through ERC-3009 with an ERC-1271 signature.
    function _hookDeal(bool walletIsPrimary) internal returns (H.Terms memory t, bytes32 id) {
        t = _terms();
        t.token = address(tok);
        uint256 adjPk = ADJ_PK;
        uint256 buyerPk = BUYER_PK;
        if (walletIsPrimary) {
            t.adjudicator = address(w);
            adjPk = W_PK;
        } else {
            t.buyer = address(w);
            buyerPk = W_PK;
            tok.mint(address(w), PRICE + FEE + APPEAL_BOND);
        }
        bytes memory s = _sellerSig(t, SELLER_PK);
        H.Acceptance memory acc = _acceptance(t, adjPk);
        H.Agree memory ag = _agree(t, buyerPk);
        H.Funding memory f = _erc3009(t, buyerPk);
        vm.prank(relayer);
        id = rules.agreeAndFund(t, s, acc, ag, f);
    }

    function _walletAppeal(H.Terms memory t, bytes32 id) internal view returns (H.Appeal memory a) {
        a = H.Appeal({appellant: 0, groundsHash: keccak256("g"), bond: APPEAL_BOND, filedAt: 0, signature: ""});
        a.signature = _sign(W_PK, hx.appeal(id, address(w), t.token, a));
    }

    // ------------------------------------------------------------ deposit and withdraw

    function test_defense_deposit_reentered_on_pull_credits_each_pull_once() public {
        tok.mint(address(w), 2 * A);
        w.arm(ON_SEND, 0, address(bonds), abi.encodeCall(HoldbackBonds.deposit, (address(tok), A)));
        w.exec(address(bonds), abi.encodeCall(HoldbackBonds.deposit, (address(tok), A)));
        assertTrue(w.called() && w.succeeded(), "the nested deposit ran");
        assertEq(bonds.bondOf(address(w), address(tok)), 2 * A, "two pulls, two credits");
        assertEq(tok.balanceOf(address(w)), 0);
        assertEq(_vault(), 3 * BOND + 2 * A, "the vault holds what it credits");
    }

    /// The vault credits before it pulls, so a withdraw from the pull's send hook sees the credit. It pays out of
    /// other bonders' money for the length of the call; the pull then lands, and the books end even.
    function test_defense_withdraw_inside_deposit_pull_takes_nothing_extra() public {
        tok.mint(address(w), A);
        w.arm(ON_SEND, 0, address(bonds), abi.encodeCall(HoldbackBonds.withdraw, (address(tok), A)));
        w.exec(address(bonds), abi.encodeCall(HoldbackBonds.deposit, (address(tok), A)));
        assertTrue(w.called() && w.succeeded(), "the nested withdraw ran");
        assertEq(bonds.bondOf(address(w), address(tok)), 0);
        assertEq(tok.balanceOf(address(w)), A, "the wallet ends with what it started with");
        assertEq(_vault(), 3 * BOND, "no other bonder's money left the vault");
    }

    function test_defense_withdraw_reentered_on_payout_cannot_withdraw_twice() public {
        _wDeposit(A);
        w.arm(ON_RECEIVE, 0, address(bonds), abi.encodeCall(HoldbackBonds.withdraw, (address(tok), A)));
        w.exec(address(bonds), abi.encodeCall(HoldbackBonds.withdraw, (address(tok), A)));
        assertTrue(w.called());
        assertFalse(w.succeeded(), "the second withdraw was refused");
        assertEq(w.revertData(), abi.encodeWithSelector(HoldbackBonds.InsufficientFreeBond.selector, 0, A));
        assertEq(tok.balanceOf(address(w)), A, "paid once");
        assertEq(bonds.bondOf(address(w), address(tok)), 0);
        assertEq(_vault(), 3 * BOND);
    }

    function test_defense_withdraw_reentered_on_payout_cannot_reach_encumbered_bond() public {
        _wDeposit(BOND);
        _hookDeal(true);
        assertEq(bonds.encumberedOf(address(w), address(tok)), PRICE);
        w.arm(ON_RECEIVE, 0, address(bonds), abi.encodeCall(HoldbackBonds.withdraw, (address(tok), PRICE)));
        w.exec(address(bonds), abi.encodeCall(HoldbackBonds.withdraw, (address(tok), BOND - PRICE)));
        assertFalse(w.succeeded());
        assertEq(w.revertData(), abi.encodeWithSelector(HoldbackBonds.InsufficientFreeBond.selector, 0, PRICE));
        assertEq(bonds.bondOf(address(w), address(tok)), PRICE, "the encumbered part stays");
        assertEq(_vault(), 3 * BOND + PRICE);
    }

    // ------------------------------------------------------------ release, encumber and the other vault moves

    /// From inside a payout the wallet calls every RULES-only function on the vault: each is refused, because the
    /// caller in the callback is the wallet, not the rules contract.
    function test_defense_reentry_cannot_call_rules_only_functions() public {
        _wDeposit(BOND);
        (, bytes32 id) = _hookDeal(true);
        bytes[5] memory calls = [
            abi.encodeCall(HoldbackBonds.release, (address(w), address(tok), PRICE)),
            abi.encodeCall(HoldbackBonds.encumber, (address(w), address(tok), 0)),
            abi.encodeCall(HoldbackBonds.slash, (id, adjudicator, address(tok), 1, address(w))),
            abi.encodeCall(HoldbackBonds.takeAppealBond, (id, buyer, address(tok), 1)),
            abi.encodeCall(HoldbackBonds.payAppealBond, (id, address(tok), address(w)))
        ];
        for (uint256 i; i < calls.length; i++) {
            w.arm(ON_RECEIVE, 0, address(bonds), calls[i]);
            w.exec(address(bonds), abi.encodeCall(HoldbackBonds.withdraw, (address(tok), 1)));
            assertTrue(w.called());
            assertFalse(w.succeeded());
            assertEq(w.revertData(), abi.encodeWithSelector(HoldbackBonds.NotRules.selector));
        }
        assertEq(bonds.encumberedOf(address(w), address(tok)), PRICE);
        assertEq(bonds.bondOf(adjudicator, address(tok)), BOND);
    }

    /// The primary's fee is pushed to it inside its own accept. Its bond stays encumbered until the appeal closes,
    /// so a withdraw from that callback cannot take it.
    function test_defense_fee_payout_reentry_cannot_free_the_deciders_bond() public {
        _wDeposit(BOND);
        (H.Terms memory t, bytes32 id) = _hookDeal(true);
        _deliver(t, id);
        w.arm(ON_RECEIVE, 0, address(bonds), abi.encodeCall(HoldbackBonds.withdraw, (address(tok), BOND)));
        H.Decision memory m = _signDecision(t, id, _decision(H.ROLE_PRIMARY, H.OUTCOME_ACCEPT), address(w), W_PK);
        rules.decide(t, m, _noDelivery(), "");
        assertTrue(w.called(), "the fee reached the wallet");
        assertFalse(w.succeeded());
        assertEq(
            w.revertData(), abi.encodeWithSelector(HoldbackBonds.InsufficientFreeBond.selector, BOND - PRICE, BOND)
        );
        assertEq(uint8(_stage(id)), uint8(HoldbackRules.Stage.Released));
        assertEq(bonds.encumberedOf(address(w), address(tok)), PRICE);
        assertEq(tok.balanceOf(address(w)), FEE);
    }

    function test_defense_appeal_bond_pull_reentry_cannot_file_twice() public {
        (H.Terms memory t, bytes32 id) = _hookDeal(false);
        _deliver(t, id);
        rules.decide(t, _primary(t, id, H.OUTCOME_ACCEPT), _noDelivery(), "");
        H.Appeal memory a = _walletAppeal(t, id);
        w.arm(ON_SEND, 0, address(rules), abi.encodeCall(HoldbackRules.fileAppeal, (t, a)));
        rules.fileAppeal(t, a);
        assertTrue(w.called(), "the pull reached the wallet's send hook");
        assertFalse(w.succeeded());
        assertEq(
            w.revertData(),
            abi.encodeWithSelector(HoldbackRules.WrongAppealState.selector, HoldbackRules.AppealState.Open)
        );
        (address who, uint96 amount) = bonds.appealBondOf(id);
        assertEq(who, address(w));
        assertEq(amount, APPEAL_BOND);
        assertEq(_vault(), 3 * BOND + APPEAL_BOND, "one appeal bond pulled");
    }

    function test_defense_appeal_bond_refund_reentry_cannot_refund_twice() public {
        (H.Terms memory t, bytes32 id) = _hookDeal(false);
        _deliver(t, id);
        rules.decide(t, _primary(t, id, H.OUTCOME_ACCEPT), _noDelivery(), "");
        uint64 decidedAt = uint64(block.timestamp);
        rules.fileAppeal(t, _walletAppeal(t, id));
        uint256 w0 = tok.balanceOf(address(w));
        vm.warp(decidedAt + t.timing.appealWindowSec + t.timing.appealDecideSec);
        w.arm(ON_RECEIVE, 0, address(rules), abi.encodeCall(HoldbackRules.expireAppeal, (t)));
        rules.expireAppeal(t);
        assertTrue(w.called(), "the refund reached the wallet");
        assertFalse(w.succeeded());
        assertEq(
            w.revertData(),
            abi.encodeWithSelector(HoldbackRules.WrongAppealState.selector, HoldbackRules.AppealState.Expired)
        );
        assertEq(tok.balanceOf(address(w)), w0 + APPEAL_BOND, "refunded once");
        assertEq(_vault(), 3 * BOND);
        assertEq(bonds.encumberedOf(adjudicator, address(tok)), 0);
    }

    /// An overturned accept pays the buyer twice from the vault: its appeal bond back, then the price from the
    /// primary's bond. The wallet re-sends the same appeal decision from the second transfer, the slash.
    function test_defense_slash_payee_reentry_slashes_once() public {
        (H.Terms memory t, bytes32 id) = _hookDeal(false);
        _deliver(t, id);
        rules.decide(t, _primary(t, id, H.OUTCOME_ACCEPT), _noDelivery(), "");
        rules.fileAppeal(t, _walletAppeal(t, id));
        uint64 round = uint64(rules.dealOf(id).t2) + 1;
        vm.warp(round);
        H.Decision memory m = _beaconDecision(id, H.ROLE_APPEAL, H.OUTCOME_REJECT, round);
        m = _signDecision(t, id, m, appealAdj, AP_PK);
        uint256 w0 = tok.balanceOf(address(w));
        w.arm(ON_RECEIVE, 1, address(rules), abi.encodeCall(HoldbackRules.decide, (t, m, _noDelivery(), "")));
        rules.decide(t, m, _noDelivery(), "");
        assertTrue(w.called(), "the slash reached the wallet");
        assertFalse(w.succeeded());
        assertEq(
            w.revertData(), abi.encodeWithSelector(HoldbackRules.WrongStage.selector, HoldbackRules.Stage.Released)
        );
        assertEq(uint8(rules.dealOf(id).appeal), uint8(HoldbackRules.AppealState.Overturned));
        assertEq(tok.balanceOf(address(w)), w0 + APPEAL_BOND + PRICE, "paid once");
        assertEq(bonds.bondOf(adjudicator, address(tok)), BOND - PRICE, "slashed once");
        assertEq(bonds.encumberedOf(adjudicator, address(tok)), 0);
        assertEq(_vault(), 3 * BOND - PRICE);
    }
}
