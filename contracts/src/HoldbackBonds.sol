// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SafeTransferLib} from "solady/utils/SafeTransferLib.sol";

/// @title HoldbackBonds
/// @notice Phase 2 bond custody primitives: an adjudicator deposits its own bond, the rules contract
///         encumbers and releases it per commitment, and the adjudicator withdraws only what is unencumbered.
///         Appeal bonds are held per commitment until the appeal closes.
/// @dev No owner, pause or upgrade path. The only privileged caller is RULES, the HoldbackRules contract that
///      deployed this one: a fixed code address, not a key. Coverage ratios, backers, overturn payouts and default
///      compensation are Phase 4 (docs/plan.md).
contract HoldbackBonds {
    using SafeTransferLib for address;

    /// @notice The rules contract that deployed this vault; the only address that may encumber or move bonds.
    address public immutable RULES;

    mapping(address adjudicator => mapping(address token => uint256)) public bondOf;
    mapping(address adjudicator => mapping(address token => uint256)) public encumberedOf;

    struct AppealBond {
        address appellant;
        uint96 amount;
    }

    mapping(bytes32 commitmentId => AppealBond) public appealBondOf;

    event BondDeposited(address indexed adjudicator, address indexed token, uint256 amount);
    event BondWithdrawn(address indexed adjudicator, address indexed token, uint256 amount);
    event BondEncumbered(address indexed adjudicator, address indexed token, uint256 amount);
    event BondReleased(address indexed adjudicator, address indexed token, uint256 amount);
    event AppealBondHeld(bytes32 indexed commitmentId, address indexed appellant, uint256 amount);
    event AppealBondPaid(bytes32 indexed commitmentId, address indexed to, bool toBond, uint256 amount);

    error NotRules();
    error InsufficientFreeBond(uint256 free, uint256 needed);
    error AppealBondTooLarge();
    error AppealBondExists();

    constructor() {
        RULES = msg.sender;
    }

    modifier onlyRules() {
        if (msg.sender != RULES) revert NotRules();
        _;
    }

    /// @notice Adds to the caller's own bond. A deposit for someone else (a backer) is Phase 4.
    function deposit(address token, uint256 amount) external {
        bondOf[msg.sender][token] += amount;
        emit BondDeposited(msg.sender, token, amount);
        token.safeTransferFrom(msg.sender, address(this), amount);
    }

    /// @notice Withdraws from the caller's own bond, up to what no open commitment has encumbered.
    function withdraw(address token, uint256 amount) external {
        uint256 free = freeOf(msg.sender, token);
        if (amount > free) revert InsufficientFreeBond(free, amount);
        bondOf[msg.sender][token] -= amount;
        emit BondWithdrawn(msg.sender, token, amount);
        token.safeTransfer(msg.sender, amount);
    }

    function freeOf(address adjudicator, address token) public view returns (uint256) {
        return bondOf[adjudicator][token] - encumberedOf[adjudicator][token];
    }

    function encumber(address adjudicator, address token, uint256 amount) external onlyRules {
        uint256 free = freeOf(adjudicator, token);
        if (free < amount) revert InsufficientFreeBond(free, amount);
        encumberedOf[adjudicator][token] += amount;
        emit BondEncumbered(adjudicator, token, amount);
    }

    function release(address adjudicator, address token, uint256 amount) external onlyRules {
        encumberedOf[adjudicator][token] -= amount;
        emit BondReleased(adjudicator, token, amount);
    }

    /// @notice Pulls an appellant's bond (ERC-20 allowance to this vault) and holds it for the commitment.
    function takeAppealBond(bytes32 id, address appellant, address token, uint256 amount) external onlyRules {
        if (amount > type(uint96).max) revert AppealBondTooLarge();
        if (appealBondOf[id].appellant != address(0)) revert AppealBondExists();
        appealBondOf[id] = AppealBond(appellant, uint96(amount));
        emit AppealBondHeld(id, appellant, amount);
        token.safeTransferFrom(appellant, address(this), amount);
    }

    /// @notice Pays a held appeal bond: into `adjudicator`'s bond when the appeal is upheld (ADR-0014 §2a), or back
    ///         to the appellant when `adjudicator` is zero (overturned or expired undecided).
    function payAppealBond(bytes32 id, address token, address adjudicator) external onlyRules {
        AppealBond memory b = appealBondOf[id];
        delete appealBondOf[id];
        if (b.amount == 0) return;
        if (adjudicator != address(0)) {
            bondOf[adjudicator][token] += b.amount;
            emit AppealBondPaid(id, adjudicator, true, b.amount);
        } else {
            emit AppealBondPaid(id, b.appellant, false, b.amount);
            token.safeTransfer(b.appellant, b.amount);
        }
    }
}
