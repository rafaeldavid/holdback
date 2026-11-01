// sim:check: the invariants of one simulated run, computed from the settlement layer's own record and the
// operators' public answers. Nothing here trusts a party's report or a SimChain helper: it re-verifies the
// hash chain and every signature, re-derives each posting from the signed terms and the club rulebook,
// replays the postings from genesis into its own ledger, and compares. Party reports only add findings.
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
  'log-integrity': 'The settlement log is one unbroken hash chain',
  conservation: 'Funds are conserved per token: the ledger equals genesis plus faucet, account by account, as replayed from the log',
  'within-terms': 'Nothing moved outside the signed terms: every posting matches a signed decision, settlement, appeal, funding or a due trigger',
  'terminal-or-explained': 'Every commitment is final, or open for a stated reason, and its held money matches its state',
  'records-match': 'Both parties read the same record: every operator serves the log, state, judgment and balances identically',
};

const ZERO_HASH = `0x${'00'.repeat(32)}` as Hex32;
const BPS = 10_000n;
const lc = (a: string) => a.toLowerCase();
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

interface Ctx {
  terms: CommitmentTerms;
  club: Club | undefined;
  price: bigint;
  fee: bigint;
  buyer: string;
  seller: string;
  adjudicators: { primary: string; fallback: string; appeal: string };
  /** The adjudicator whose decision first moved the escrow, and which way. */
  first?: { by: string; outcome: 'Released' | 'Refunded' };
  delivered: boolean;
  fallback: boolean;
  escalated: boolean;
  defaulted: boolean;
  defaultApplied: boolean;
  appeal?: { appellant: string; open: boolean; overturned: boolean };
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

  // ---- 1. log integrity ------------------------------------------------------------------------------
  let prev: string = ZERO_HASH;
  for (const [i, e] of audit.log.entries()) {
    const { hash, ...body } = e;
    if (e.seq !== i) v['log-integrity'].push(`event ${i} carries seq ${e.seq}`);
    if (e.prevHash !== prev) v['log-integrity'].push(`event ${e.seq} (${e.type}) does not link to the event before it`);
    if (canonicalKeccak(body) !== hash) v['log-integrity'].push(`event ${e.seq} (${e.type}) does not hash to its own hash: it was edited after it was written`);
    prev = hash;
  }

  // ---- 2. replay from genesis ------------------------------------------------------------------------
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

  // Signed submissions, by commitment. The journal holds only what the chain accepted.
  const subs = audit.journal.flatMap((j) => (j.op === 'submit' ? [j.submission] : []));
  const of = <K extends Submission['kind']>(kind: K, id: string) =>
    subs.filter((s): s is Extract<Submission, { kind: K }> => s.kind === kind && lc(idOf(s)) === lc(id));
  const signedBy = async (m: SignableMessage, signer: string) => verifyMessage(domain, m, signer as Address);

