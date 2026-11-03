// sim:check: the invariants of one simulated run, computed from the settlement layer's own record and the
// operators' public answers. Nothing here trusts a party's report, an operator's state view, an unsigned event
// field or a SimChain helper. It re-verifies the hash chain and every signature (each signed message backs one
// event only), replays each commitment's state machine from the log with deadlines from the signed terms,
// re-derives each posting from the signed terms, the signed decisions and the club rulebook, replays the
// postings from genesis into its own ledger, and compares. Party reports only add findings.
import {
  canonicalKeccak,
  commitmentId,
  holdbackDomain,
  verifyMessage,
  verifyMutualSettlement,
  verifyTerms,
  type Address,
  type Club,
  type CommitmentTerms,
  type Decision,
  type Hex32,
  type Judgment,
  type SettlementEvent,
  type SignableMessage,
  type Signature,
} from '@holdback/core';
import type { Submission } from '@holdback/settlement';
import type { CheckInput } from './audit.ts';

export type InvariantId = 'log-integrity' | 'conservation' | 'within-terms' | 'terminal-or-explained' | 'records-match';

export interface Invariant {
  id: InvariantId;
  title: string;
  ok: boolean;
  violations: string[];
}

export interface CommitmentSummary {
  id: string;
  buyer: string;
  seller: string;
  price: string;
  fee: string;
  /** Replayed from the log, not taken from an operator. */
  escrowState: string;
  appealState: string;
  /** final: no protocol step can change who got what. open: a named party or trigger can still move it. */
  status: 'final' | 'open' | 'unexplained';
  explanation: string;
}

export interface CheckResult {
  kind: 'holdback-sim-check';
  runId: string;
  ok: boolean;
  /** Settlement-layer time of the audit. */
  now: string;
  invariants: Invariant[];
  commitments: CommitmentSummary[];
  totals: Array<{ token: string; minted: string; ledger: string }>;
  /** Not violations: where a party's own report disagrees with the record, or could not be read. */
  findings: string[];
}

const TITLES: Record<InvariantId, string> = {
  'log-integrity': 'The settlement log is one unbroken hash chain in time order',
  conservation: 'Funds are conserved per token: the ledger equals genesis plus faucet, account by account, as replayed from the log',
  'within-terms': 'Nothing moved outside the signed terms: every step is allowed by the replayed state and its deadlines, and every posting matches a signed message or a due trigger',
  'terminal-or-explained': 'Every commitment is final, or open for a stated reason, and its held money matches its replayed state',
  'records-match': 'Both parties read the same record: every operator serves the log, the replayed state, the judgment and the balances',
};

const ZERO_HASH = `0x${'00'.repeat(32)}` as Hex32;
const BPS = 10_000n;
const lc = (a: string) => a.toLowerCase();
const ms = (ts: string) => Date.parse(ts);
const plus = (ts: string, sec: number) => new Date(ms(ts) + sec * 1000).toISOString().replace('.000Z', 'Z');
const acct = {
  party: (a: string) => lc(a),
  escrow: (id: string) => `escrow:${id}`,
  appealBond: (id: string) => `appealbond:${id}`,
  appealFee: (id: string) => `appealfee:${id}`,
  junior: (a: string) => `bond:${lc(a)}:junior`,
  senior: (a: string) => `bond:${lc(a)}:senior`,
};
const HOLDING = new Set(['Held', 'Delivered', 'FallbackJudging', 'Escalated', 'Defaulted']);

type Posting = { from: string; to: string; amount: bigint };
const key = (p: Posting) => `${lc(p.from)} -> ${lc(p.to)}: ${p.amount}`;
type Role = 'primary' | 'fallback' | 'appeal';

interface Ctx {
  terms: CommitmentTerms;
  club: Club | undefined;
  price: bigint;
  fee: bigint;
  buyer: string;
  seller: string;
  adjudicators: Record<Role, string>;
  /** The escrow state, replayed from the log. */
  state: string;
  settledAt?: string;
  /** How a Released or Refunded state was reached; only a first-instance decision is appealable. */
  via?: 'first_instance' | 'escalation' | 'early_accept' | 'reclaim' | 'default_outcome';
  escalationDecideBy?: string;
  defaultedFrom?: 'FallbackJudging' | 'Escalated';
  /** A signed accept or reject waiting for its settlement event, in the same submission. */
  pending?: { by: string; role: Role; outcome: 'accept' | 'reject' } | undefined;
  /** The first-instance decision that moved the escrow. */
  first?: { by: string; outcome: 'accept' | 'reject' };
  appeal: { state: 'none' | 'open' | 'upheld' | 'overturned' | 'expired'; appealBy?: string; decideBy?: string; closedAt?: string; appellant?: string };
  /** An overturn whose bond payout has not been seen yet. */
  owedOverturn: boolean;
  /** The buyer has paid for the work, so its content key may be released. */
  paid: boolean;
  slashed: bigint;
  lastRecordHash?: string;
}

function recordHashOf(record: Judgment): string {
  const body: Partial<Judgment> = { ...record };
  delete body.recordHash;
  delete body.signature;
  delete body.recordUri;
  return canonicalKeccak(body);
}

