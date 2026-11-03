// Exact decimal arithmetic for the cost collector (T-052). Hard rule: money never becomes a float.
// Every amount and quantity is a decimal string; arithmetic runs on bigint at a shared scale.

const DECIMAL = /^(-)?(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/;

/** Parses a decimal or exponent string into sign, digits and the power of ten that scales them. */
function split(text) {
  const m = DECIMAL.exec(String(text).trim());
  if (!m) throw new TypeError('not a decimal number');
  const [, minus, whole, frac = '', exp = '0'] = m;
  return { negative: minus === '-', digits: `${whole}${frac}`, power: Number.parseInt(exp, 10) - frac.length };
}

/** Builds the canonical string for digits × 10^power: no exponent, no leading or trailing zeros. */
function join(negative, digits, power) {
  let int;
  let frac;
  if (power >= 0) {
    int = digits + '0'.repeat(power);
    frac = '';
  } else {
    const padded = digits.padStart(-power + 1, '0');
    int = padded.slice(0, padded.length + power);
    frac = padded.slice(padded.length + power);
  }
  int = int.replace(/^0+(?=\d)/, '');
  frac = frac.replace(/0+$/, '');
  const body = frac ? `${int}.${frac}` : int;
  return negative && /[1-9]/.test(body) ? `-${body}` : body;
}

/** "0.10" → "0.1", "1e-7" → "0.0000001", "-0" → "0". */
export function canonicalDecimal(text) {
  const { negative, digits, power } = split(text);
  return join(negative, digits, power);
}

/** Multiplies a decimal string by 10^places exactly. */
export function shiftDecimal(text, places) {
  const { negative, digits, power } = split(text);
  return join(negative, digits, power + places);
}

/** A dollar amount as cents, exactly: "0.1" → "10", "1e-7" → "0.00001". */
export function dollarsToCents(text) {
  return shiftDecimal(text, 2);
}

function toScaled(text, scale) {
  const { negative, digits, power } = split(text);
  const value = BigInt(digits) * 10n ** BigInt(power + scale);
  return negative ? -value : value;
}

function fractionDigits(text) {
  const { power } = split(text);
  return power < 0 ? -power : 0;
}

/** Adds decimal strings exactly. */
export function addDecimals(...values) {
  if (values.length === 0) return '0';
  const scale = Math.max(...values.map(fractionDigits));
  const sum = values.reduce((acc, v) => acc + toScaled(v, scale), 0n);
  const negative = sum < 0n;
  return join(negative, (negative ? -sum : sum).toString(), -scale);
}

/** Compares decimal strings: -1, 0 or 1. */
export function compareDecimals(a, b) {
  const scale = Math.max(fractionDigits(a), fractionDigits(b));
  const x = toScaled(a, scale);
  const y = toScaled(b, scale);
  return x < y ? -1 : x > y ? 1 : 0;
}

/** An integer string from a decimal string; refuses a fraction. */
export function integerString(text) {
  const c = canonicalDecimal(text);
  if (c.includes('.')) throw new TypeError('not an integer');
  return c;
}

/** A hex quantity from JSON-RPC ("0x1bc16d674ec80000") as a decimal string. */
export function hexToDecimal(hex) {
  if (typeof hex !== 'string' || !/^0x[0-9a-fA-F]+$/.test(hex)) throw new TypeError('not a hex quantity');
  return BigInt(hex).toString();
}

/**
 * JSON.parse that keeps every number as its exact source text, so a dollar amount such as 0.1 is never
 * rounded through a float. Needs the reviver's source-text context (Node 21 and later; Node 22 here).
 */
export function parseJsonExact(text) {
  let checked = false;
  return JSON.parse(text, (key, value, context) => {
    if (typeof value !== 'number') return value;
    if (!checked && typeof context?.source !== 'string') throw new Error('this Node does not expose JSON source text; use Node 22');
    checked = true;
    return context.source;
  });
}

const BASES = new Set(['billed', 'estimated', 'balance']);
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * One output line, validated: quantity and cents are canonical decimal strings, the basis is one of three,
 * and the period is two UTC dates. Quantities are integers except where a provider bills fractions
 * (Cloudflare's GB-months, for example).
 */
export function makeLine({ source, product, unit, quantity, amount = null, basis, periodFrom, periodTo }) {
  if (typeof source !== 'string' || typeof product !== 'string' || typeof unit !== 'string') throw new TypeError('line needs source, product and unit');
  if (!BASES.has(basis)) throw new TypeError('line basis must be billed, estimated or balance');
  if (!DAY.test(periodFrom) || !DAY.test(periodTo)) throw new TypeError('line period must be two dates');
  const out = { source, product, unit, quantity: canonicalDecimal(quantity), amount: null, basis, periodFrom, periodTo };
  if (amount !== null) {
    if (typeof amount.currency !== 'string' || !/^[A-Z]{3}$/.test(amount.currency)) throw new TypeError('amount needs a currency code');
    out.amount = { cents: canonicalDecimal(amount.cents), currency: amount.currency };
  }
  return out;
}
