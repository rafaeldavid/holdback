// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AuthCaptureEscrow} from "commerce-payments/AuthCaptureEscrow.sol";

import {HoldbackRules} from "../../src/HoldbackRules.sol";
import {IHoldbackBeacon} from "../../src/IHoldbackBeacon.sol";
import {Base} from "./Base.sol";

/// @title The constructor's checks (T-380, R8 fix 4)
/// @notice Every constructor argument is an immutable with no setter (no admin keys), so a mistake at deploy lasts the
///         deployment's life. The constructor refuses, with `ZeroAddress`, a zero escrow, ERC-3009 collector, beacon
///         or token: each would leave every deal unfundable or unsettleable. It refuses a beacon margin of 0 off the
///         local chain (`NoBeaconMargin`, ADR-0032 §3.4; `BeaconMargin.t.sol`). It does not check that the token
///         address holds code: that check is the deploy script's and the start-up check's (CU-1; withdrawn from R8 on
///         Rafa's question, 2026-11-12). The parent took every zero address.
contract ConstructorChecksTest is Base {
    function _deploy(AuthCaptureEscrow e, address c, IHoldbackBeacon b, address tok) internal returns (bool ok, bytes memory ret) {
        (ok, ret) = address(this).call(abi.encodeCall(this.deploy, (e, c, b, tok)));
    }

    function deploy(AuthCaptureEscrow e, address c, IHoldbackBeacon b, address tok) external returns (address) {
        return address(new HoldbackRules(e, c, MARGIN, b, tok, 0));
    }

    function _refused(AuthCaptureEscrow e, address c, IHoldbackBeacon b, address tok) internal {
        (bool ok, bytes memory ret) = _deploy(e, c, b, tok);
        assertFalse(ok, "deployed");
        assertEq(ret, abi.encodeWithSelector(HoldbackRules.ZeroAddress.selector));
    }

    function test_zeroEscrow_refused() public {
        _refused(AuthCaptureEscrow(address(0)), address(collector3009), sim, address(usdc));
    }

    function test_zeroCollector_refused() public {
        _refused(escrow, address(0), sim, address(usdc));
    }

    function test_zeroBeacon_refused() public {
        _refused(escrow, address(collector3009), IHoldbackBeacon(address(0)), address(usdc));
    }

    function test_zeroToken_refused() public {
        _refused(escrow, address(collector3009), sim, address(0));
    }

    function test_everyAddressSet_deploys() public {
        (bool ok,) = _deploy(escrow, address(collector3009), sim, address(usdc));
        assertTrue(ok);
    }

    /// No code check on the token (CU-1 owns it): an address with no code deploys.
    function test_tokenWithoutCode_deploys() public {
        (bool ok,) = _deploy(escrow, address(collector3009), sim, address(0x70CE));
        assertTrue(ok, "the constructor checks the token's code");
    }
}
