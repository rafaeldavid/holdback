// DeepSeek's prepaid balance, the only cap DeepSeek offers: GET /user/balance (DeepSeek API docs, read
// 2026-11-03). Balances are decimal strings in CNY or USD and stay in their own currency.
import { dollarsToCents, makeLine } from '../money.mjs';
import { expectShape, getJson } from './http.mjs';

export const id = 'deepseek';
export const credentials = ['CROW_COSTS_DEEPSEEK_KEY'];

export async function collect(ctx) {
  const body = await getJson(ctx, 'https://api.deepseek.com/user/balance', {
    headers: { Authorization: `Bearer ${ctx.env.CROW_COSTS_DEEPSEEK_KEY}`, Accept: 'application/json' },
  });
  expectShape(body && Array.isArray(body.balance_infos));
  const lines = [];
  for (const b of body.balance_infos) {
    expectShape(typeof b?.currency === 'string' && /^[A-Z]{3}$/.test(b.currency));
    // CNY's minor unit is the fen, a hundredth, so "cents" are hundredths in either currency.
    const balance = (product, value) =>
      makeLine({ source: id, product, unit: 'balance', quantity: '1', amount: { cents: dollarsToCents(value ?? '0'), currency: b.currency }, basis: 'balance', periodFrom: ctx.period.to, periodTo: ctx.period.to });
    lines.push(balance(body.is_available === false ? 'Balance (too low for API calls)' : 'Balance', b.total_balance));
    lines.push(balance('Balance: granted', b.granted_balance));
    lines.push(balance('Balance: topped up', b.topped_up_balance));
  }
  return lines;
}
