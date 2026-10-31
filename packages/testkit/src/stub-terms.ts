// Built-in stand-ins for the club rulebook and commitment terms, used when a scenario names no club or
// terms file (or names one that is absent); the snapshot says which.
import { tokenAmount, type AcceptanceSpec, type Deliverable, type Rulebook, type TokenAmount } from '@holdback/core';

export const TOKEN = 'tUSD';
export const TOKEN_DECIMALS = 6;
/** Local dev chain ID (Anvil/Hardhat). Never a mainnet ID. */
export const SIM_CHAIN_ID = 31337;

export function tusd(amount: string | bigint): TokenAmount {
  const r = tokenAmount(TOKEN, amount);
  if (!r.ok) throw new RangeError(`invalid ${TOKEN} amount ${String(amount)}: ${r.error.kind}`);
  return r.value;
}

export const STUB_CLUB_ID = 'data-services-v1';

export const STUB_RULEBOOK: Rulebook = {
  version: '1.0-stub',
  open: true,
  minWindowsSec: { judge: 120, fallback: 120, appealWindow: 300, appealDecide: 300 },
  windowCoverageRatioBps: 2000,
  appealBondRateBps: 500,
  sealedChecksMaxWeightBps: 3000,
  maxSubmissions: 1,
  defaultOutcome: { judged: { refundBuyer: true, sellerCompensationRateBps: 10000 } },
  allowedSettlementModes: ['guaranteed_on_decision'],
  allowedTokens: [TOKEN],
  panelPolicyMin: { panelSize: 3, appealPanelSize: 5, minFamilies: 2 },
  appealFee: tusd('25000000'),
  mutualSettlement: { allowed: true, adjudicatorFeeShareAfterDeliveryBps: 0, payoutsTo: 'any' },
  disclosureMin: 'public',
  identityModes: ['long-term'],
  firstLossShareMinBps: 1000,
  bondNoticePeriodMinSec: 600,
  randomness: { source: 'sim' },
  minInspectionWindowSec: 3600,
  disputeBond: tusd('50000000'),
};

export const STUB_PRICE = tusd('2000000000');
export const STUB_FEE = tusd('50000000');

export const STUB_DELIVERABLE: Deliverable = {
  kind: 'dataset',
  description: 'Clean customers.csv: deduplicate on customer_id, normalize signup_date to ISO 8601, validate email format.',
  format: 'text/csv',
};

export const STUB_ACCEPTANCE: AcceptanceSpec = {
  deterministicChecks: [
    { id: 'cols', type: 'csv_columns_exact', required: true, columns: ['customer_id', 'name', 'email', 'signup_date', 'email_valid'] },
    { id: 'rows', type: 'row_count_range', required: true, min: 9400, max: 9600 },
    { id: 'uniq', type: 'unique_key', required: true, columns: ['customer_id'] },
    { id: 'dates', type: 'iso8601_date_column', required: true, column: 'signup_date' },
    { id: 'emails', type: 'regex_match_rate_min', required: false, column: 'email', pattern: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$', minBps: 9700 },
  ],
  rubric: {
    criteria: [
      { id: 'dedupe_quality', description: 'Most recent complete record kept per customer_id.', weight: 40, anchors: { '0': 'No consistent rule', '2': 'Some errors', '4': 'Consistent' } },
      { id: 'no_fabrication', description: 'No values invented; missing emails flagged.', weight: 40, anchors: { '0': 'Fabricated values', '2': 'Minor fills', '4': 'None' } },
      { id: 'notes', description: 'Change log explains the rules applied.', weight: 20, anchors: { '0': 'Missing', '2': 'Partial', '4': 'Complete' } },
    ],
    passThreshold: 300,
  },
};

// The panel, policy and registry are no longer stubs: judges-config.ts loads config/judges.yaml and the
// adjudicator policy, and judgment.ts runs @holdback/judgment (T-016).