export async function checkRun(input: CheckInput): Promise<CheckResult> {
  const { audit, reads } = input;
  const requireRecords = input.requireJudgmentRecords ?? true;
  const v: Record<InvariantId, string[]> = { 'log-integrity': [], conservation: [], 'within-terms': [], 'terminal-or-explained': [], 'records-match': [] };
  const findings: string[] = [];
  const domain = holdbackDomain(audit.chainId);
  const token = audit.token;

  // 1. Log integrity
  let prev: string = ZERO_HASH;
  let lastAt = -Infinity;
  for (const [i, e] of audit.log.entries()) {
    const { hash, ...body } = e;
    if (e.seq !== i) v['log-integrity'].push(`event ${i} carries seq ${e.seq}`);
    if (e.prevHash !== prev) v['log-integrity'].push(`event ${e.seq} (${e.type}) does not link to the event before it`);
    if (canonicalKeccak(body) !== hash) v['log-integrity'].push(`event ${e.seq} (${e.type}) does not hash to its own hash: it was edited after it was written`);
    if (!(ms(e.at) >= lastAt)) v['log-integrity'].push(`event ${e.seq} (${e.type}) at ${e.at} is earlier than the event before it`);
    lastAt = Math.max(lastAt, ms(e.at));
    prev = hash;
  }

  // 2. Replay from genesis
  const ledger = new Map<string, bigint>();
  const add = (k: string, n: bigint) => ledger.set(k, (ledger.get(k) ?? 0n) + n);
  let minted = 0n;
  const mint = (k: string, n: bigint) => {
    add(k, n);
    minted += n;
  };
  for (const [a, n] of Object.entries(audit.genesis.balances)) mint(acct.party(a), BigInt(n));
  for (const [a, b] of Object.entries(audit.genesis.bonds)) {
    mint(acct.junior(a), BigInt(b.junior));
    mint(acct.senior(a), BigInt(b.senior));
  }
  for (const j of audit.journal) if (j.op === 'faucet') mint(acct.party(j.address), BigInt(j.amount));
  const post = (p: Posting, e: SettlementEvent) => {
    add(p.from, -p.amount);
    add(p.to, p.amount);
    if ((ledger.get(p.from) ?? 0n) < 0n) v.conservation.push(`event ${e.seq} (${e.type}) takes ${ledger.get(p.from)! + p.amount} below zero: ${p.from} pays ${p.amount}`);
  };

  // Signed submissions. The journal holds only what the chain accepted; each signed message backs one event.
  const subs = audit.journal.flatMap((j) => (j.op === 'submit' ? [j.submission] : []));
  const used = new Set<string>();
  const signedBy = async (m: SignableMessage, signer: string) => verifyMessage(domain, m, signer as Address);
  /** The first unused signed message of this kind for this commitment that passes `ok`; marks it used. */
  async function take<K extends Submission['kind'], M>(kind: K, id: string, pick: (s: Extract<Submission, { kind: K }>) => M, ok: (m: M) => boolean | Promise<boolean>, slot = ''): Promise<M | null> {
    for (const [n, s] of subs.entries()) {
      const tag = `${n}:${slot}`;
      if (s.kind !== kind || lc(idOf(s)) !== lc(id) || used.has(tag)) continue;
      const m = pick(s as Extract<Submission, { kind: K }>);
      try {
        if (await ok(m)) {
          used.add(tag);
          return m;
        }
      } catch {
        // a malformed message verifies as nothing
      }
    }
    return null;
  }

  const ctxs = new Map<string, Ctx>();
  const within = (e: SettlementEvent, what: string) => v['within-terms'].push(`event ${e.seq} (${e.type}${e.commitmentId ? ` on ${short(e.commitmentId)}` : ''}): ${what}`);
  /** Moves the replayed state; an event the state does not allow is outside the terms. */
  const step = (c: Ctx, e: SettlementEvent, from: readonly string[], to: string) => {
    if (!from.includes(c.state)) within(e, `not allowed in state ${c.state} (only from ${from.join(', ')})`);
    c.state = to;
  };
  const notBefore = (e: SettlementEvent, deadline: string | undefined, what: string) => {
    if (!deadline || ms(e.at) < ms(deadline)) within(e, `at ${e.at}, before ${what} ${deadline ?? '(none)'}`);
  };
  const before = (e: SettlementEvent, deadline: string | undefined, what: string) => {
    if (!deadline || ms(e.at) >= ms(deadline)) within(e, `at ${e.at}, not before ${what} ${deadline ?? '(none)'}`);
  };

  for (const [i, e] of audit.log.entries()) {
    const id = e.commitmentId ?? '';
    const actor = lc(String(e.actor ?? ''));
    const actual = Array.isArray(e.payload['postings'])
      ? (e.payload['postings'] as Array<{ from: string; to: string; amount: { token: string; amount: string } }>).map((p) => {
          if (p.amount.token !== token) within(e, `a posting in ${p.amount.token}, not ${token}`);
          return { from: p.from, to: p.to, amount: BigInt(p.amount.amount) };
        })
      : null;
    let expected: Posting[] | null = null;
    /** Postings derived here because the event does not list them (bond.slashed, commitment.settled). */
    let derived: Posting[] | null = null;
    const c = ctxs.get(id);
    if (e.type !== 'commitment.offered' && id && !c) {
      within(e, 'no commitment.offered precedes it');
      if (actual) for (const p of actual) post(p, e);
      continue;
    }
    if (c?.pending && e.type !== 'settlement.released' && e.type !== 'settlement.refunded') {
      within(e, `the ${c.pending.outcome} decision before it moved no money`);
      c.pending = undefined;
    }
    switch (e.type) {
      case 'commitment.offered': {
        const terms = e.payload['terms'] as CommitmentTerms;
        if (ctxs.has(id)) within(e, 'offered twice');
        if (commitmentId(terms) !== id) within(e, 'the commitment id is not the EIP-712 hash of the terms');
        if (!(await verifyTerms(domain, terms, e.payload['sellerSignature'] as Signature, terms.seller))) within(e, `the terms are not signed by the seller ${terms.seller}`);
        const club = audit.genesis.clubs.find((k) => k.id === terms.clubId && k.rulebookHash === terms.rulebookHash);
        if (!club) within(e, `no club ${terms.clubId} with rulebook ${terms.rulebookHash}`);
        for (const [what, t] of [['price', terms.price.token], ['fee', terms.adjudication.fee.token], ['settlement', terms.settlement.token]] as const) {
          if (t !== token) v.conservation.push(`commitment ${short(id)} names ${what} token ${t}; this world has only ${token}`);
        }
        const a = terms.adjudication;
        ctxs.set(id, {
          terms,
          club,
          price: BigInt(terms.price.amount),
          fee: BigInt(a.fee.amount),
          buyer: lc(terms.buyer),
          seller: lc(terms.seller),
          adjudicators: { primary: lc(a.adjudicator), fallback: lc(a.fallbackAdjudicator), appeal: lc(a.appealAdjudicator) },
          state: 'Offered',
          appeal: { state: 'none' },
          owedOverturn: false,
          paid: false,
          slashed: 0n,
        });
        if (actor !== lc(terms.seller)) within(e, `offered by ${actor}, not the seller`);
        break;
      }
      case 'adjudicator.accepted':
        if (actor !== c!.adjudicators.primary) within(e, `accepted by ${actor}, not the primary adjudicator the terms name`);
        step(c!, e, ['Offered'], 'AcceptedByAdjudicator');
        break;
      case 'commitment.agreed': {
        const agrees = await take('agree', id, (s) => s.message, (m) => lc(m.buyer) === c!.buyer && signedBy(m, c!.buyer), 'agree');
        const both = agrees ?? (await take('agree_and_fund', id, (s) => s.agree, (m) => lc(m.buyer) === c!.buyer && signedBy(m, c!.buyer), 'agree'));
        if (!both) within(e, 'no unused agreement signed by the buyer');
        step(c!, e, ['AcceptedByAdjudicator'], 'Agreed');
        break;
      }
      case 'hold.funded': {
        const hold = c!.price + c!.fee;
        const ok = (m: { from: string; value: string; token: string } & SignableMessage) => lc(m.from) === c!.buyer && BigInt(m.value) === hold && m.token === token && signedBy(m, c!.buyer);
        const funding = (await take('fund', id, (s) => s.message, ok, 'funding')) ?? (await take('agree_and_fund', id, (s) => s.funding, ok, 'funding'));
        if (!funding) within(e, `no unused funding authorization for ${hold} signed by the buyer`);
        if (actor !== c!.buyer) within(e, `funded by ${actor}, not the buyer`);
        before(e, c!.terms.timing.fundBy, 'fundBy');
        step(c!, e, ['Agreed'], 'Held');
        expected = [{ from: acct.party(c!.buyer), to: acct.escrow(id), amount: hold }];
        break;
      }
      case 'delivery.submitted': {
        const ok = await take('deliver', id, (s) => s.delivery, (d) => signedBy({ ...d, type: 'Delivery' } as SignableMessage, c!.seller));
        if (!ok) within(e, 'no unused delivery signed by the seller');
        before(e, c!.terms.timing.deliverBy, 'deliverBy');
        step(c!, e, ['Held'], 'Delivered');
        break;
      }
      case 'judgment.decided': {
        const sitting: Role | null = c!.state === 'Delivered' ? 'primary' : c!.state === 'FallbackJudging' ? 'fallback' : c!.state === 'Escalated' ? 'appeal' : null;
        if (!sitting) {
          within(e, `a decision in state ${c!.state}, where no adjudicator sits`);
          break;
        }
        const by = c!.adjudicators[sitting];
        if (actor !== by) within(e, `decided by ${actor}, not the sitting ${sitting} adjudicator ${by}`);
        const deadline = sitting === 'primary' ? c!.terms.timing.judgeBy : sitting === 'fallback' ? c!.terms.timing.fallbackBy : c!.escalationDecideBy;
        before(e, deadline, `the ${sitting} deadline`);
        const m = await take('decide', id, (s) => s.message, (d: Decision) => lc(d.adjudicator) === by && d.role === sitting && signedBy(d, by));
        if (!m) {
          within(e, `no unused ${sitting} decision signed by ${by}`);
          break;
        }
        if (e.payload['outcome'] !== m.outcome) within(e, `the event says ${String(e.payload['outcome'])}; the signed decision says ${m.outcome}`);
        if (e.payload['role'] !== m.role) within(e, `the event says role ${String(e.payload['role'])}; the signed decision says ${m.role}`);
        if (e.payload['recordHash'] !== m.judgmentRecordHash) within(e, 'the event names another judgment record than the signed decision');
        c!.lastRecordHash = m.judgmentRecordHash;
        if (m.outcome === 'escalate') {
          if (sitting === 'appeal') within(e, 'the appeal adjudicator cannot escalate');
          c!.state = 'Escalated';
          c!.escalationDecideBy = plus(e.at, c!.terms.timing.appealDecideSec);
        } else c!.pending = { by, role: sitting, outcome: m.outcome };
        break;
      }
      case 'settlement.released':
      case 'settlement.refunded': {
        const released = e.type === 'settlement.released';
        const via = e.payload['via'];
        if (via === 'early_accept') {
          if (!released) within(e, 'an early accept can only release');
          const ok = await take('early_accept', id, (s) => s.message, (m) => lc(m.buyer) === c!.buyer && signedBy(m, c!.buyer));
          if (!ok) within(e, 'no unused early accept signed by the buyer');
          step(c!, e, ['Delivered'], 'Released');
          c!.via = 'early_accept';
          expected = [
            { from: acct.escrow(id), to: acct.party(c!.seller), amount: c!.price },
            { from: acct.escrow(id), to: acct.party(c!.buyer), amount: c!.fee },
          ];
          c!.paid = true;
        } else if (via === 'default_outcome') {
          if (released) within(e, 'a default outcome only refunds');
          step(c!, e, ['Defaulted'], 'Refunded');
          c!.via = 'default_outcome';
          expected = [{ from: acct.escrow(id), to: acct.party(c!.buyer), amount: c!.price + c!.fee }];
        } else {
          const want = released ? 'accept' : 'reject';
          const p = c!.pending;
          const before = audit.log[i - 1];
          if (!p || p.outcome !== want || p.by !== actor || before?.type !== 'judgment.decided' || before.commitmentId !== id) {
            within(e, `no signed ${want} decision by ${actor} immediately before it, so nothing backs this posting`);
          }
          c!.pending = undefined;
          const role = p?.role ?? 'primary';
          step(c!, e, [role === 'primary' ? 'Delivered' : role === 'fallback' ? 'FallbackJudging' : 'Escalated'], released ? 'Released' : 'Refunded');
          c!.via = role === 'appeal' ? 'escalation' : 'first_instance';
          if (c!.via === 'first_instance') {
            const appealBy = plus(e.at, c!.terms.timing.appealWindowSec);
            c!.appeal = { state: 'none', appealBy, decideBy: plus(appealBy, c!.terms.timing.appealDecideSec) };
            c!.first = { by: actor, outcome: want };
          }
          expected = [
            { from: acct.escrow(id), to: acct.party(released ? c!.seller : c!.buyer), amount: c!.price },
            { from: acct.escrow(id), to: acct.party(actor), amount: c!.fee },
          ];
          if (released) c!.paid = true;
        }
        c!.settledAt = e.at;
        break;
      }
      case 'settlement.reclaimed':
        notBefore(e, c!.terms.timing.deliverBy, 'deliverBy');
        step(c!, e, ['Held'], 'Refunded');
        c!.via = 'reclaim';
        c!.settledAt = e.at;
        expected = [{ from: acct.escrow(id), to: acct.party(c!.buyer), amount: c!.price + c!.fee }];
        break;
      case 'commitment.settled': {
        const payouts = e.payload['payouts'] as Array<{ to: string; amount: { token: string; amount: string } }>;
        const same = (m: { payouts: typeof payouts }) => JSON.stringify(m.payouts.map((p) => [lc(p.to), p.amount.amount])) === JSON.stringify(payouts.map((p) => [lc(p.to), p.amount.amount]));
        const m = await take('mutual_settle', id, (s) => s.message, (x) => same(x) && verifyMutualSettlement(domain, x, c!.buyer as Address, c!.seller as Address));
        if (!m) within(e, 'no unused settlement with these payouts signed by both the buyer and the seller');
        if (m && m.releaseKey !== (e.payload['keyReleased'] === true)) within(e, 'the event releases the key differently from the signed settlement');
        const sum = payouts.reduce((a, p) => a + BigInt(p.amount.amount), 0n);
        if (sum !== c!.price) within(e, `payouts sum to ${sum}, not the price ${c!.price}`);
        const rule = c!.club?.rulebook.mutualSettlement;
        if (rule && !rule.allowed) within(e, 'the club rulebook does not allow settlement by agreement');
        if (rule?.payoutsTo === 'parties' && payouts.some((p) => ![c!.buyer, c!.seller].includes(lc(p.to)))) within(e, 'a payout to someone other than the parties, which the rulebook forbids');
        const share = (c!.fee * BigInt(rule?.adjudicatorFeeShareAfterDeliveryBps ?? 0)) / BPS;
        const sitting = c!.state === 'Escalated' ? c!.adjudicators.appeal : c!.state === 'FallbackJudging' ? c!.adjudicators.fallback : c!.adjudicators.primary;
        step(c!, e, ['Held', 'Delivered', 'FallbackJudging', 'Escalated'], 'Settled');
        c!.settledAt = e.at;
        derived = [
          ...payouts.map((p) => ({ from: acct.escrow(id), to: acct.party(p.to), amount: BigInt(p.amount.amount) })),
          { from: acct.escrow(id), to: acct.party(sitting), amount: share },
          { from: acct.escrow(id), to: acct.party(c!.buyer), amount: c!.fee - share },
        ].filter((p) => p.amount !== 0n);
        c!.paid = m?.releaseKey === true;
        break;
      }
      case 'offer.expired':
        if (c!.state === 'Agreed') notBefore(e, c!.terms.timing.fundBy, 'fundBy');
        else notBefore(e, c!.terms.timing.offerExpiresAt, 'offerExpiresAt');
        step(c!, e, ['Offered', 'AcceptedByAdjudicator', 'Agreed'], 'Expired');
        c!.settledAt = e.at;
        break;
      case 'appeal.filed': {
        const appellant = actor;
        if (![c!.buyer, c!.seller].includes(appellant)) within(e, `appeal filed by ${appellant}, who is not a party`);
        if (!['Released', 'Refunded'].includes(c!.state) || c!.via !== 'first_instance' || c!.appeal.state !== 'none') within(e, `nothing appealable (state ${c!.state}, ${c!.via ?? 'no decision'}, appeal ${c!.appeal.state})`);
        before(e, c!.appeal.appealBy, 'appealBy');
        const rb = c!.club?.rulebook;
        const required = rb ? (c!.price * BigInt(rb.appealBondRateBps) + BPS - 1n) / BPS : 0n;
        const bond = BigInt((e.payload['bond'] as { amount: string }).amount);
        if (bond < required) within(e, `appeal bond ${bond} is below the required ${required}`);
        const fee = BigInt(rb?.appealFee.amount ?? '0');
        const ok = await take('appeal', id, (s) => s.appeal, (a) => lc(a.appellantAddress) === appellant && lc(a.appellant === 'buyer' ? c!.buyer : c!.seller) === appellant && BigInt(a.bond.amount) === bond && signedBy({ ...a, type: 'Appeal' } as SignableMessage, appellant));
        if (!ok) within(e, `no unused appeal with bond ${bond} signed by ${appellant}`);
        expected = [
          { from: acct.party(appellant), to: acct.appealBond(id), amount: bond },
          { from: acct.party(appellant), to: acct.appealFee(id), amount: fee },
        ].filter((p) => p.amount !== 0n);
        c!.appeal = { ...c!.appeal, state: 'open', appellant };
        break;
      }
      case 'appeal.decided': {
        const appealAdj = c!.adjudicators.appeal;
        if (actor !== appealAdj) within(e, `decided by ${actor}, not the appeal adjudicator`);
        if (c!.appeal.state !== 'open' || !c!.first) within(e, `no open appeal against a first decision (appeal ${c!.appeal.state})`);
        before(e, c!.appeal.decideBy, 'appealDecideBy');
        const m = await take('decide', id, (s) => s.message, (d: Decision) => lc(d.adjudicator) === appealAdj && d.role === 'appeal' && d.outcome !== 'escalate' && signedBy(d, appealAdj));
        if (!m) within(e, `no unused appeal decision signed by ${appealAdj}`);
        // The verdict follows from the signed outcome against the first decision, never from the event.
        const verdict = m && c!.first ? (m.outcome === c!.first.outcome ? 'upheld' : 'overturned') : 'upheld';
        if (e.payload['appealState'] !== verdict) within(e, `the event says ${String(e.payload['appealState'])}; the signed appeal decision makes it ${verdict}`);
        if (m && e.payload['recordHash'] !== m.judgmentRecordHash) within(e, 'the event names another judgment record than the signed decision');
        if (m) c!.lastRecordHash = m.judgmentRecordHash;
        const bond = ledger.get(acct.appealBond(id)) ?? 0n;
        const fee = ledger.get(acct.appealFee(id)) ?? 0n;
        expected = [
          { from: acct.appealFee(id), to: acct.party(appealAdj), amount: fee },
          verdict === 'upheld' ? { from: acct.appealBond(id), to: acct.junior(c!.first?.by ?? ''), amount: bond } : { from: acct.appealBond(id), to: acct.party(c!.appeal.appellant ?? ''), amount: bond },
        ].filter((p) => p.amount !== 0n);
        c!.appeal = { ...c!.appeal, state: verdict, closedAt: e.at };
        if (verdict === 'overturned') {
          c!.owedOverturn = true;
          if (c!.first?.outcome === 'reject') c!.paid = true;
        }
        break;
      }
      case 'appeal.expired': {
        const a = c!.appeal;
        if (a.state === 'none') notBefore(e, a.appealBy, 'appealBy');
        else if (a.state === 'open') notBefore(e, a.decideBy, 'appealDecideBy');
        else within(e, `the appeal is already ${a.state}`);
        if (c!.via !== 'first_instance') within(e, 'no first-instance decision to close');
        expected =
          a.state === 'open'
            ? [
                { from: acct.appealBond(id), to: acct.party(a.appellant ?? ''), amount: ledger.get(acct.appealBond(id)) ?? 0n },
                { from: acct.appealFee(id), to: acct.party(a.appellant ?? ''), amount: ledger.get(acct.appealFee(id)) ?? 0n },
              ].filter((p) => p.amount !== 0n)
            : [];
        c!.appeal = { ...a, state: 'expired', closedAt: a.state === 'open' ? a.decideBy! : (a.appealBy ?? e.at) };
        break;
      }
      case 'bond.slashed': {
        const a = lc(String(e.payload['adjudicator']));
        const junior = BigInt((e.payload['junior'] as { amount: string }).amount);
        const senior = BigInt((e.payload['senior'] as { amount: string }).amount);
        const reason = e.payload['reason'];
        let to = '';
        if (reason === 'overturn') {
          if (c!.appeal.state !== 'overturned' || !c!.first) within(e, 'a bond paid out for an overturn that no signed appeal decided');
          if (c!.first && a !== c!.first.by) within(e, `slashes ${a}, not the adjudicator whose decision was overturned`);
          to = c!.first?.outcome === 'accept' ? c!.buyer : c!.seller;
          c!.slashed += junior + senior;
          c!.owedOverturn = false;
          if (c!.slashed > c!.price) within(e, `overturn payouts of ${c!.slashed} exceed the price ${c!.price}`);
        } else if (reason === 'default') {
          if (c!.via !== 'default_outcome') within(e, 'a default payout without the default outcome applied');
          // Mirrors the settlement rule: after an escalation the appeal adjudicator pays; else primary and fallback.
          const liable = c!.defaultedFrom === 'Escalated' ? [c!.adjudicators.appeal] : [c!.adjudicators.primary, c!.adjudicators.fallback];
          if (!liable.includes(a)) within(e, `slashes ${a}, who is not liable for a default from ${c!.defaultedFrom ?? 'nowhere'}`);
          to = c!.seller;
          c!.slashed += junior + senior;
          const cap = (c!.price * BigInt(c!.club?.rulebook.defaultOutcome.judged.sellerCompensationRateBps ?? 0)) / BPS;
          if (c!.slashed > cap) within(e, `default compensation of ${c!.slashed} exceeds the rulebook's ${cap}`);
        } else within(e, `unknown slash reason ${String(reason)}`);
        derived = [
          { from: acct.junior(a), to: acct.party(to), amount: junior },
          { from: acct.senior(a), to: acct.party(to), amount: senior },
        ].filter((p) => p.amount !== 0n);
        break;
      }
      case 'fallback.triggered':
        notBefore(e, c!.terms.timing.judgeBy, 'judgeBy');
        step(c!, e, ['Delivered'], 'FallbackJudging');
        break;
      case 'default.triggered':
        // Only from FallbackJudging after fallbackBy, or from Escalated after its appeal deadline.
        if (c!.state === 'FallbackJudging') notBefore(e, c!.terms.timing.fallbackBy, 'fallbackBy');
        else if (c!.state === 'Escalated') notBefore(e, c!.escalationDecideBy, 'appealDecideBy');
        c!.defaultedFrom = c!.state === 'Escalated' ? 'Escalated' : 'FallbackJudging';
        step(c!, e, ['FallbackJudging', 'Escalated'], 'Defaulted');
        break;
      case 'key.released': {
        const to = lc(String(e.payload['recipient']));
        if (to === c!.buyer && !c!.paid) within(e, 'the content key went to the buyer, who has not paid for the work');
        else if (to !== c!.buyer && !Object.values(c!.adjudicators).includes(to)) within(e, `the content key went to ${to}, who is neither the buyer nor an adjudicator the terms name`);
        break;
      }
      default:
        break;
    }
    if (actual) {
      const want = expected ?? [];
      const a = actual.map(key).sort();
      const w = want.map(key).sort();
      const extra = a.filter((x) => !w.includes(x));
      const missing = w.filter((x) => !a.includes(x));
      if (extra.length || missing.length) within(e, `postings differ from the signed terms${extra.length ? `; not in the terms: ${extra.join(', ')}` : ''}${missing.length ? `; missing: ${missing.join(', ')}` : ''}`);
      for (const p of actual) post(p, e);
    } else if (expected && expected.length) {
      within(e, `moves money (${expected.map(key).join(', ')}) but lists no postings`);
    } else if (derived) {
      for (const p of derived) post(p, e);
    }
  }
  for (const [id, c] of ctxs) {
    if (c.pending) v['within-terms'].push(`commitment ${short(id)}: a signed ${c.pending.outcome} decision moved no money`);
    if (c.owedOverturn) v['within-terms'].push(`commitment ${short(id)}: the appeal overturned the decision but no bond paid the wronged party`);
  }

  // 3. Conservation
  const sum = (xs: Iterable<bigint>) => [...xs].reduce((a, b) => a + b, 0n);
  const chainLedger = new Map(Object.entries(audit.ledger).map(([k, n]) => [k, BigInt(n)]));
  const ledgerTotal = sum(chainLedger.values());
  if (BigInt(audit.minted) !== minted) v.conservation.push(`the chain reports ${audit.minted} minted; genesis plus faucet is ${minted}`);
  if (ledgerTotal !== minted) v.conservation.push(`the ledger sums to ${ledgerTotal} ${token} but ${minted} was minted`);
  for (const k of new Set([...chainLedger.keys(), ...ledger.keys()])) {
    const held = chainLedger.get(k) ?? 0n;
    const replayed = ledger.get(k) ?? 0n;
    if (held !== replayed) v.conservation.push(`account ${k}: the ledger holds ${held}, replayed from the log ${replayed}`);
    if (held < 0n) v.conservation.push(`account ${k} is negative: ${held}`);
  }

  // 4. Terminal or explained (replayed state), and 5. records match
  const now = ms(audit.now);
  const commitments: CommitmentSummary[] = [];
  for (const [id, c] of ctxs) {
    const per = reads.map((r) => ({ op: r.operator, read: r.commitments[id] }));
    const logged = audit.log.filter((e) => e.commitmentId === id).map((e) => e.hash);
    const appealState = c.via === 'first_instance' ? c.appeal.state : 'none';
    for (const { op, read } of per) {
      if (!read?.view) {
        v['records-match'].push(`${op} does not serve commitment ${short(id)}`);
        continue;
      }
      const served = read.events.map((e) => e.hash);
      if (JSON.stringify(served) !== JSON.stringify(logged)) {
        const missing = audit.log.filter((e) => e.commitmentId === id && !served.includes(e.hash)).map((e) => `${e.seq} ${e.type}`);
        v['records-match'].push(`${op} serves ${served.length} events for ${short(id)}; the log has ${logged.length}${missing.length ? ` (missing: ${missing.join(', ')})` : ''}`);
      }
      if (read.view.escrowState !== c.state) v['records-match'].push(`${op} says ${short(id)} is ${read.view.escrowState}; the log replays to ${c.state}`);
      if (read.view.appealState !== appealState) v['records-match'].push(`${op} says ${short(id)} has appeal ${read.view.appealState}; the log replays to ${appealState}`);
      if (c.lastRecordHash && requireRecords) {
        const rec = read.judgment;
        if (!rec) v['records-match'].push(`${op} serves no judgment record for ${short(id)}, which was decided`);
        else if (recordHashOf(rec) !== rec.recordHash) v['records-match'].push(`${op} serves a judgment record for ${short(id)} that does not hash to its recordHash`);
        else if (rec.recordHash !== c.lastRecordHash) v['records-match'].push(`${op} serves judgment record ${short(rec.recordHash)} for ${short(id)}; the last signed decision names ${short(c.lastRecordHash)}`);
      }
    }
    const views = per.flatMap(({ op, read }) => (read?.view ? [{ op, read }] : []));
    for (const o of views.slice(1)) {
      if (String(o.read.view!.finalAt ?? null) !== String(views[0]!.read.view!.finalAt ?? null)) v['records-match'].push(`${o.op} and ${views[0]!.op} disagree on finalAt for ${short(id)}`);
      if (c.lastRecordHash && requireRecords && o.read.judgment && views[0]!.read.judgment && canonicalKeccak(o.read.judgment) !== canonicalKeccak(views[0]!.read.judgment)) {
        v['records-match'].push(`${o.op} and ${views[0]!.op} serve different judgment records for ${short(id)}`);
      }
    }
    const escrow = ledger.get(acct.escrow(id)) ?? 0n;
    const hold = c.price + c.fee;
    if (HOLDING.has(c.state) ? escrow !== hold : escrow !== 0n) {
      v['terminal-or-explained'].push(`commitment ${short(id)} is ${c.state} but escrow holds ${escrow} (expected ${HOLDING.has(c.state) ? hold : 0n})`);
    }
    const appealHeld = (ledger.get(acct.appealBond(id)) ?? 0n) + (ledger.get(acct.appealFee(id)) ?? 0n);
    if (appealHeld !== 0n && appealState !== 'open') v['terminal-or-explained'].push(`commitment ${short(id)} holds ${appealHeld} for an appeal that is ${appealState}`);
    const [status, explanation] = classify(c, now);
    if (status === 'unexplained') v['terminal-or-explained'].push(`commitment ${short(id)}: ${explanation}`);
    commitments.push({ id, buyer: c.buyer, seller: c.seller, price: c.price.toString(), fee: c.fee.toString(), escrowState: c.state, appealState, status, explanation });
  }
  for (const r of reads) {
    for (const [a, n] of Object.entries(r.balances)) {
      const replayed = ledger.get(acct.party(a)) ?? 0n;
      if (BigInt(n) !== replayed) v['records-match'].push(`${r.operator} serves balance ${n} for ${a}; replayed from the log ${replayed}`);
    }
  }

  // Party reports: findings only
  const claims = new Map<string, Array<{ party: string; state: string }>>();
  for (const rep of input.reports ?? []) {
    for (const cl of rep.commitments) {
      const s = commitments.find((x) => lc(x.id) === lc(cl.id));
      if (!s) {
        findings.push(`${rep.party} reports commitment ${cl.id}, which the log does not have`);
        continue;
      }
      const roleAddress = cl.role === 'buyer' ? s.buyer : s.seller;
      if (lc(rep.address ?? '') !== roleAddress) findings.push(`${rep.party} reports being the ${cl.role} of ${short(s.id)}, but the terms name ${roleAddress}`);
      if (cl.finalState !== s.escrowState) findings.push(`${rep.party} reports ${short(s.id)} as ${cl.finalState}; the record says ${s.escrowState}`);
      claims.set(lc(s.id), [...(claims.get(lc(s.id)) ?? []), { party: rep.party, state: cl.finalState }]);
    }
  }
  for (const [id, cs] of claims) {
    for (let x = 0; x < cs.length; x++) {
      for (let y = x + 1; y < cs.length; y++) {
        if (cs[x]!.state !== cs[y]!.state) findings.push(`${cs[x]!.party} and ${cs[y]!.party} disagree on ${short(id)}: ${cs[x]!.state} vs ${cs[y]!.state}`);
      }
    }
  }

  const invariants = (Object.keys(v) as InvariantId[]).map((k) => ({ id: k, title: TITLES[k], ok: v[k].length === 0, violations: v[k] }));
  return {
    kind: 'holdback-sim-check',
    runId: audit.runId,
    ok: invariants.every((x) => x.ok),
    now: audit.now,
    invariants,
    commitments,
    totals: [{ token, minted: minted.toString(), ledger: ledgerTotal.toString() }],
    findings,
  };
}

