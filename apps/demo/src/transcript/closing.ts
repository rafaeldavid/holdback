// The closing section (docs/demo.md, "Closing slide"): finality per mode, what remains centralized
// (docs/neutrality.md §Residual control points, condensed) and what an AI lab could add.

export interface Closing {
  finality: string[];
  residuals: { n: number; title: string; line: string }[];
  asks: string[];
}

export function closing(): Closing {
  return {
    finality: [
      'Guaranteed mode (the only mode in this demo): the payee is final at the posting that pays it, at the decision. The commitment is final when the 300 s appeal window passes with no appeal, or at the appeal decision. An overturn pays from the adjudicator\'s bond, never from escrow.',
      'Escalation decision, mutual settlement, early accept, reclaim and default: final at the step; none is appealable.',
      'Protocol finality is not legal finality: courts can still compel the real-world parties.',
    ],
    residuals: [
      { n: 1, title: 'Stablecoin issuer freezes', line: 'An issuer can blacklist addresses. The escrow accepts any ERC-20; the demo uses a test token.' },
      { n: 2, title: 'L2 sequencer censorship', line: 'A sequencer can delay transactions. Mitigated by forced inclusion through L1 and deadlines that leave time for it.' },
      { n: 3, title: 'Collusion', line: 'An adjudicator colluding with one party is bounded by commit-reveal panels, cross-family judges, appeals and the bond, not eliminated.' },
      { n: 4, title: 'Liveness of everyone at once', line: 'If every operator, adjudicator and both agents vanish, funds stay held until one live party triggers expiry.' },
      { n: 5, title: 'Legal process', line: 'The design limits what any one party can do technically; it does not place anyone beyond the law.' },
      { n: 6, title: 'Adjudicator plaintext access', line: 'An adjudicator that decrypts the work to judge it can copy it. Bonds and appeals do not reach this.' },
      { n: 7, title: 'Appeal finality', line: 'The appeal adjudicator\'s decision is final within a commitment, bounded by its own bond and a larger panel.' },
      { n: 8, title: 'Self-reported model identity', line: 'The record names the models that judged, but no provider signs responses, so a cheaper model could run under a pinned name.' },
      { n: 9, title: 'The public skeleton', line: 'Addresses, amounts, deadlines, adjudicators and outcomes are public at every disclosure level; this demo is fully public.' },
      { n: 10, title: 'Beacon unavailable for a whole window', line: 'With no provable beacon round before a deadline, the fallback or default outcome applies.' },
      { n: 11, title: 'Funding linkability', line: 'A funding transfer can link a commitment to the principal\'s treasury.' },
      { n: 12, title: 'No principal recourse after the agent signs', line: 'The mandate is the principal\'s standing approval; nothing reverses a final in-mandate commitment.' },
    ],
    asks: [
      'Response attestation for judges: today a commitment proves which models and prompt had to judge, but not that the named model answered (residual 8). Provider-signed responses would close that gap.',
      'A hold primitive on API credit, offered as one rail among many, so agents can commit compute the way they commit money here.',
      'Model version disclosure for adjudication: stable, pinned model IDs with published retirement dates, so a panel named in a signed commitment still exists when it is called.',
    ],
  };
}
