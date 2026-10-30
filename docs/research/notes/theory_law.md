# Theoretical and Legal Foundations for Commitments Made by Software Agents (status as of late October 2026)

Labels used below: **[THEORY]** academic theory; **[PRIMARY LAW]** statute, treaty, model law or regulation text; **[CASE]** judicial or tribunal decision; **[OFFICIAL COMMENTARY]** guide to enactment, Restatement comment, or official law-reform paper; **[COMMENTARY]** secondary scholarship, law-firm or press analysis. Quotes are verbatim and under 15 words, with at most one per source. "Verified" means the bibliographic data was checked against the fetched page this session.

## 1. Commitment semantics in multi-agent systems (MAS)

### Takeaway
The MAS literature has two views of commitment. In the mentalistic view (Cohen & Levesque, Bratman), commitment is an agent's internal persistence of intention. In the social view (Castelfranchi, Jennings, Singh, Fornara & Colombetti), a commitment is a public, directed relationship from a debtor to a creditor. It sits in an institutional context, has an explicit lifecycle (create, detach, discharge, violate, cancel, release, delegate, assign), and can be checked from the message record without access to anyone's mental states. For agents built on large language models, whose internal states can't be inspected, only the social view can be audited, and it lines up closely with how contract law works.

### Cited Findings