  const ctxs = new Map<string, Ctx>();
  const within = (e: SettlementEvent, what: string) => v['within-terms'].push(`event ${e.seq} (${e.type}${e.commitmentId ? ` on ${short(e.commitmentId)}` : ''}): ${what}`);

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
    switch (e.type) {
      case 'commitment.offered': {
        const terms = e.payload['terms'] as CommitmentTerms;
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
          delivered: false,
          fallback: false,
          escalated: false,
          defaulted: false,
          defaultApplied: false,
          paid: false,
          slashed: 0n,
        });
        if (actor !== lc(terms.seller)) within(e, `offered by ${actor}, not the seller`);
        break;
      }
      case 'adjudicator.accepted':
        if (actor !== c!.adjudicators.primary) within(e, `accepted by ${actor}, not the primary adjudicator the terms name`);
        break;
      case 'commitment.agreed': {
        const ok = await anyAsync(of('agree', id).map((s) => s.message).concat(of('agree_and_fund', id).map((s) => s.agree)), (m) => lc(m.buyer) === c!.buyer && signedBy(m, c!.buyer));
        if (!ok) within(e, 'no agreement signed by the buyer');
        break;
      }
      case 'hold.funded': {
        const hold = c!.price + c!.fee;
        const funding = of('fund', id).map((s) => s.message).concat(of('agree_and_fund', id).map((s) => s.funding));
        const ok = await anyAsync(funding, (m) => lc(m.from) === c!.buyer && BigInt(m.value) === hold && m.token === token && signedBy(m, c!.buyer));
        if (!ok) within(e, `no funding authorization for ${hold} signed by the buyer`);
        if (actor !== c!.buyer) within(e, `funded by ${actor}, not the buyer`);
        expected = [{ from: acct.party(c!.buyer), to: acct.escrow(id), amount: hold }];
        break;
      }
      case 'delivery.submitted': {
        const ok = await anyAsync(of('deliver', id), (s) => signedBy({ ...s.delivery, type: 'Delivery' } as SignableMessage, c!.seller));
        if (!ok) within(e, 'no delivery signed by the seller');
        c!.delivered = true;
        break;
      }
      case 'judgment.decided': {
        const outcome = String(e.payload['outcome']);
        const adjs = Object.values(c!.adjudicators);
        if (!adjs.includes(actor)) within(e, `decided by ${actor}, who is not an adjudicator the terms name`);
        const ok = await anyAsync(of('decide', id), (s) => lc(s.message.adjudicator) === actor && s.message.outcome === outcome && signedBy(s.message, actor));
        if (!ok) within(e, `no ${outcome} decision signed by ${actor}`);
        if (outcome === 'escalate') c!.escalated = true;
        c!.lastRecordHash = String(e.payload['recordHash']);
        break;
      }
      case 'settlement.released':
      case 'settlement.refunded': {
        const released = e.type === 'settlement.released';
        const via = e.payload['via'];
        if (via === 'early_accept') {
          if (!released) within(e, 'an early accept can only release');
          const ok = await anyAsync(of('early_accept', id), (s) => lc(s.message.buyer) === c!.buyer && signedBy(s.message, c!.buyer));
          if (!ok) within(e, 'no early accept signed by the buyer');
          expected = [
            { from: acct.escrow(id), to: acct.party(c!.seller), amount: c!.price },
            { from: acct.escrow(id), to: acct.party(c!.buyer), amount: c!.fee },
          ];
          c!.paid = true;
        } else if (via === 'default_outcome') {
          if (released || !c!.defaulted) within(e, 'a default outcome without a default.triggered before it');
          expected = [{ from: acct.escrow(id), to: acct.party(c!.buyer), amount: c!.price + c!.fee }];
          c!.defaultApplied = true;
        } else {
          const before = audit.log[i - 1];
          const want = released ? 'accept' : 'reject';
          if (!before || before.type !== 'judgment.decided' || before.commitmentId !== id || lc(String(before.actor)) !== actor || before.payload['outcome'] !== want) {
            within(e, `no judgment.decided (${want}) by ${actor} immediately before it, so no signed decision backs this posting`);
          }
          expected = [
            { from: acct.escrow(id), to: acct.party(released ? c!.seller : c!.buyer), amount: c!.price },
            { from: acct.escrow(id), to: acct.party(actor), amount: c!.fee },
          ];
          c!.first = { by: actor, outcome: released ? 'Released' : 'Refunded' };
          if (released) c!.paid = true;
        }
        break;
      }
      case 'settlement.reclaimed':
        if (Date.parse(e.at) < Date.parse(c!.terms.timing.deliverBy)) within(e, `reclaimed at ${e.at}, before deliverBy ${c!.terms.timing.deliverBy}`);
        if (c!.delivered) within(e, 'reclaimed after a delivery');
        expected = [{ from: acct.escrow(id), to: acct.party(c!.buyer), amount: c!.price + c!.fee }];
        break;
      case 'commitment.settled': {
        const payouts = e.payload['payouts'] as Array<{ to: string; amount: { token: string; amount: string } }>;
        const same = (m: { payouts: typeof payouts }) => JSON.stringify(m.payouts.map((p) => [lc(p.to), p.amount.amount])) === JSON.stringify(payouts.map((p) => [lc(p.to), p.amount.amount]));
        const ok = await anyAsync(of('mutual_settle', id), (s) => same(s.message) && verifyMutualSettlement(domain, s.message, c!.buyer as Address, c!.seller as Address));
        if (!ok) within(e, 'no settlement with these payouts signed by both the buyer and the seller');
        const sum = payouts.reduce((a, p) => a + BigInt(p.amount.amount), 0n);
        if (sum !== c!.price) within(e, `payouts sum to ${sum}, not the price ${c!.price}`);
        const rule = c!.club?.rulebook.mutualSettlement;
        if (rule && !rule.allowed) within(e, 'the club rulebook does not allow settlement by agreement');
        if (rule?.payoutsTo === 'parties' && payouts.some((p) => ![c!.buyer, c!.seller].includes(lc(p.to)))) within(e, 'a payout to someone other than the parties, which the rulebook forbids');
        const share = (c!.fee * BigInt(rule?.adjudicatorFeeShareAfterDeliveryBps ?? 0)) / BPS;
        const sitting = c!.escalated ? c!.adjudicators.appeal : c!.fallback ? c!.adjudicators.fallback : c!.adjudicators.primary;
        derived = [
          ...payouts.map((p) => ({ from: acct.escrow(id), to: acct.party(p.to), amount: BigInt(p.amount.amount) })),
          { from: acct.escrow(id), to: acct.party(sitting), amount: share },
          { from: acct.escrow(id), to: acct.party(c!.buyer), amount: c!.fee - share },
        ].filter((p) => p.amount !== 0n);
        c!.paid = e.payload['keyReleased'] === true;
        break;
      }
      case 'appeal.filed': {
        const appellant = actor;
        if (![c!.buyer, c!.seller].includes(appellant)) within(e, `appeal filed by ${appellant}, who is not a party`);
        const rb = c!.club?.rulebook;
        const required = rb ? (c!.price * BigInt(rb.appealBondRateBps) + BPS - 1n) / BPS : 0n;
        const bond = BigInt((e.payload['bond'] as { amount: string }).amount);
        if (bond < required) within(e, `appeal bond ${bond} is below the required ${required}`);
        const fee = BigInt(rb?.appealFee.amount ?? '0');
        const ok = await anyAsync(of('appeal', id), (s) => lc(s.appeal.appellantAddress) === appellant && BigInt(s.appeal.bond.amount) === bond && signedBy({ ...s.appeal, type: 'Appeal' } as SignableMessage, appellant));
        if (!ok) within(e, `no appeal with bond ${bond} signed by ${appellant}`);
        expected = [
          { from: acct.party(appellant), to: acct.appealBond(id), amount: bond },
          { from: acct.party(appellant), to: acct.appealFee(id), amount: fee },
        ].filter((p) => p.amount !== 0n);
        c!.appeal = { appellant, open: true, overturned: false };
        break;
      }
      case 'appeal.decided': {
        const verdict = String(e.payload['appealState']);
        if (actor !== c!.adjudicators.appeal) within(e, `decided by ${actor}, not the appeal adjudicator`);
        const ok = await anyAsync(of('decide', id), (s) => lc(s.message.adjudicator) === actor && s.message.outcome === e.payload['outcome'] && signedBy(s.message, actor));
        if (!ok) within(e, `no appeal decision signed by ${actor}`);
        if (!c!.appeal?.open || !c!.first) within(e, 'no open appeal against a first decision');
        const bond = ledger.get(acct.appealBond(id)) ?? 0n;
        const fee = ledger.get(acct.appealFee(id)) ?? 0n;
        expected = [
          { from: acct.appealFee(id), to: acct.party(c!.adjudicators.appeal), amount: fee },
          verdict === 'upheld' ? { from: acct.appealBond(id), to: acct.junior(c!.first?.by ?? ''), amount: bond } : { from: acct.appealBond(id), to: acct.party(c!.appeal?.appellant ?? ''), amount: bond },
        ].filter((p) => p.amount !== 0n);
        if (c!.appeal) c!.appeal = { ...c!.appeal, open: false, overturned: verdict === 'overturned' };
        if (verdict === 'overturned' && c!.first?.outcome === 'Refunded') c!.paid = true;
        c!.lastRecordHash = String(e.payload['recordHash']);
        break;
      }
      case 'appeal.expired': {
        const open = c!.appeal?.open;
        expected = open
          ? [
              { from: acct.appealBond(id), to: acct.party(c!.appeal!.appellant), amount: ledger.get(acct.appealBond(id)) ?? 0n },
              { from: acct.appealFee(id), to: acct.party(c!.appeal!.appellant), amount: ledger.get(acct.appealFee(id)) ?? 0n },
            ].filter((p) => p.amount !== 0n)
          : [];
        if (c!.appeal) c!.appeal.open = false;
        break;
      }
      case 'bond.slashed': {
        const a = lc(String(e.payload['adjudicator']));
        const junior = BigInt((e.payload['junior'] as { amount: string }).amount);
        const senior = BigInt((e.payload['senior'] as { amount: string }).amount);
        const reason = e.payload['reason'];
        let to = '';
        if (reason === 'overturn') {
          if (!c!.appeal?.overturned || !c!.first) within(e, 'a bond paid out for an overturn that no appeal decided');
          if (c!.first && a !== c!.first.by) within(e, `slashes ${a}, not the adjudicator whose decision was overturned`);
          to = c!.first?.outcome === 'Released' ? c!.buyer : c!.seller;
          c!.slashed += junior + senior;
          if (c!.slashed > c!.price) within(e, `overturn payouts of ${c!.slashed} exceed the price ${c!.price}`);
        } else if (reason === 'default') {
          if (!c!.defaultApplied) within(e, 'a default payout without the default outcome applied');
          if (!Object.values(c!.adjudicators).includes(a)) within(e, `slashes ${a}, not an adjudicator the terms name`);
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
        if (Date.parse(e.at) < Date.parse(c!.terms.timing.judgeBy)) within(e, `fallback triggered at ${e.at}, before judgeBy`);
        c!.fallback = true;
        break;
      case 'default.triggered':
        c!.defaulted = true;
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

  // ---- 3. conservation -------------------------------------------------------------------------------
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

  // ---- 4. terminal or explained, and 5. records match ------------------------------------------------
  const now = Date.parse(audit.now);
  const commitments: CommitmentSummary[] = [];
  for (const [id, c] of ctxs) {
    const per = reads.map((r) => ({ op: r.operator, read: r.commitments[id] }));
    const logged = audit.log.filter((e) => e.commitmentId === id).map((e) => e.hash);
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
      if (c.lastRecordHash && requireRecords) {
        const rec = read.judgment;
        if (!rec) v['records-match'].push(`${op} serves no judgment record for ${short(id)}, which was decided`);
        else if (recordHashOf(rec) !== rec.recordHash) v['records-match'].push(`${op} serves a judgment record for ${short(id)} that does not hash to its recordHash`);
        else if (rec.recordHash !== c.lastRecordHash) v['records-match'].push(`${op} serves judgment record ${short(rec.recordHash)} for ${short(id)}; the last decision signed ${short(c.lastRecordHash)}`);
      }
    }
    const views = per.flatMap(({ op, read }) => (read?.view ? [{ op, view: read.view }] : []));
    const first = views[0];
    for (const o of views.slice(1)) {
      for (const f of ['escrowState', 'appealState', 'finalAt'] as const) {
        if (String(o.view[f] ?? null) !== String(first!.view[f] ?? null)) v['records-match'].push(`${o.op} says ${f} ${String(o.view[f])} for ${short(id)}; ${first!.op} says ${String(first!.view[f])}`);
      }
      if (c.lastRecordHash && requireRecords) {
        const x = per.find((p) => p.op === o.op)?.read?.judgment;
        const y = per.find((p) => p.op === first!.op)?.read?.judgment;
        if (x && y && canonicalKeccak(x) !== canonicalKeccak(y)) v['records-match'].push(`${o.op} and ${first!.op} serve different judgment records for ${short(id)}`);
      }
    }
    const summary: CommitmentSummary = { id, buyer: c.buyer, seller: c.seller, price: c.price.toString(), fee: c.fee.toString(), escrowState: '?', appealState: '?', status: 'unexplained', explanation: '' };
    commitments.push(summary);
    if (!first) {
      v['terminal-or-explained'].push(`commitment ${short(id)}: no operator serves its state`);
      summary.explanation = 'no operator serves its state';
      continue;
    }
    const view = first.view;
    summary.escrowState = view.escrowState;
    summary.appealState = view.appealState;
    const escrow = ledger.get(acct.escrow(id)) ?? 0n;
    const hold = c.price + c.fee;
    if (HOLDING.has(view.escrowState) ? escrow !== hold : escrow !== 0n) {
      v['terminal-or-explained'].push(`commitment ${short(id)} is ${view.escrowState} but escrow holds ${escrow} (expected ${HOLDING.has(view.escrowState) ? hold : 0n})`);
    }
    const appealHeld = (ledger.get(acct.appealBond(id)) ?? 0n) + (ledger.get(acct.appealFee(id)) ?? 0n);
    if (appealHeld !== 0n && view.appealState !== 'open') v['terminal-or-explained'].push(`commitment ${short(id)} holds ${appealHeld} for an appeal that is ${view.appealState}`);
    const [status, explanation] = classify(view.escrowState, view.appealState, view.deadlines, view.finalAt ?? null, now);
    summary.status = status;
    summary.explanation = explanation;
    if (status === 'unexplained') v['terminal-or-explained'].push(`commitment ${short(id)}: ${explanation}`);
  }
  for (const r of reads) {
    for (const [a, n] of Object.entries(r.balances)) {
      const replayed = ledger.get(acct.party(a)) ?? 0n;
      if (BigInt(n) !== replayed) v['records-match'].push(`${r.operator} serves balance ${n} for ${a}; replayed from the log ${replayed}`);
    }
  }

  // ---- party reports: findings only ------------------------------------------------------------------
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

/** Final, open for a stated reason (who acts next, or which permissionless trigger is due), or unexplained. */
export function classify(state: string, appealState: string, d: Record<string, string>, finalAt: string | null, now: number): ['final' | 'open' | 'unexplained', string] {
  const until = (deadline: string | undefined, waiting: string, trigger: string): ['open', string] =>
    deadline && now < Date.parse(deadline) ? ['open', `${waiting} until ${deadline}`] : ['open', `${deadline ? `passed ${deadline}` : 'past its deadline'}; anyone may trigger ${trigger}`];
  switch (state) {
    case 'Settled':
      return ['final', 'settled by agreement of both parties'];
    case 'Expired':
      return ['final', 'expired before it was funded'];
    case 'Released':
    case 'Refunded':
      if (finalAt && Date.parse(finalAt) <= now) return ['final', `${state.toLowerCase()}; final at ${finalAt}`];
      if (appealState === 'open') return until(d['appealDecideBy'], `${state.toLowerCase()}; the appeal adjudicator decides`, 'appeal-expiry');
      return ['open', `${state.toLowerCase()}; a party may appeal until ${d['appealBy'] ?? '?'}`];
    case 'Offered':
    case 'AcceptedByAdjudicator':
      return until(d['offerExpiresAt'], 'waiting for the buyer to agree and fund', 'expire-offer');
    case 'Agreed':
      return until(d['fundBy'], 'waiting for the buyer to fund', 'expire-offer');
    case 'Held':
      return until(d['deliverBy'], 'waiting for the seller to deliver', 'reclaim');
    case 'Delivered':
      return until(d['judgeBy'], 'waiting for the primary adjudicator', 'fallback');
    case 'FallbackJudging':
      return until(d['fallbackBy'], 'waiting for the fallback adjudicator', 'default');
    case 'Escalated':
      return until(d['appealDecideBy'], 'waiting for the appeal adjudicator', 'default');
    case 'Defaulted':
      return ['open', 'defaulted; anyone may trigger apply-default'];
    default:
      return ['unexplained', `state ${state} has no rule that ends it`];
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

async function anyAsync<T>(xs: readonly T[], f: (x: T) => boolean | Promise<boolean>): Promise<boolean> {
  for (const x of xs) {
    try {
      if (await f(x)) return true;
    } catch {
      // a malformed message verifies as nothing
    }
  }
  return false;
}

const short = (h: string) => (h.length > 14 ? `${h.slice(0, 10)}…` : h);