/** Final, open for a stated reason (who acts next, or which permissionless trigger is due), or unexplained. Deadlines come from the signed terms and the replayed log. */
function classify(c: Ctx, now: number): ['final' | 'open' | 'unexplained', string] {
  const t = c.terms.timing;
  const until = (deadline: string | undefined, waiting: string, trigger: string): ['open', string] =>
    deadline && now < ms(deadline) ? ['open', `${waiting} until ${deadline}`] : ['open', `${deadline ? `passed ${deadline}` : 'past its deadline'}; anyone may trigger ${trigger}`];
  switch (c.state) {
    case 'Settled':
      return ['final', `settled by agreement of both parties at ${c.settledAt}`];
    case 'Expired':
      return ['final', `expired before it was funded, at ${c.settledAt}`];
    case 'Released':
    case 'Refunded': {
      const what = c.state.toLowerCase();
      if (c.via !== 'first_instance') return ['final', `${what} (${c.via}); final at ${c.settledAt}`];
      const a = c.appeal;
      if (a.state === 'none') return now >= ms(a.appealBy!) ? ['final', `${what}; final at ${a.appealBy}`] : ['open', `${what}; a party may appeal until ${a.appealBy}`];
      if (a.state === 'open') return now >= ms(a.decideBy!) ? ['final', `${what}; the appeal went undecided, final at ${a.decideBy}`] : until(a.decideBy, `${what}; the appeal adjudicator decides`, 'appeal-expiry');
      return ['final', `${what}; appeal ${a.state}, final at ${a.closedAt}`];
    }
    case 'Offered':
    case 'AcceptedByAdjudicator':
      return until(t.offerExpiresAt, 'waiting for the buyer to agree and fund', 'expire-offer');
    case 'Agreed':
      return until(t.fundBy, 'waiting for the buyer to fund', 'expire-offer');
    case 'Held':
      return until(t.deliverBy, 'waiting for the seller to deliver', 'reclaim');
    case 'Delivered':
      return until(t.judgeBy, 'waiting for the primary adjudicator', 'fallback');
    case 'FallbackJudging':
      return until(t.fallbackBy, 'waiting for the fallback adjudicator', 'default');
    case 'Escalated':
      return until(c.escalationDecideBy, 'waiting for the appeal adjudicator', 'default');
    case 'Defaulted':
      return ['open', 'defaulted; anyone may trigger apply-default'];
    default:
      return ['unexplained', `state ${c.state} has no rule that ends it`];
  }
}

function idOf(s: Submission): string {
  switch (s.kind) {
    case 'offer':
      return s.commitment.id;
    case 'agree_and_fund':
      return s.agree.commitmentId;
    case 'deliver':
      return s.delivery.commitmentId;
    case 'appeal':
      return s.appeal.commitmentId;
    case 'trigger':
      return s.commitmentId;
    default:
      return s.message.commitmentId;
  }
}

const short = (h: string) => (h.length > 14 ? `${h.slice(0, 10)}…` : h);