**Singh, Munindar P. "An Ontology for Commitments in Multiagent Systems: Toward a Unification of Normative Concepts." *Artificial Intelligence and Law* 7 (1999): 97–113.** [THEORY; verified: journal, volume, pages, Kluwer]
- Argument: a social commitment is a four-place relation C(x, y, G, p). x is the debtor, y the creditor (usually but not always the beneficiary), G the context group whose norms govern the commitment and settle disputes, and p the discharge condition, which is evaluated objectively in the world. The operations on commitments are create, discharge, cancel (subject to cancellation clauses and group policy), release (frees the debtor without implying success or failure), delegate (moves the debtor role) and assign (moves the creditor role). Norms are modelled as metacommitments, i.e. higher-order commitments about commitments, and lower-level commitments arise inside the context they set. — [Singh 1999 PDF](https://www.csc2.ncsu.edu/faculty/mpsingh/papers/mas/ai+law-final.pdf)
- Quote (p. 97): "Social commitments are crucial to the science of multiagent systems." — [Singh 1999 PDF](https://www.csc2.ncsu.edu/faculty/mpsingh/papers/mas/ai+law-final.pdf)
- Contribution to the frame: Singh supplies the debtor/creditor/context structure and the operations that correspond to legal concepts (assignment, delegation, release). The context group G is the conceptual slot that governing law or a protocol's governance fills.

**Singh, Munindar P. "Commitments in Multiagent Systems: Some History, Some Confusions, Some Controversies, Some Prospects." Chapter 31 in a festschrift honoring Cristiano Castelfranchi, 591–615.** [THEORY; chapter number and pages verified from the PDF; volume title, editors, publisher and year not shown in the fetched text]
- Argument: commitments are conditional, C(debtor, creditor, antecedent, consequent), and unconditional when the antecedent is already true. They are public and shared, not private mental states. The organizational context (for example, a marketplace) supplies the normative backdrop and penalties. The debtor can create a commitment unilaterally; the creditor need not accept. A commitment *detaches* when its antecedent becomes true and *discharges* when its consequent becomes true, and these can happen in either order. A detached commitment that is never discharged is a *violation*. The debtor can cancel, the creditor can release, and either can delegate or assign. Singh distinguishes practical commitments (about actions) from dialectical ones (about claims). In business protocols, commitments give message types such as *offer* and *accept* a declarative meaning. An agent complies with a protocol if no enactment leaves it as the debtor of a detached, undischarged commitment. Compiling commitments into state machines gives "commitment machines." Commitments can't be reduced to mutual belief, because mutual belief generally can't be established under asynchronous communication. — [Singh chapter PDF](https://www.csc2.ncsu.edu/faculty/mpsingh/papers/mas/Commitments-for-MAS.pdf)
- Quote (p. 601): "Commitments are not mutual beliefs." — [Singh chapter PDF](https://www.csc2.ncsu.edu/faculty/mpsingh/papers/mas/Commitments-for-MAS.pdf)
- Contribution: a compliance criterion that can be stated purely in terms of the interaction record. This fits agent protocols over asynchronous networks.

**Castelfranchi, Cristiano. "Commitment: From Individual Intentions to Groups and Organizations." In *Proceedings of the First International Conference on Multi-Agent Systems (ICMAS-95)*, 41–49. 1995.** [THEORY; venue and pages verified via the IFAAMAS award announcement]
- In 2013 IFAAMAS gave Castelfranchi its Influential Paper Award, citing this paper together with "Modelling Social Action for AI Agents," *Artificial Intelligence* 103, nos. 1–2 (August 1998): 157–182. — [IFAAMAS award announcement (agents mailing list)](https://lists.cs.umbc.edu/pipermail/agents/Week-of-Mon-20130408/002795.html)
- Title discrepancy: the award notice has "Commitment:" (singular); the brief and many citations have "Commitments:". Check against the ICMAS-95 proceedings (AAAI Press) before printing. Page range is 41–49 in the award notice; some citations give 41–48.

**Jennings, N. R. "Commitments and Conventions: The Foundation of Coordination in Multi-Agent Systems." *Knowledge Engineering Review* 8, no. 3 (1993): 223–250. https://doi.org/10.1017/S0269888900000205.** [THEORY; verified]
- Argument: the central hypothesis is that all coordination in multi-agent systems rests on *commitments* (pledges to a course of action) and *conventions* (ways of monitoring commitments as circumstances change, i.e. when to reconsider or drop a commitment). Jennings models agent communities as distributed goal search, proposes a unifying framework, and recasts several prominent coordination techniques in its terms. — [Imperial College Spiral record](https://spiral.imperial.ac.uk/entities/publication/2eb83c8e-d8be-447a-b9f9-1362e647e5c5)
- Quote (abstract, p. 223): commitments are "pledges to undertake a specific course of action". — [Imperial College Spiral record](https://spiral.imperial.ac.uk/entities/publication/2eb83c8e-d8be-447a-b9f9-1362e647e5c5)
- Contribution: conventions function as rules for de-commitment, a forerunner of cancellation and release clauses and of legal doctrines such as frustration and change of circumstances.

**Fornara, Nicoletta, and Marco Colombetti. "Operational Specification of a Commitment-Based Agent Communication Language." In *Proceedings of the First International Joint Conference on Autonomous Agents and Multiagent Systems (AAMAS '02), Part 2*, edited by Cristiano Castelfranchi and W. Lewis Johnson, 535–542. New York: ACM Press, 2002.** [THEORY; verified from the authors' PDF and the USI record]
- Argument: an agent communication language (ACL) gets operational semantics by treating commitments as objects. Each has a debtor, creditor, content and optional condition, and moves through the states empty, precommitment, conditional, active, fulfilled, violated and cancelled. Speech acts are operations on these objects: assertions and promises create commitments; requests create precommitments that the hearer accepts or rejects; a proposal is a conditional request combined with a conditional promise. Content is a temporal proposition, and update rules change commitment states automatically when propositions become true or false. The paper works through a negotiation protocol as an example. Its case against mentalistic (belief-desire-intention) ACL semantics is that those semantics break down among competitive, heterogeneous agents. — [Fornara & Colombetti PDF](https://people.lu.usi.ch/fornaran/papers/AAMAS02_fornara_colombetti.pdf)
- Quote (p. 535): "It is therefore necessary to consider social, objective consequences". — [Fornara & Colombetti PDF](https://people.lu.usi.ch/fornaran/papers/AAMAS02_fornara_colombetti.pdf)
- Page discrepancy: the USI record gives 535–542 in its page fields and "536–542" in its proceedings line. — [USI publication record](https://search.usi.ch/publications/358/operational-specification-of-a-commitment-based-agent-communication-language)

### Inferences
- **The social view fits LLM agents.** Fornara & Colombetti reject mentalistic semantics for heterogeneous, competitive agents, and Singh shows mutual belief can't be established asynchronously. Both points apply even more strongly to LLM agents from different vendors, whose "intentions" no one can inspect. A protocol theorist should treat agent-to-agent commitments as public objects in a shared record, not as claims about what an agent intends.
- **The commitment lifecycle maps onto contract doctrine.** This mapping is my own synthesis, not a source's claim:
  - create ≈ promise or offer (or acceptance, in a proposal-acceptance pair)
  - detach ≈ a condition precedent is satisfied
  - discharge ≈ performance
  - violation ≈ breach
  - cancel ≈ revocation or termination under a clause
  - release ≈ waiver or release
  - delegate ≈ delegation of duties
  - assign ≈ assignment of rights
  - metacommitments ≈ governing terms, terms of service, or protocol rules
  - context group G ≈ governing law, forum, or protocol governance
- **Jennings' conventions are de-commitment rules.** They anticipate the legal problem of "unexpected actions" (UNCITRAL Model Law Art. 8, Section 4) and the need for explicit rules on when an agent may abandon a commitment.

### Gaps
- **Search budget.** The session's shared web-search limit ran out partway through, so the foundational texts below could not be checked against publisher pages. The details come from prior knowledge, are unverified, and have no quotes or page numbers captured. Verify before citing.
  - Cohen, Philip R., and Hector J. Levesque. "Intention Is Choice with Commitment." *Artificial Intelligence* 42, nos. 2–3 (1990): 213–261. Intention is modelled as a persistent goal: the agent keeps it until it is achieved, believed impossible, or no longer motivated. This is the mentalistic baseline.
  - Bratman, Michael E. *Intention, Plans, and Practical Reason*. Cambridge, MA: Harvard University Press, 1987 (reissued by CSLI Publications, 1999). Intentions are elements of partial plans that resist reconsideration and constrain later deliberation. This is the philosophical basis of BDI architectures.
  - Austin, J. L. *How to Do Things with Words*. Oxford: Clarendon Press, 1962. Performative utterances; "commissives" are one of five classes of illocutionary force (Lecture XII).
  - Searle, John R. *Speech Acts: An Essay in the Philosophy of Language*. Cambridge: Cambridge University Press, 1969. Gives the analysis of promising (ch. 3).
  - Searle, John R. "A Taxonomy of Illocutionary Acts." In *Language, Mind, and Knowledge*, edited by Keith Gunderson, 344–369. Minnesota Studies in the Philosophy of Science 7. Minneapolis: University of Minnesota Press, 1975. Commissives commit the speaker to a future course of action, with world-to-word direction of fit.
  - Winograd, Terry, and Fernando Flores. *Understanding Computers and Cognition: A New Foundation for Design*. Norwood, NJ: Ablex, 1986. The "conversation for action" network (request, promise, declare complete, declare satisfied), implemented in the Coordinator software. This is the most direct precursor to commitment-tracking workflow protocols.
- **Content of Castelfranchi 1995 not verified.** From prior knowledge, the paper distinguishes internal (individual) commitment, social commitment (x committed to y, often before a witness z, which gives y rights), and collective commitment, and argues social commitment can't be reduced to individual intention.
- **Singh–Chopra commitment-protocol papers not fetched.** Candidates from prior knowledge: Yolum & Singh, "Flexible Protocol Specification and Execution" (AAMAS 2002); Chopra & Singh on commitment alignment (AAMAS 2009); Singh, "Information-Driven Interaction-Oriented Programming: BSPL" (AAMAS 2011). Singh, "Semantical Considerations on Dialectical and Practical Commitments" (AAAI 2008) appeared in search results but was not fetched.
- **Festschrift details missing.** The volume containing Singh's ch. 31 is probably *The Goals of Cognition: Essays in Honor of Cristiano Castelfranchi* (College Publications, c. 2012), but this is unverified.

## 2. Economics and game theory of credible commitment and contracting

### Takeaway
Economics treats commitment as a question of credibility: a promise matters only if the promisor has bound itself, through self-binding (Schelling), hostages and bonds (Williamson), or legal or relational enforcement (Macneil, Hart & Moore). Software agents add a mechanism humans lack. When each side can read the other's source code, conditional commitment becomes verifiable, and "program equilibria" can sustain cooperation that ordinary Nash reasoning cannot (Tennenholtz 2004). Hadfield & Koh (2025) connect these threads to AI agents explicitly: reward misspecification is an incomplete-contracting problem, AI-to-AI cooperation improves when agents can write formal contracts, and gap-filling norms are needed.

### Cited Findings

**Tennenholtz, Moshe. "Program Equilibrium." *Games and Economic Behavior* 49, no. 2 (November 2004): 363–373. https://doi.org/10.1016/j.geb.2004.02.002.** [THEORY; citation from an aggregator (Wikipedia); verify on the Elsevier page]
- Argument: players submit programs that play the base game for them, and each program can read the opponent's source code. In the Prisoner's Dilemma, a program that cooperates only with an exact copy of itself ("CliqueBot") makes mutual cooperation an equilibrium, because any deviation triggers defection. The weakness is fragility: any syntactic difference in the code breaks cooperation. — [Wikipedia: Program equilibrium](https://en.wikipedia.org/wiki/Program_equilibrium)
- Follow-up literature, with citations as listed on the same page:
  - Barasz, Christiano, Fallenstein, Herreshoff, LaVictoire & Yudkowsky, "Robust Cooperation in the Prisoner's Dilemma: Program Equilibrium via Provability Logic" (arXiv:1401.5577, 2014). FairBot cooperates if it can prove the opponent cooperates.
  - Critch, "A Parametric, Resource-Bounded Generalization of Löb's Theorem, and a Robust Cooperation Criterion for Open-Source Game Theory," *Journal of Symbolic Logic* 84, no. 4 (2019): 1368–1381.
  - Oesterheld, "Robust Program Equilibrium," *Theory and Decision* 86 (2019): 143–159. Simulation-based "GroundedFairBot."
  - Critch, Dennis & Russell, "Cooperative and Uncooperative Institution Designs" (arXiv:2208.07006, 2022).
  - DiGiovanni & Clifton, "Commitment Games with Conditional Information Disclosure" (AAAI 2023).
  - Cooper, Oesterheld & Conitzer, "Characterising Simulation-Based Program Equilibria" (AAAI 2025; arXiv:2412.14570).
  - Antecedents: McAfee (1984), Howard (1988), Rubinstein (1998); related work by van der Hoek, Witteveen & Wooldridge, *International Journal of Game Theory* 42, no. 3 (2013): 639–671.
  - Source for all of the above: [Wikipedia: Program equilibrium](https://en.wikipedia.org/wiki/Program_equilibrium)
- Contribution: the formal model of how inspectable code can serve as a credible conditional commitment. This is the game-theoretic core of agent-to-agent commitment.

**Hadfield, Gillian K., and Andrew Koh. "An Economy of AI Agents." arXiv:2509.01063, September 1, 2025. Chapter prepared for the *NBER Handbook on the Economics of Transformative AI*.** [THEORY/agenda; verified on arXiv. Also listed in Section 5]
- Contracting: the reward-specification problem in AI training is compared to incomplete contracting between principal and agent. Because goals can't be fully specified, an agent's actual objectives may diverge from the intended ones. — [arXiv abstract page](https://arxiv.org/abs/2509.01063)
- Formal contracts: AI-to-AI cooperation improves when agents can write formal contracts. The chapter asks how to build normative competence and "gap-filling" norms, since human relational contracts depend on shared norms and transfers. — [arXiv](https://arxiv.org/abs/2509.01063)
- Commitment: agents that can condition their play on each other's source code may achieve commitment and coordination unavailable to humans (program equilibria). Agents might also commit strategically by shaping their own memories or preferences, or by delegating to agents with chosen preferences. — [arXiv](https://arxiv.org/abs/2509.01063)
- Institutions: markets rely on property, contract and agency law, which were built for humans. Digital institutions for agents (record-keeping, reputation markets, licensing-style regimes, approved transaction platforms) need to be developed. — [arXiv](https://arxiv.org/abs/2509.01063)
- No verbatim quote was captured.
- An NBER chapter PDF (c15305) appeared in search results but was not fetched. — [NBER chapter PDF (search result)](https://www.nber.org/system/files/chapters/c15305/c15305.pdf)

### Inferences
- **A cross-walk from the economics classics to agent design.** Each line below is my own mapping; only the Hadfield–Koh links are made by a source.
  - Schelling's self-binding corresponds to publishing verifiable code or using an escrowed smart contract.
  - Williamson's hostages correspond to staking, bonds and escrow in agent protocols.
  - Hart–Moore's distinction between observable and verifiable information corresponds to the gap between what agents can see in a log and what a court or third party can verify. This is why attribution and visibility infrastructure matters (Section 5).
  - Macneil's relational contract corresponds to Hadfield–Koh's "gap-filling norms."
  - Coase's make-versus-buy boundary corresponds to whether a principal runs subagents in-house or contracts with external agents (Kolt's delegation problem, Section 4).
- **Program equilibrium is the theoretical case for code-transparent commitment, but its known limits carry over.**
  - Fragility under syntactic difference corresponds to model or version drift.
  - The need for simulation or proof corresponds to the cost and undecidability of verifying another agent's behaviour.
  - LLM agents are not deterministic programs, so a source-code-conditional commitment is only as credible as the determinism and verifiability of the policy behind it. This links to the legal problem with non-deterministic systems in *Quoine* (Section 4).

### Gaps
None of the following were verified this session (search budget exhausted). Details are from prior knowledge, with no quotes or page numbers.
- Schelling, Thomas C. *The Strategy of Conflict*. Cambridge, MA: Harvard University Press, 1960. Ch. 2, "An Essay on Bargaining," revises his 1956 *American Economic Review* article. Its frequently quoted line about the power to constrain an adversary depending on the power to bind oneself is usually placed on p. 22. Verify the wording and page before quoting.
- Williamson, Oliver E. *The Economic Institutions of Capitalism: Firms, Markets, Relational Contracting*. New York: Free Press, 1985. The credible-commitments and hostages chapter builds on Williamson, "Credible Commitments: Using Hostages to Support Exchange," *American Economic Review* 73, no. 4 (1983): 519–540.
- Macneil, Ian R. *The New Social Contract: An Inquiry into Modern Contractual Relations*. New Haven: Yale University Press, 1980. Also Macneil, "The Many Futures of Contracts," *Southern California Law Review* 47 (1974): 691–816.
- Coase, R. H. "The Nature of the Firm." *Economica* 4, no. 16 (1937): 386–405.
- Hart, Oliver, and John Moore. "Property Rights and the Nature of the Firm." *Journal of Political Economy* 98, no. 6 (1990): 1119–1158. Also Hart & Moore, "Incomplete Contracts and Renegotiation," *Econometrica* 56, no. 4 (1988): 755–785, and Grossman & Hart, *Journal of Political Economy* 94, no. 4 (1986): 691–719.
- Mechanism design. A canonical citation for the agent setting is Nisan, Noam, and Amir Ronen, "Algorithmic Mechanism Design," *Games and Economic Behavior* 35 (2001): 166–196. The Hurwicz/Maskin/Myerson foundations were not researched.

## 3. Smart contracts and code-as-commitment

### Takeaway
Code can execute a commitment but cannot replace the legal system that decides what the parties agreed to and what happens when execution goes wrong. Werbach & Cornell argue that contract law is fundamentally a remedial institution, which smart contracts clarify rather than displace. The 2024 UNCITRAL Model Law (Art. 6) now explicitly recognizes contracts expressed in computer code and the use of "dynamic information."

### Cited Findings

**Werbach, Kevin, and Nicolas Cornell. "Contracts Ex Machina." *Duke Law Journal* 67, no. 2 (2017): 313–382.** [COMMENTARY/legal theory; verified]
- Argument: smart contracts are self-executing digital agreements enforced through decentralized cryptography. They open new possibilities and will require new legal responses. But contract law's core function is remedial: it decides what happens when performance fails or was wrongly induced. Smart contracts therefore highlight that function rather than eliminate it. — [Duke Law Journal article page](https://dlj.law.duke.edu/article/contracts-ex-machina)
- Quote (abstract): "But smart contracts will not displace contract law." — [Duke Law Journal](https://dlj.law.duke.edu/article/contracts-ex-machina)
- Contribution: agent-to-agent commitments enforced in code still need an ex post remedial layer for mistake, fraud, unexpected execution and restitution.

**UNCITRAL Model Law on Automated Contracting (2024), Art. 6, "Legal recognition of contracts in computer code and use of dynamic information in automated contracting."** [PRIMARY LAW (model law); full citation in Section 4]
- Art. 6 covers contract terms expressed in computer code and the use of "dynamic information," defined as information that changes periodically or continuously (Guide, para. 55). The Guide discusses smart contracts at para. 12. — [UNCITRAL MLAC ebook](https://uncitral.un.org/sites/uncitral.un.org/files/2424674e-mlautomatedcontracting-ebook.pdf)

**_Quoine Pte Ltd v B2C2 Ltd_ [2020] SGCA(I) 02** (full entry in Section 4) is the leading appellate case on contracts formed entirely by deterministic trading algorithms on a crypto exchange. It held that contracts formed by algorithms running as programmed were not void for unilateral mistake. — [Clifford Chance briefing](https://www.cliffordchance.com/content/dam/cliffordchance/briefings/2020/03/Singapore-Court-of-Appeal-allows-Claims-against-Cryptocurrency-Exchange.pdf)

### Inferences
- **Smart contracts and program equilibrium solve the same problem.** Both make commitments credible through inspectable code. Werbach & Cornell and *Quoine* show the residual problem: when code executes "correctly" but contrary to what someone expected, law reallocates the loss through mistake, restitution or misrepresentation. A protocol for agent-to-agent commitments needs an explicit dispute and remedy layer, rather than assuming code finality.

### Gaps
Not verified this session (search budget exhausted); details from prior knowledge, no quotes captured.
- Szabo, Nick. "Formalizing and Securing Relationships on Public Networks." *First Monday* 2, no. 9 (September 1, 1997). Coins "smart contracts"; the vending-machine analogy.
- Grigg, Ian. "The Ricardian Contract." In *Proceedings of the First IEEE International Workshop on Electronic Contracting (WEC 2004)*, 25–31. IEEE, 2004. A document that is both a human-readable legal contract and a machine-parsable, hash-identified record.
- De Filippi, Primavera, and Aaron Wright. *Blockchain and the Law: The Rule of Code*. Cambridge, MA: Harvard University Press, 2018. "Lex cryptographia."
- Law Commission of England and Wales. *Smart Legal Contracts: Advice to Government*. Law Com No 401. November 2021. From prior knowledge, it concluded that the existing law of England and Wales can accommodate smart legal contracts without statutory reform. The lawcom.gov.uk page could not be fetched (not on the allowlist).

## 4. Legal status of agent-made contracts and payments (as of October 2026)

### Takeaway
Every major instrument recognizes contracts formed by automated systems, including agent-to-agent contracts with no human review: UETA §14 (US, 1999), E-SIGN §101(h) (US, 2000), the UN Electronic Communications Convention Art. 12 (2005) and the UNCITRAL Model Law on Automated Contracting Art. 5 (2024). Each does so by **attributing** the system's actions to the person who uses it. The system is not treated as an agent or a person. The MLAC Guide calls automated systems "tools," and Restatement (Third) of Agency §1.04 cmt. e calls programs "instrumentalities." Courts follow the same logic: Air Canada was responsible for its chatbot (*Moffatt*, 2024); in *Quoine* (2020), knowledge was assessed through the programmer; and the Ninth Circuit (August 2026) treated the *user* as the one "accessing" Amazon via Perplexity's agent. Three questions remain open:
- (a) how mistake and knowledge doctrines apply to non-deterministic agents;
- (b) who bears the risk of "unexpected actions" (MLAC Art. 8 is optional);
- (c) liability gaps, which the Law Commission (2025) flagged, and which the EU's new Product Liability Directive (transposition due 9 December 2026) partly addresses through strict liability for software.

As of October 2026 no jurisdiction gives AI agents legal personality, and I found **no confirmed national enactment of the MLAC**.

### Cited Findings

#### 4a. United States: statutes

**National Conference of Commissioners on Uniform State Laws. *Uniform Electronic Transactions Act* (1999). §§ 2(6), 10, 14.** [PRIMARY LAW (uniform act, enacted state by state)]
- Definition of "electronic agent": "a computer program or an electronic or other automated means used independently to initiate an action or respond to electronic records or performances in whole or in part, without review or action by an individual." It is reproduced here only as a paraphrase anchor; the quote below is from §14. — [McCullagh, "Validity and Limitations of Software Agents in Contract Formation" (PDF)](https://law.uq.edu.au/files/18238/A-McCullagh_The-Validity-and-Limitations-of-Software-Agents-in-Contract-Formation.pdf); [FPF (Berrick 2026)](https://fpf.org/blog/from-chatbot-to-checkout-who-pays-when-transactional-agents-play/)
- §14 (automated transactions) has three rules:
  - (1) A contract may be formed by the interaction of the parties' electronic agents, even with no human awareness or review.
  - (2) A contract may be formed between an electronic agent and an individual, including where the individual takes actions they are free to refrain from and knows, or has reason to know, will cause the agent to complete the transaction.
  - (3) The terms are determined by the applicable substantive law.
  - Sources: [Illinois enactment, 815 ILCS 333/14](https://ilga.gov/legislation/ilcs/documents/081503330K14.htm); [W. Va. Code §39A-1-14](https://code.wvlegislature.gov/39A-1-14/)
- Quote (§14(1)): "even if no individual was aware of or reviewed the electronic agents' actions". — [McCullagh PDF](https://law.uq.edu.au/files/18238/A-McCullagh_The-Validity-and-Limitations-of-Software-Agents-in-Contract-Formation.pdf)
- Error rule: a user may avoid a transaction made through a transactional agent if the agent did not provide "an opportunity for the prevention or correction of [an] error," and providers cannot contract around this. FPF does not give a section number; it is §10(2) by my prior knowledge. — [FPF (Berrick, Feb. 6, 2026)](https://fpf.org/blog/from-chatbot-to-checkout-who-pays-when-transactional-agents-play/)
- Adoption: 49 states, DC and the US Virgin Islands, per [Wikipedia: UETA](https://en.wikipedia.org/wiki/Uniform_Electronic_Transactions_Act). Greenwood gives "52 states and territories." — [Greenwood, Consumer Reports Innovation (2024)](https://innovation.consumerreports.org/empowering-consumers-with-personal-ai-agents-legal-foundations-and-design-considerations/). The Illinois enactment carries a P.A. 102-38 amendment, effective June 25, 2021. — [815 ILCS 333/14](https://ilga.gov/legislation/ilcs/documents/081503330K14.htm)

**UETA drafting history: ABA Section of Business Law, Cyberspace Law Committee, Electronic Commerce Subcommittee Working Group (co-chairs Daniel Greenwood and John Muller), memo of February 16, 1999. Published as "1999 UETA Deliberations," law.mit.edu, February 8, 2024.** [COMMENTARY/legislative history]
- The January 1999 draft provided that operations of an electronic agent are the acts of a person who used it for those purposes. The working group preferred "deemed to be the acts of the person who chose to use the agent," subject to existing defenses, and warned that "bound" language implied strict liability. It asked about "tool-like vs. intelligent electronic agents," floated limiting UETA to non-intelligent systems, and suggested that more autonomous agents might need "a different rule of attribution." — [law.mit.edu: 1999 UETA Deliberations](https://law.mit.edu/pub/1999-ueta-deliberations)
- Quote: emergent behaviours "cannot be predicted based solely on an understanding of the constituent parts". — [law.mit.edu](https://law.mit.edu/pub/1999-ueta-deliberations)
- Contribution: shows the drafters foresaw the autonomy problem and deliberately settled on a simple attribution rule.

#### 4b. International: UNCITRAL

**United Nations Convention on the Use of Electronic Communications in International Contracts (New York, 2005), Art. 12 ("Use of automated message systems for contract formation") and Art. 14 (input errors).** [PRIMARY LAW (treaty)]
- Art. 12: a contract formed by interaction between an automated message system and a natural person, or between automated message systems, shall not be denied validity or enforceability solely because no natural person reviewed or intervened. — [McCullagh PDF](https://law.uq.edu.au/files/18238/A-McCullagh_The-Validity-and-Limitations-of-Software-Agents-in-Contract-Formation.pdf)
- Quote (Art. 12): "no natural person reviewed or intervened in each of the individual actions". — [McCullagh PDF](https://law.uq.edu.au/files/18238/A-McCullagh_The-Validity-and-Limitations-of-Software-Agents-in-Contract-Formation.pdf)
- Art. 14 governs input errors by natural persons dealing with automated systems. The MLAC leaves this to the Convention (Guide, para. 76). — [UNCITRAL MLAC ebook](https://uncitral.un.org/sites/uncitral.un.org/files/2424674e-mlautomatedcontracting-ebook.pdf)

**United Nations Commission on International Trade Law. *UNCITRAL Model Law on Automated Contracting, with Guide to Enactment*. Vienna: United Nations, 2025. Sales No. E.25.V.4. ISBN 978-92-1-157738-9; e-ISBN 978-92-1-154264-6.** [PRIMARY LAW (model law) plus OFFICIAL COMMENTARY (Guide); verified]
- Adoption: adopted by UNCITRAL at its fifty-seventh session (1231st meeting, July 11, 2024) and endorsed by UN General Assembly resolution 79/119 of December 4, 2024. — [MLAC ebook](https://uncitral.un.org/sites/uncitral.un.org/files/2424674e-mlautomatedcontracting-ebook.pdf)
- Vietnam chaired the Sixth Committee negotiation of the GA resolution. Despite some headlines, this was not a Vietnamese enactment. — [Vietnam Law Magazine (Nov. 25, 2024)](https://vietnamlawmagazine.vn/vietnamese-coordinated-resolution-on-model-law-on-automated-contracting-approved-73062.html)
- Articles:
  - Art. 1 Definitions
  - Art. 2 Scope
  - Art. 3 Interpretation
  - Art. 4 Technology neutrality
  - Art. 5 Legal recognition of automated contracting
  - Art. 6 Contracts in computer code / dynamic information
  - Art. 7 Attribution
  - Art. 8 Unexpected actions
  - Art. 9 Information requirements
  - Art. 10 Non-avoidance
  - Source: [MLAC ebook](https://uncitral.un.org/sites/uncitral.un.org/files/2424674e-mlautomatedcontracting-ebook.pdf)
- Art. 1(1)(a): an "automated system" is a computer system capable of carrying out actions without the necessary review or intervention of a natural person. — [MLAC ebook](https://uncitral.un.org/sites/uncitral.un.org/files/2424674e-mlautomatedcontracting-ebook.pdf)
- Art. 5: a contract formed using automated systems is not denied validity or enforceability solely because no natural person reviewed or intervened. Art. 5(2), on performance, is optional (bracketed). Art. 5(3) gives the same non-discrimination to *actions* of automated systems. The Guide (para. 44) says Art. 5 refines and expands ECC Art. 12, and (para. 50) avoids the word "decision" so as not to imply that systems have an independent will. — [MLAC ebook](https://uncitral.un.org/sites/uncitral.un.org/files/2424674e-mlautomatedcontracting-ebook.pdf)
- Art. 7 (attribution):
  - 7(1): between the parties, actions are attributed according to "a procedure agreed to by the parties."
  - 7(2): failing that, to "the person who uses the system for that purpose."
  - 7(3): attribution is not denied merely because the outcome was unexpected.
  - Source: [MLAC ebook](https://uncitral.un.org/sites/uncitral.un.org/files/2424674e-mlautomatedcontracting-ebook.pdf)
- Art. 8 (optional, bracketed): the other party may not rely on an action that the attributed party could not reasonably have expected, if the other party knew or ought to have known this. Other law, such as mistake rules, is preserved (Guide, paras. 76, 83). — [MLAC ebook](https://uncitral.un.org/sites/uncitral.un.org/files/2424674e-mlautomatedcontracting-ebook.pdf)
- Art. 9 creates no disclosure duty of its own. It preserves other laws requiring disclosure of a system's design, operation or use (Guide, para. 84). — [MLAC ebook](https://uncitral.un.org/sites/uncitral.un.org/files/2424674e-mlautomatedcontracting-ebook.pdf)
- Scope: the Model Law applies to "automated systems, including AI systems" (Guide, para. 7) and mentions machine learning (para. 3). It deliberately avoids the term "autonomous" (para. 30). It does not use the phrase "AI agents." — [MLAC ebook](https://uncitral.un.org/sites/uncitral.un.org/files/2424674e-mlautomatedcontracting-ebook.pdf)
- Quote (Guide, para. 61): "automated systems are tools with no independent will or legal personality". — [MLAC ebook](https://uncitral.un.org/sites/uncitral.un.org/files/2424674e-mlautomatedcontracting-ebook.pdf)
- **Enactment status as of October 2026:** I found no confirmed national enactment.
  - The UNCITRAL Secretariat note A/CN.9/1263 (May 15, 2026, for the 59th session, New York, June 29–July 10, 2026) lists the MLAC among the electronic-commerce texts to be consolidated. It says MLAC provisions update and supplement the ECC's automated-contracting rules and that uptake of these texts "remains uneven." It does not list MLAC enactments; enactment data sits in A/CN.9/1226, which was not fetched. The note proposes referring the consolidated text to Working Group IV but proposes no new work on AI or automated contracting. — [A/CN.9/1263 (PDF)](https://uncitral.un.org/sites/default/files/2026-05/a-cn.9-12631_0.pdf)
  - An earlier commentary (Feb. 2025) found no EU or national enactment and noted the Commission was still considering whether EU rules are needed. — [Chougule, MediaLaws (Feb. 3, 2025)](https://www.medialaws.eu/automated-contracting-in-europe-developments-and-future-directions/)

#### 4c. Agency law and theory: is an AI agent a legal "agent"?

**American Law Institute. *Restatement (Third) of Agency* § 1.04 cmt. e. St. Paul, MN: American Law Institute Publishers, 2006.** [OFFICIAL COMMENTARY (Restatement); quoted second-hand from Kolt, fn. 26. The publication year comes from prior knowledge]
- The comment says a computer program is not capable of acting as a principal or an agent as defined by the common law. Kolt notes the qualifier "at present," which leaves room for change. — [Kolt, arXiv version (PDF)](https://arxiv.org/pdf/2501.07913)
- Quote (§1.04 cmt. e, as quoted in Kolt fn. 26): "At present, computer programs are instrumentalities of the persons who use them." — [Kolt PDF](https://arxiv.org/pdf/2501.07913)

**Kolt, Noam. "Governing AI Agents." *Notre Dame Law Review* 101 (2026): 335–.** [COMMENTARY; verified volume, first page and year. Web version posted August 22, 2026; earlier versions at SSRN 4772956 (2024) and arXiv:2501.07913 (January 2025). The brief's "2025" refers to the preprint; the print citation is 2026. End page and issue not confirmed]
- Argument: agency theory from economics and the common law exposes four problems with AI agents:
  - information asymmetry;
  - authority (incomplete instructions force discretion);
  - loyalty (conflicts of interest, non-disclosure);
  - delegation (subagents).
- The usual remedies (incentives, monitoring, enforcement) may fail at agent speed and scale and given opaque decision-making. Kolt proposes three governance principles: **inclusivity**, **visibility** and **liability**. — [Notre Dame L. Rev. PDF](https://ndlawreview.org/wp-content/uploads/2026/08/Kolt_101.335.pdf); [ND L. Rev. article page](https://ndlawreview.org/governing-ai-agents/)
- Quote (Part I.A; page not verified): "They are not mere tools". — [ND L. Rev. PDF](https://ndlawreview.org/wp-content/uploads/2026/08/Kolt_101.335.pdf)
- Contribution: the leading account of agents as principal-agent problems. His delegation problem maps onto Singh's *delegate* operation.

**Desai, Deven R., and Mark O. Riedl. "Using Agency Law to Tame AI Agents." *Berkeley Technology Law Journal* 41 (2026): 465–. https://doi.org/10.15779/Z38KW57M6R.** [COMMENTARY; verified]
- Argument: agency law should be used by analogy, not applied directly, because AI agents are software. Many agency problems (authority, rogue action, third-party knowledge) are already handled by technical infrastructure, since agents generally can't transact without seller cooperation through APIs and e-commerce practices. Value alignment lacks fiduciary concepts of loyalty and conflict of interest, and these should be added. Explainable AI can support correcting agent errors ex post and preventing them ex ante. The authors warn that anthropomorphizing software leads toward personhood and less accountability. — [BTLJ PDF](https://btlj.org/wp-content/uploads/2026/08/Desai_Ready-ADA-Compliant_08-11-26.pdf)

**Riedl, Mark O., and Deven R. Desai. "AI Agents and the Law." arXiv:2508.08544, 2025.** [COMMENTARY; earlier preprint; date inferred from references accessed May 22, 2025]
- Argument: agency law's liability rules don't carry over cleanly to software agents. The paper cites Restatement §§ 2.02, 2.03, 6.01–6.03, 6.10, 8.01, 8.02. — [arXiv PDF](https://arxiv.org/pdf/2508.08544)
- Quote: "a software agent is not the same as a human agent". — [arXiv PDF](https://arxiv.org/pdf/2508.08544)

**Ayres, Ian, and Jack M. Balkin. "The Law of AI Is the Law of Risky Agents without Intentions." *University of Chicago Law Review Online*, November 27, 2024.** [COMMENTARY; verified]
- Argument: AI lacks intentions, so liability rules keyed to intent risk leaving AI use unaccountable. Law should use objective standards, either ascribing intention or applying reasonableness, and place duties on those who design, train, deploy or host AI, as principals are liable for their agents (p. *2). The authors note that contract intention is already judged objectively (p. *4, n. 5) and propose presuming that AI programs intend their reasonable and foreseeable consequences (p. *5). Footnote 1 cites a Connecticut statute recognizing contracts formed by electronic agents. — [U. Chi. L. Rev. Online article page](https://lawreview.uchicago.edu/online-archive/law-ai-law-risky-agents-without-intentions); [PDF](https://lawreview.uchicago.edu/sites/default/files/2024-11/Ayres_Balkin_Law%20of%20Risky%20Agents.pdf)
- Quote (p. *1): AI agents "do not have intentions in the way that humans do". — [PDF](https://lawreview.uchicago.edu/sites/default/files/2024-11/Ayres_Balkin_Law%20of%20Risky%20Agents.pdf)

**Kerr, Ian R. "Spirits in a Material World: Intelligent Agents as Intermediaries in Electronic Commerce." *Dalhousie Law Journal* 22, no. 2 (1999): 190–.** [COMMENTARY; verified]
- Argument: identifies how traditional contract doctrine obstructs contracts formed by software without human review. Kerr rejects legal personhood for electronic devices, reviews the UNCITRAL, NCCUSL (UETA) and Uniform Law Conference of Canada approaches, and proposes an approach based on agency law. — [Dalhousie Law Journal page](https://digitalcommons.schulichlaw.dal.ca/dlj/vol22/iss2/4)

**Greenwood, Dazza. "Empowering Consumers with Personal AI Agents: Legal Foundations and Design Considerations." Consumer Reports Innovation Lab, October 18, 2024.** [COMMENTARY]
- Argument: UETA's "electronic agent" definition "perfectly describes" LLM-powered agents. UETA's error-prevention framework lets consumers reverse a transaction if the merchant skipped agreed procedures. Personal agents could carry a provider duty of loyalty. — [Consumer Reports Innovation](https://innovation.consumerreports.org/empowering-consumers-with-personal-ai-agents-legal-foundations-and-design-considerations/)

#### 4d. Cases and judicial commentary

**_Moffatt v. Air Canada_, 2024 BCCRT 149 (B.C. Civil Resolution Tribunal, February 14, 2024) (Tribunal Member Christopher C. Rivers).** [CASE; verified from the CRT decision]
- Air Canada argued, in effect, that its chatbot was a separate legal entity responsible for its own actions. The tribunal rejected this (para. 27), found Air Canada did not take reasonable care to make sure its chatbot was accurate (para. 28, negligent misrepresentation), and awarded $650.88 in damages. — [CRT decision](https://decisions.civilresolutionbc.ca/crt/crtd/en/525448/1/document.do)
- Quote (para. 27): "it is responsible for all the information on its website". — [CRT decision](https://decisions.civilresolutionbc.ca/crt/crtd/en/525448/1/document.do)
- Note: this is a small-claims tribunal decision with little precedential weight, but it is widely cited.

**_Quoine Pte Ltd v B2C2 Ltd_ [2020] SGCA(I) 02 (Singapore Court of Appeal, February 24, 2020).** [CASE; reported through law-firm and chambers summaries; judgment not fetched]
- Holdings:
  - Contracts formed by deterministic algorithms operating as programmed were not void for unilateral mistake at common law. The traders' error was a mistaken assumption about how the platform would operate, not a mistake about a term.
  - For unilateral mistake, the relevant knowledge is the programmer's, assessed from programming through contract formation. The test is whether the programmer had actual or constructive knowledge that the offer would only be accepted by someone under a mistake, and was acting to take advantage of that. B2C2's programmer lacked that knowledge.
  - Mance IJ dissented, favouring equitable relief where a fundamental error would at once have been perceived.
  - The court did not decide whether cryptocurrency is property capable of being held on trust.
  - Sources: [Clifford Chance briefing (Mar. 2020)](https://www.cliffordchance.com/content/dam/cliffordchance/briefings/2020/03/Singapore-Court-of-Appeal-allows-Claims-against-Cryptocurrency-Exchange.pdf); [Fountain Court summary](https://fountaincourt.uk/2020/02/major-judgment-in-cryptocurrency-case-handed-down-by-singapore-court-of-appeal/)
- Quote (Mance IJ, dissent; paragraph not verified; via Clifford Chance): computers are "outworkers, not overlords". — [Clifford Chance briefing](https://www.cliffordchance.com/content/dam/cliffordchance/briefings/2020/03/Singapore-Court-of-Appeal-allows-Claims-against-Cryptocurrency-Exchange.pdf)

**Jeyaretnam, Philip (Justice, Supreme Court of Singapore). Speech at the SCCA Asia-Pacific (APAC) Legal Congress 2026, April 9, 2026.** [COMMENTARY (judicial, extra-judicial)]
- *Quoine* concerned a deterministic algorithm, so any remarks about autonomous AI were obiter. Thorley IJ, at first instance, had contrasted autonomous AI that could be said to "have a mind of its own." Mance IJ's "reasonable trader" approach may suit autonomous systems better. A similar dispute involving agentic AI is "surely just a matter of time." Doctrines that depend on human states of mind are hard to apply to AI that at most simulates them, and the way forward is incremental, case by case. — [Singapore Judiciary speech](https://www.judiciary.gov.sg/news-and-resources/news/news-details/justice-philip-jeyaretnam--speech-at-the-asia-pacific-%28apac%29-legal-congress-2026)
- Quote: "the programmer's state of mind at the time of coding may bear little resemblance". — [Singapore Judiciary speech](https://www.judiciary.gov.sg/news-and-resources/news/news-details/justice-philip-jeyaretnam--speech-at-the-asia-pacific-%28apac%29-legal-congress-2026)

**_Amazon v. Perplexity AI_ (N.D. Cal. preliminary injunction, March 2026; 9th Cir. decision vacating the injunction, early August 2026).** [CASE; reported through press. Caption and docket not verified]
- Senior District Judge Maxine Chesney granted Amazon a preliminary injunction against Perplexity's Comet shopping agent on Computer Fraud and Abuse Act (CFAA) grounds. A unanimous Ninth Circuit panel (Judge Milan Smith Jr. writing, with Judge Eric Tung and District Judge John Hinderaker by designation) vacated it. The panel held Amazon unlikely to succeed on its CFAA claim because the user, not Perplexity, accesses Amazon's computers through the agent. The panel said the ruling is limited to CFAA access on this record and does not create a regime for agentic AI. The case goes back to the district court, and Amazon is weighing rehearing en banc or a petition to the Supreme Court. Amazon argues agents should identify themselves. — [Sovereign Magazine (Aug. 6, 2026)](https://www.sovereignmagazine.com/article/ninth-circuit-perplexity-comet-amazon-cfaa-ruling); for the injunction, [GeekWire (Mar. 10, 2026)](https://www.geekwire.com/2026/03/10/judge-blocks-perplexitys-ai-bot-from-shopping-on-amazon-in-early-test-of-agentic-commerce/)
- Quote (panel opinion, as reported): "It is the user who 'accesses' Amazon's computers". — [Sovereign Magazine](https://www.sovereignmagazine.com/article/ninth-circuit-perplexity-comet-amazon-cfaa-ruling)
- Significance: described as the first federal appellate decision on whether AI agents may reach platforms on users' behalf. Its user-as-actor reasoning matches the attribution model in UETA and the MLAC. — [Sovereign Magazine](https://www.sovereignmagazine.com/article/ninth-circuit-perplexity-comet-amazon-cfaa-ruling)

#### 4e. European Union

**Regulation (EU) 2024/1689 (AI Act), as amended by Regulation (EU) 2026/1744 (the "Digital Omnibus on AI").** [PRIMARY LAW; Omnibus details from law-firm reporting]
- The Omnibus was provisionally agreed on May 6, 2026, published in the Official Journal on July 24, 2026, and in force from July 27, 2026. — [Gibson Dunn](https://www.gibsondunn.com/eu-ai-act-omnibus-agreement); [Mondaq](https://www.mondaq.com/uk/new-technology/1825722/eu-digital-omnibus-on-ai-enters-into-force)
- New high-risk dates: Annex III stand-alone systems move from August 2, 2026 to December 2, 2027; Annex I product-embedded systems to August 2, 2028. — [Mondaq](https://www.mondaq.com/uk/new-technology/1825722/eu-digital-omnibus-on-ai-enters-into-force)
- Art. 50 transparency obligations, including telling people they are interacting with an AI system, largely apply from August 2, 2026. Systems already on the market get until December 2, 2026 for Art. 50(2) watermarking. — [Gibson Dunn](https://www.gibsondunn.com/eu-ai-act-omnibus-agreement)
- The AI Act has no provisions on automated contract formation. — [MediaLaws (Feb. 2025)](https://www.medialaws.eu/automated-contracting-in-europe-developments-and-future-directions/)
- Quote: there is an "absence of specific provisions on automated contracting in the EU". — [MediaLaws](https://www.medialaws.eu/automated-contracting-in-europe-developments-and-future-directions/)

**Directive (EU) 2024/2853 (new Product Liability Directive).** [PRIMARY LAW; details via law-firm and aggregator commentary]
- Stand-alone software and AI systems are "products," and AI providers are treated as manufacturers. Liability can arise from defects that emerge after market placement, including missing updates or security patches. Non-compliance with mandatory safety requirements, including the AI Act, raises a presumption of defect. For technically complex products, courts may presume defect and causation. Transposition is due by December 9, 2026, and the Directive applies to products placed on the market after that date. — [Hannes Snellman](https://www.hannessnellman.com/news-and-views/blog/updates-to-the-ai-act-and-product-liability-directive-key-changes-for-industrial-companies/)
- An aggregator scan (July 2026) adds: courts may order disclosure of source code and training records; the €500 threshold and liability caps are removed; online platforms and importers can be defendants. On transposition, Hungary has transposed, Germany's bill had a split expert hearing on April 13, 2026, and Bulgaria expects approval in November 2026. The Commission has withdrawn the separate AI Liability Directive (no date given). — [Shaping Tomorrow scan (July 6, 2026)](https://decision-intel.shapingtomorrow.com/scans/regulation-standards-policy-change/2026-07-06-ex-post-liability-turn/scan.html). This is a lower-reliability aggregator; treat the transposition details as unconfirmed.

#### 4f. United Kingdom

**Law Commission of England and Wales. *AI and the Law: A Discussion Paper*. July 31, 2025.** [OFFICIAL COMMENTARY (law-reform discussion paper); reported second-hand, paper not fetched]
- The paper identifies possible "liability gaps" where no one is liable for harm caused by autonomous, adaptive AI. It notes that defendants might argue unpredicted AI outputs are intervening causes. It raises legal personality for AI as a "potentially radical option," warning that such entities could become "liability shields protecting developers from reasonable accountability." It proposes no reforms. — [PPC Land (Aug. 10, 2025)](https://ppc.land/law-commission-publishes-discussion-paper-on-ai-legal-challenges/); [Legal Cheek (Aug. 7, 2025)](https://www.legalcheek.com/2025/08/should-ai-be-given-legal-personhood-new-law-commission-paper-raises-radical-possibility/)
- Hill Dickinson reports the Commission's view that AI is not yet sophisticated enough to warrant personality. It also notes that reliance on AI outputs in forming a contract raises misrepresentation questions. — [Hill Dickinson](https://www.hilldickinson.com/our-view/articles/regulating-artificial-intelligence-the-uk-law-commission-s-approach/)
- Quote (as reported): "no natural or legal person is liable for the harms caused by". — [PPC Land](https://ppc.land/law-commission-publishes-discussion-paper-on-ai-legal-challenges/)

#### 4g. Payments and transactional agents

**Berrick, Daniel. "From Chatbot to Checkout: Who Pays When Transactional Agents Play?" Future of Privacy Forum, February 6, 2026.** [COMMENTARY]
- Argument: transactional agents can probably bind users under UETA §14, even where both sides use agents. Users may avoid agent-made transactions if they had no error-correction opportunity, and contract terms can't override this. The post lists A2A, AP2 (Google's Agent Payments Protocol), UCP, ACP and MCP as protocols that can be combined, and notes ChatGPT native checkout, Perplexity shopping and Amazon "Buy For Me." Risk controls include confirmation prompts, purchase limits and action logs; logs can evidence the user's authorization. The post does not discuss Regulation E or Z. — [FPF](https://fpf.org/blog/from-chatbot-to-checkout-who-pays-when-transactional-agents-play/)
- Quote (quoting UETA's error rule): "an opportunity for the prevention or correction of [an] error". — [FPF](https://fpf.org/blog/from-chatbot-to-checkout-who-pays-when-transactional-agents-play/)

### Inferences
- **Attribution, not agency, is the legal model, and it is aligned across jurisdictions.** UETA §14, ECC Art. 12, MLAC Arts. 5 and 7, Restatement §1.04 cmt. e, *Moffatt* and the Ninth Circuit's *Perplexity* reasoning all treat the software as the user's instrument and assign its acts to a person. In Singh's terms, the legal debtor is always a human or company. The agent is at most a channel. Kolt ("not mere tools") and Desai & Riedl (agency by analogy) push against the tool framing in scholarship, but no primary law had adopted that view by October 2026.
- **MLAC Art. 7(1) is where protocol design meets the law.** Between parties, attribution follows "a procedure agreed to by the parties." An agent-to-agent protocol carrying signed delegation credentials (South et al., Section 5) could arguably serve as that agreed procedure. Its commitment semantics would then become the evidentiary basis for whose commitment a message is. This is my inference; no source says it directly.
- **Unexpected actions are the main open question.** MLAC Art. 8 is optional. UETA §14 has no equivalent, though the 1999 drafters discussed a "different rule of attribution" for autonomous agents. Mistake doctrine ties knowledge to the programmer at coding time (*Quoine*), which Justice Jeyaretnam says fits non-deterministic systems poorly. A protocol could deal with this by recording expected-behaviour envelopes (scopes, limits) so the other side "knew or ought to have known" when an action fell outside them. That tracks Art. 8's knowledge condition. (Inference.)
- **Objective semantics in MAS match objective theories in law.** Fornara & Colombetti's "social, objective consequences" and Singh's public commitments line up with Ayres & Balkin's objective standards and the objective theory of contract formation. The mismatch is in vitiating doctrines (mistake, misrepresentation, fraud), which still look to someone's knowledge. (Inference.)
- **Liability is moving ex post and toward strict liability.** In the EU, defective-agent harms will increasingly go through the new PLD, which treats software as a product with presumptions, rather than through an AI-specific liability directive, which was withdrawn. This sits alongside, and does not replace, contract-formation law. (Inference from the cited sources.)

### Gaps
- **E-SIGN §101(h) (15 U.S.C. §7001(h)) not verified.** From prior knowledge, a record or contract may not be denied legal effect solely because its formation involved electronic agents, so long as the agent's action is legally attributable to the person to be bound. §106(3) defines "electronic agent." Verify the text.
- **The Restatement comment was read only through Kolt's footnote 26.** The ALI text and the 2006 publication year should be checked directly.
- **MLAC enactment data.** A/CN.9/1226 (the stocktaking with enactment data) and the UNCITRAL MLAC status page could not be fetched; the page returned an error. The claim "no enactments" rests on absence of evidence in the sources I could reach.
- **ELI–UNCITRAL project.** The joint project on Model Contractual Terms on Digital Assistants (B2C and B2B) appeared in search results, but its page redirected to a maintenance notice. Scope and status are unknown.
- **Law Commission paper and 2021 advice not read directly.** The 2025 paper was read only through secondary reports, so page numbers and paragraph cites are missing. The 2021 smart contracts advice (Law Com No 401) could not be fetched.
- **Missing case details.** The *Quoine* majority judges and paragraph numbers are unverified; from prior knowledge, Menon CJ, Phang JA, Prakash JA and French IJ were in the majority. The *Moffatt* award is $650.88 in damages; interest and fees, which bring the total higher, were not checked. The *Amazon v. Perplexity* docket numbers and the exact date of the Ninth Circuit opinion are unconfirmed.
- **EU text not checked.** The Omnibus regulation number 2026/1744 comes from one law-firm source. PLD article numbers were not verified: from prior knowledge, Art. 4(1) brings software within "product," Art. 7 covers defectiveness including a system's ability to keep learning, Art. 10 sets the presumptions, and there is an open-source carve-out outside commercial activity. The AI Liability Directive withdrawal date is not verified; from prior knowledge, it was announced in the Commission's February 2025 work programme.
- **Not verified (search budget exhausted):**
  - Chopra, Samir, and Laurence F. White. *A Legal Theory for Autonomous Artificial Agents*. Ann Arbor: University of Michigan Press, 2011. From prior knowledge, it argues artificial agents should be treated as legal agents for contracting, attributes their knowledge to principals, and considers eventual personhood.
  - Kerr's Uniform Law Conference of Canada paper "Providing for Autonomous Electronic Devices in the Uniform Electronic Commerce Act" (1999). Its title refers to Canada's UECA, not the US UETA as the brief put it. Only Kerr's *Dalhousie Law Journal* article was verified.
  - Any 2025–2026 Hadfield law-review article specifically on agentic contracting. None was found.
- **Regulation E (US payments) not researched.** From prior knowledge, 12 C.F.R. §1005.2(m) treats transfers by a person to whom the consumer gave an access device as authorized unless the consumer has notified the institution. That would put agent-initiated payments under the "authorized" heading by default, with major consumer-protection consequences. No source in this session covers how Reg E/Z or card-network rules (Visa Intelligent Commerce, Mastercard Agent Pay) apply to agent payments.
- **US uniform-law work not found.** I found no Uniform Law Commission drafting or study committee on AI agents and UETA. The only ULC AI committee found concerns state-government use of AI (2023). — [CDIA](https://cdiaonline.org/?p=27946)
- **US non-adopters of UETA.** From prior knowledge, New York has not adopted UETA and relies on its Electronic Signatures and Records Act. Not verified.

## 5. Policy and academic agendas on agent infrastructure and agent economies

### Takeaway
Since 2024 the research agenda has shifted from aligning individual agents to building **infrastructure external to agents**. The main components are attribution and identity (agent IDs, delegation credentials), interaction protocols, and response and remedy mechanisms (Chan et al. 2025), plus authenticated delegation built on OAuth/OpenID Connect (South et al. 2025). Economists add identity registries, record-keeping, reputation markets and a choice between registration and personhood (Hadfield & Koh 2025), and propose steerable "sandbox" agent markets (Tomašev et al. 2025). Legal scholars add the principles of visibility, liability and inclusivity (Kolt 2026). Together these give a protocol theorist the institutional layer that MAS commitment semantics takes for granted.

### Cited Findings

**Chan, Alan, Kevin Wei, Sihao Huang, Nitarshan Rajkumar, Elija Perrier, Seth Lazar, Gillian K. Hadfield, and Markus Anderljung. "Infrastructure for AI Agents." arXiv:2501.10114, v1 January 17, 2025; v2 May 16, 2025.** [THEORY/agenda; verified on arXiv. Publication venue not confirmed]
- Argument: changing agent behaviour directly, for example through training, is not enough to manage how diverse agents interact. "Agent infrastructure" is needed, by analogy to HTTPS. It has three functions: **attribution** (linking actions and properties to agents, users or other actors), **interaction** (shaping how agents interact) and **response** (detecting and remedying harmful actions). The paper catalogues research directions for each. — [arXiv](https://arxiv.org/abs/2501.10114v2)
- Quote (abstract): agent infrastructure means "technical systems and shared protocols external to agents". — [arXiv](https://arxiv.org/abs/2501.10114v2)

**South, Tobin, Samuele Marro, Thomas Hardjono, Robert Mahari, Cedric Deslandes Whitney, Dazza Greenwood, Alan Chan, and Alex Pentland. "Authenticated Delegation and Authorized AI Agents." arXiv:2501.09674, January 16, 2025.** [THEORY/technical proposal; verified on arXiv. An ICML venue appears only as a keyword and is unconfirmed]
- Argument: extend OAuth 2.0 and OpenID Connect with three tokens: a user ID token, an agent ID token, and a delegation token signed by the user that grants scoped, time-limited permissions. Natural-language permissions are translated into structured, machine-enforceable scopes, with a human reviewing the generated policy, because natural language alone is too imprecise to enforce. — [arXiv HTML](https://arxiv.org/html/2501.09674v1)
- Quote (abstract): the goal is "authenticated, authorized, and auditable delegation of authority to AI agents". — [arXiv HTML](https://arxiv.org/html/2501.09674v1)

**Hadfield, Gillian K., and Andrew Koh. "An Economy of AI Agents."** (Full citation in Section 2.)
- Identity and registration infrastructure for AI agents is currently missing. Legal identity for humans and firms developed historically alongside trade. — [arXiv](https://arxiv.org/abs/2509.01063)
- Liability options:
  - (a) register each agent to an accountable human or entity, though it is unclear whether liability rules can handle unforeseeable behaviour or open-ended instructions such as "make $1 million";
  - (b) legal personhood, which would require agents to hold assets that courts can seize.
  - Either choice would affect developer incentives and agent design. — [arXiv](https://arxiv.org/abs/2509.01063)
- Proposed institutional tools: record-keeping, reputation markets, licensing-style regimes, approved transaction platforms, and regulatory access to proprietary model information. — [arXiv](https://arxiv.org/abs/2509.01063)

**Tomasev [Tomašev], Nenad, Matija Franklin, Joel Z. Leibo, Julian Jacobs, William A. Cunningham, Iason Gabriel, and Simon Osindero. "Virtual Agent Economies." arXiv:2509.10147, September 12, 2025.** [THEORY/agenda; verified on arXiv]
- Argument: the "sandbox economy" framework classifies agent economies by origin (emergent or intentional) and by separation from the human economy (permeable or impermeable). The current path points to a highly permeable agent economy, with systemic risk and greater inequality. The authors propose steerable markets: auctions for fair resource allocation and preference resolution, "mission economies" organized around collective goals, and socio-technical infrastructure for trust, safety and accountability. — [arXiv](https://arxiv.org/abs/2509.10147v1)
- Quote (abstract): "a new economic layer where agents transact and coordinate". — [arXiv](https://arxiv.org/abs/2509.10147v1)

**Kolt, "Governing AI Agents" (2026)**, cross-referenced from Section 4c. Its three principles, inclusivity, visibility and liability, form the legal side of this agenda. — [ND L. Rev. article page](https://ndlawreview.org/governing-ai-agents/)

**Desai & Riedl (2026)**, cross-referenced from Section 4c. Seller-side technical infrastructure (APIs, e-commerce practices) already constrains agent authority, and fiduciary loyalty should be added to the alignment toolkit. — [BTLJ PDF](https://btlj.org/wp-content/uploads/2026/08/Desai_Ready-ADA-Compliant_08-11-26.pdf)

**2026 policy contest over agent identification.** In *Amazon v. Perplexity*, Amazon argued that agents reaching its store for customers should identify themselves. Publishers backed Amazon; the ACLU, Knight First Amendment Institute and EFF backed Perplexity. — [Sovereign Magazine (Aug. 6, 2026)](https://www.sovereignmagazine.com/article/ninth-circuit-perplexity-comet-amazon-cfaa-ruling)

### Inferences

#### Concept map for framing agent-to-agent commitments
This is my synthesis. Each node lists the sources it rests on.

```
[L0 Speech acts]  Austin 1962 (performatives, commissives) → Searle 1969/1975 (commissives: speaker bound to future act)
        │
        ▼
[L1 What a commitment IS]
   mentalistic: Cohen & Levesque 1990, Bratman 1987  ──(rejected for heterogeneous agents)──►
   social/normative: Castelfranchi 1995 → Jennings 1993 (commitments + conventions)
                     → Singh 1999 C(x,y,G,p) + ops (create/discharge/cancel/release/delegate/assign)
                     → Fornara & Colombetti 2002 (ACL = operations on commitment objects)
                     → Singh c.2012–14 (detach/discharge/violate; commitment machines; compliance)
   design lineage: Winograd & Flores 1986 (conversation for action)
        │
        ▼
[L2 Why a commitment is CREDIBLE]
   Schelling 1960 (self-binding) · Williamson 1983/1985 (hostages) · Macneil (relational)
   Tennenholtz 2004 → Oesterheld 2019, Critch 2019, Cooper et al. 2025 (program equilibrium)
   Szabo 1997 / Grigg 2004 / De Filippi & Wright 2018 (code-enforced)
   Hadfield & Koh 2025 (source-code conditioning, strategic delegation, gap-filling norms)
        │
        ▼
[L3 Whether law ENFORCES it and against WHOM]
   formation validity: UETA §14 · E-SIGN §101(h) · ECC Art 12 · MLAC Art 5
   attribution: MLAC Art 7 (agreed procedure → user) · Restatement §1.04 cmt e ("instrumentalities")
   cases: Moffatt 2024 (deployer bound) · Quoine 2020 (programmer's knowledge) · Amazon v Perplexity 9th Cir 2026 (user acts)
   contested: Kolt 2026 ("not mere tools") · Desai & Riedl 2026 (agency by analogy) · Ayres & Balkin 2024 (objective standards)
        │
        ▼
[L4 What happens when it FAILS]
   remedial law: Werbach & Cornell 2017 · MLAC Art 8 unexpected actions · UETA error-correction rule
   liability gaps / personhood debate: Law Commission 2025 · Hadfield & Koh 2025
   strict product liability: EU PLD 2024/2853 (software = product; transposition 9 Dec 2026)
        │
        ▼
[L5 What INFRASTRUCTURE makes L1–L4 work]
   attribution / identity: Chan et al. 2025 · South et al. 2025 (delegation tokens) · Hadfield & Koh (registries)
   visibility / logs: Kolt (visibility) · FPF 2026 (logs as evidence of authorization)
   interaction / markets: Tomašev et al. 2025 (sandbox economies, auctions) · agent payment protocols (AP2, ACP, etc.)
   response / remedy: Chan et al. 2025 (response function)
```

#### Cross-walk: one concept across four vocabularies
Cells marked * are my inferences; unmarked cells are supported by the cited sources above.

| MAS commitment theory | Economics / game theory | Law (Oct 2026) | Infrastructure analog |
|---|---|---|---|
| Debtor / creditor (Singh) | Principal / agent (Kolt; Hadfield & Koh) | Attribution to "the person who uses the system" (MLAC 7(2)); program as "instrumentality" (Restatement) | Agent ID + user ID + delegation token (South et al.) |
| Context group G; metacommitments (Singh 1999) | Governance structures* (Williamson) | Governing substantive law (UETA §14(3)); "procedure agreed to by the parties" (MLAC 7(1)) | Protocol rules / ToS / registries* |
| Create (promise; offer/accept) | — | Formation validity without human review (UETA §14; ECC 12; MLAC 5) | Message schemas* |
| Detach (antecedent true) | Contingent claims* | Condition precedent* | Oracles / event feeds* |
| Discharge | Performance | Performance | Settlement / payment rails (AP2, ACP per FPF) |
| Violation | Breach; hostage forfeiture* | Breach and remedies (Werbach & Cornell) | Escrow / slashing*; response functions (Chan et al.) |
| Cancel / release; Jennings' conventions | Renegotiation* (Hart & Moore) | Unexpected-action non-reliance (MLAC 8); UETA error avoidance | Rollback / incident response (Chan et al. "response") |
| Delegate / assign | Strategic delegation (Hadfield & Koh) | Kolt's delegation problem; assignment and delegation doctrine* | Delegation chains (South et al.) |
| Public, objective semantics (Fornara & Colombetti; Singh) | Verifiability* (Hart & Moore) | Objective standards (Ayres & Balkin); BUT mistake still keyed to knowledge (*Quoine*) | Logs and visibility (Kolt; FPF) |
| Credibility | Self-binding (Schelling*); program equilibrium (Tennenholtz) | Enforceability; strict product liability (PLD) | Code transparency / smart contracts (Werbach & Cornell; MLAC 6) |

#### Five tensions for a protocol theorist (inference)
1. **Tool or agent?** Primary law everywhere says "tool" or "instrumentality" (MLAC para. 61; Restatement cmt. e). Leading scholarship says "not mere tools" (Kolt) or recommends agency by analogy (Desai & Riedl; Kerr 1999). MAS theory treats the agent itself as debtor. A protocol should model two layers: the agent as operational debtor, and its principal as legal debtor, linked by a verifiable delegation credential.
2. **Intent and knowledge.** Formation is objective, but vitiating doctrines need someone's knowledge. For non-deterministic agents, the programmer-at-coding-time test (*Quoine*) is strained (Jeyaretnam 2026). Recorded scopes and expectations could supply an objective substitute.
3. **Unexpected actions.** Only the MLAC addresses these, and only optionally (Art. 8). Hadfield & Koh ask whether liability can handle unforeseeable behaviour, and the 1999 UETA drafters set the question aside.
4. **Who acts on the platform?** The Ninth Circuit's user-as-actor view supports attribution. Amazon's push for agent self-identification points toward identity infrastructure (Chan et al.; South et al.). Expect identification requirements to arrive through platform terms and protocols before legislation.
5. **Credibility without courts.** Program equilibrium and smart contracts give self-enforcing commitments. Werbach & Cornell argue a remedial layer remains necessary, and the Law Commission's "liability gaps" show what happens without one.

### Gaps
- **2026 follow-ups not found.** No 2026 versions or updates of Chan et al. (2025), Hadfield & Koh (2025), Tomašev et al. (2025) or South et al. (2025) were identified. Publication venues for Chan et al. and South et al. are unconfirmed (possibly TMLR and ICML respectively).
- **Not verified (search budget exhausted; arXiv/OpenAI pages not on the fetch allowlist):**
  - Shavit, Yonadav, Sandhini Agarwal, Miles Brundage, et al. "Practices for Governing Agentic AI Systems." OpenAI white paper, December 2023. From prior knowledge, the practices include: evaluating suitability for the task, constraining the action space and requiring approval, setting default behaviours, legibility of agent activity, automatic monitoring, attributability, and interruptibility.
  - Chan, Alan, Carson Ezell, Max Kaufmann, Kevin Wei, Lewis Hammond, Herbie Bradley, Emma Bluemke, Nitarshan Rajkumar, David Krueger, Noam Kolt, Lennart Heim, and Markus Anderljung. "Visibility into AI Agents." In *Proceedings of the 2024 ACM Conference on Fairness, Accountability, and Transparency (FAccT '24)*, 2024 (arXiv:2401.13138). From prior knowledge, it proposes three measures: agent identifiers, real-time monitoring and activity logging.
- **Industry protocol specs not reviewed.** AP2, ACP, A2A and MCP appear here only through FPF's listing. How each represents authorization, mandates or commitments was not examined; this is relevant to whether any of them could serve as an MLAC Art. 7(1) "agreed procedure."
- **Method note.** The session's shared web-search budget (200 calls per turn across all agents) ran out partway through, so several foundational works were not verified and are listed in the Gaps sections with details from prior knowledge. A follow-up pass could verify editions and pages for Schelling, Williamson, Bratman, Cohen & Levesque, Searle, Austin, Winograd & Flores, Macneil, Coase, Hart & Moore, Szabo, Grigg, De Filippi & Wright, Chopra & White, E-SIGN, the Restatement and the PLD articles, and capture quotes with page numbers.
