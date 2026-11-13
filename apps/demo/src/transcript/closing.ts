// The closing section (docs/demo.md, "Closing slide"): finality per mode, what remains centralized
// (four of docs/neutrality.md §Residual control points, condensed) and what an AI lab could add.

export interface Closing {
  finality: string[];
  /** Says which residuals are shown and where the full list is. */
  residualsIntro: string;
  residuals: { n: number; title: string; line: string }[];
  asks: string[];
}

export function closing(): Closing {
  return {
    finality: [
      'Guaranteed mode (the only mode in this demo): the payee is final at the posting that pays it, at the decision. The commitment is final when the 300 s appeal window passes with no appeal, or at the appeal decision. An overturn pays from the adjudicator\'s bond, never from escrow.',
      'Escalation decision, mutual settlement, early accept, reclaim and default: final at the step; none is appealable.',
      'This demo settles on SimChain, which keeps the full protocol. The phase-one contracts on Sepolia have no party appeal and no bonds: there the first decision by the primary or the fallback adjudicator is final at once, and an escalation still goes to the appeal adjudicator (ADR-0031).',
      'Protocol finality is not legal finality: courts can still compel the real-world parties.',
    ],
    residualsIntro: 'Four of the 12 residual control points in docs/neutrality.md, the ones an AI lab is likely to ask about first; the other eight are listed there.',
    residuals: [
      { n: 3, title: 'Collusion', line: 'An adjudicator colluding with one party is bounded by commit-reveal panels, cross-family judges, appeals and the bond, not eliminated.' },
      { n: 5, title: 'Legal process', line: 'The design limits what any one party can do technically; it does not place anyone beyond the law. Both parties hold the same signed record to take to a court.' },
      { n: 6, title: 'Adjudicator plaintext access', line: 'An adjudicator that decrypts the work to judge it can copy it. Bonds and appeals do not reach this.' },
      { n: 8, title: 'Self-reported model identity', line: 'The record names the models that judged, but no provider signs responses, so a cheaper model could run under a pinned name.' },
    ],
    asks: [
      'Response attestation for judges: today a commitment proves which models and prompt had to judge, but not that the named model answered (residual 8). Provider-signed responses would close that gap.',
      'A hold primitive on API credit, offered as one rail among many, so agents can commit compute the way they commit money here.',
      'Model version disclosure for adjudication: stable, pinned model IDs with published retirement dates, so a panel named in a signed commitment still exists when it is called.',
    ],
  };
}
