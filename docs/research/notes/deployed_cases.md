# Deployed Cases: AI Agents Making Commitments with Other Agents or Automated Counterparties (as of October 29, 2026)

Notes on method and evidence:
- Research ran on October 29, 2026. Partway through, the shared web-search budget ran out, so some planned lookups were never made. Those are listed under Gaps: Workday, Oracle, insurance claims, prior-authorization voice agents, Browserbase, Exa, OpenRouter, Booking Holdings, Amadeus, and whether Sabre/Mindtrip flights actually went live in Q2 2026.
- Evidence grades used throughout:
  - **A**: primary company document, filing, or named-customer case study with numbers.
  - **B**: reputable trade or business press reporting company statements.
  - **C**: vendor marketing page, aggregator, or AI-authored article. Forkast.news labels its authors "AI minds"; stellagent.ai, ai2.work and agentmarketcap.ai are aggregators.
- Verbatim quotes were captured with an automated page-extraction tool. Each is under 15 words, with at most one per source. Spot-check them against the original before publishing.
- Counterparty labels:
  - **A2A**: the counterparty is itself a software agent.
  - **A2H**: the counterparty is a human.
  - **A2API**: the counterparty is a conventional API, website checkout, or rules engine.

---

## 1. Enterprise agent-to-agent (Salesforce Agentforce, ServiceNow AI Agent Fabric, SAP Joule, Microsoft Copilot Studio/Azure AI Foundry, Workday, Oracle): are named customers running cross-vendor agent handoffs in production?

### Takeaway
As of October 2026, the A2A protocol is built into the major platforms (Copilot Studio, Azure AI Foundry, AWS Bedrock AgentCore, ServiceNow, SAP Joule). I found no publicly documented, named customer running cross-vendor agent-to-agent handoffs in production. The only named cross-company case is a pilot between Gordon Food Service and Tyson Foods. It covers product search and sales tracking, and no commitments are made. Vendor numbers measure membership and usage, not A2A transactions.

### Cited Findings
- **Linux Foundation, one-year anniversary release (April 9, 2026).**
  - Reports 150+ supporting organizations, up from 50+ in April 2025.
  - Reports 22,000+ GitHub stars, SDKs in five languages, and 60+ organizations supporting the related Agent Payments Protocol (AP2).
  - Says A2A is integrated in Microsoft Azure AI Foundry and Copilot Studio and in AWS Bedrock AgentCore Runtime.
  - Claims "active production deployments across multiple industries" (supply chain, financial services, insurance, IT ops) but names no production user.
  - Quote, Rao Surapaneni of Google Cloud, in the release body: "AI agents are only as useful as their ability to collaborate."
  - Evidence: A for membership counts, C for the production claim.
  - Source: Linux Foundation, "A2A Protocol Surpasses 150 Organizations, Lands in Major Cloud Platforms, and Sees Enterprise Production Use in First Year," press release, April 9, 2026. [Source](https://www.linuxfoundation.org/press/a2a-protocol-surpasses-150-organizations-lands-in-major-cloud-platforms-and-sees-enterprise-production-use-in-first-year)
- **Gordon Food Service and Tyson Foods (pilot, A2A).**
  - Built with Google's Agent Development Kit and A2A to connect GFS agents with supplier Tyson Foods' agents for product searching and sales tracking.
  - Each side's agents act as "black boxes" and do not expose memory, tools or logic.
  - GFS plans to move it to production in Gemini Enterprise and add more vendors.
  - No orders, quotes or binding actions are described.
  - Other GFS figures: about 7,000 employees use Gemini; 20,000+ hours saved monthly. These are not A2A-specific.
  - Quote, CIO Brendan Bonthuis, in the page body: "The real magic of Gemini Enterprise is in what it's unlocking from our people."
  - Evidence: A for the pilot's existence. The page is undated.
  - Source: Google Cloud, "Gordon Food Service" customer story, n.d. (accessed October 29, 2026). [Source](https://cloud.google.com/customers/gordonfoodservice)
- **Same GFS/Tyson pilot in a secondary write-up.**
  - Called the only named enterprise A2A case.
  - Lists vendor A2A shipments:
    - ServiceNow AI Agent Fabric (A2A v0.3 in the December 2025 "Zurich" release)
    - SAP Joule Studio GA (December 2025)
    - Adobe AEP Agent Orchestrator GA (September 2025)
    - Copilot Studio multi-agent orchestration GA
  - Names no cross-vendor production customers.
  - Quote: "Gordon Food Service is now planning to bring this to production."
  - Evidence: C. Mostly unsourced.
  - Source: AgentMarketCap, "A2A Protocol Six Months In: What Adobe, Microsoft, SAP, and ServiceNow Are Actually Building," April 6, 2026. [Source](https://agentmarketcap.ai/blog/2026/04/06/a2a-protocol-enterprise-adoption-adobe-microsoft-sap-servicenow)
- **ServiceNow AI Agent Fabric / Action Fabric.**
  - External agents can run governed ServiceNow actions over MCP and A2A.
  - Includes prebuilt MCP servers (ITSM, ITOM, CMDB) and A2A support for multi-agent workflows.
  - Names Claude, ChatGPT and Gemini as connectable agents.
  - No customers are tied to the capability on the product page.
  - Quote, product page hero text: "Connect Claude, ChatGPT, Gemini, or any AI agent to ServiceNow."
  - Evidence: A for capability; no customer evidence.
  - Source: ServiceNow, "AI Agent Fabric," product page, accessed October 29, 2026. [Source](https://www.servicenow.com/platform/ai-agent-fabric.html)
- **ServiceNow at Knowledge 2025.**
  - Cloud Wars reported AI Agent Fabric with Google A2A support.
  - Microsoft, Google, Oracle, Databricks and Snowflake are listed as Workflow Data Network partners, not Agent Fabric customers.
  - No named cross-vendor customers.
  - Quote, Amit Saxena of ServiceNow: "Because customers really care about outcomes."
  - Source: Tom Smith, "With Latest Agentic AI Products, ServiceNow Embraces Third-Party Platforms, Data Sources," Cloud Wars, May 7, 2025. [Source](https://cloudwars.com/cloud/with-latest-agentic-ai-products-servicenow-embraces-third-party-platforms-data-sources/)
- **SAP Joule and Microsoft Copilot.**
  - SAP's reference architecture describes Microsoft Copilot (through Copilot Studio) calling Joule agents on the SAP Business AI Platform. It is described as inbound only.
  - Copilot Studio's native A2A path "can't perform the required token exchange," so a Power Platform custom connector is used.
  - Some components are not GA.
  - Quote, disclaimer on the page: "the Agent Gateway is not yet GA."
  - Evidence: A. This is a pattern, not a customer deployment.
  - Source: SAP Architecture Center, "Microsoft Copilot Integration with Joule Agents," accessed October 29, 2026. [Source](https://architecture.learning.sap.com/docs/ref-arch/a2c0f1)
- **Salesforce Agentforce, Q2 FY2027 call (summary dated August 26, 2026).**
  - Agentforce ARR $1.5B; AI and Data ARR near $4B.
  - 3.2B agentic work units, up 97% quarter over quarter.
  - About 2,000 paying customers or accounts in production, up 70% quarter over quarter. Verify this against Salesforce's own release; the summary's wording is ambiguous.
  - The U.S. Army Human Resources Command expects up to 55M conversations a month.
  - Named customers: NYU Langone, McAfee, Kellogg's, Dell.
  - **No A2A or cross-vendor agent interoperability was mentioned.** The "Claudeforce" offering and access through Slack, Claude, ChatGPT and Teams were mentioned instead.
  - Quote, summary body: "Agentforce work-unit usage rose 97% sequentially."
  - Evidence: B.
  - Source: MarketBeat, "Transcript: Salesforce Q2 Earnings Call Highlights," August 26, 2026. [Source](https://www.marketbeat.com/instant-alerts/transcript-salesforce-q2-earnings-call-highlights-2026-08-26/)
- **Ten named Agentforce case studies (July 2025).**
  - Customers: AAA, Precina Health, Wiley, Adecco, Accenture, Saks, SharkNinja, Good360, Prudential, Amplifon.
  - None describes agent-to-agent communication.
  - Amplifon's agent schedules appointments, a reservation-level commitment.
  - Wiley reports self-service efficiency up more than 40%.
  - Quote, SharkNinja: customers are "walking away a little happier."
  - Source: Rebekah Carter, "10 Agentforce Case Studies, and What We Learned from Them," CX Today, July 22, 2025. [Source](https://www.cxtoday.com/crm/agentforce-case-studies)
- **Walmart "super agents."**
  - Four planned super agents: Sparky (customers, live), Marty (suppliers and sellers, "coming months"), an associate agent and a developer agent.
  - They use MCP to interact with other agents and systems.
  - No supplier-side agent counterparties are documented.
  - Quote, CEO Doug McMillon: "Artificial intelligence is already changing how we work."
  - Source: Modern Distribution Management, "Walmart Consolidating AI Agents into 4 'Super Agents,'" July 24 (year not shown on page; context indicates 2025). [Source](https://www.mdm.com/news/technology/ai/walmart-consolidating-ai-agents-into-4-super-agents/)
- **Independent assessment (June 2026).**
  - Found no named enterprise customers in cross-vendor A2A production.
  - Quote: "A2A is alive but its useful scope is narrower than the hype suggests."
  - Source: Rost Glukhov, "Google A2A Protocol in 2026: Adoption, Hype, and Reality," glukhov.org, June 24, 2026. [Source](https://www.glukhov.org/ai-systems/comparisons/a2a-protocol-2026-adoption/)

### Inferences
- In enterprise A2A today, agents mostly exchange information and route tasks: product search, ticket routing, HR-to-IT delegation. They do not form commitments with outside parties. The commitment-bearing actions (refunds, appointments, orders) happen inside a single vendor's agent, against that vendor's own systems of record.
- Protocol plumbing is ahead of governance. SAP's need for a custom connector, because the native A2A path cannot exchange tokens, shows that cross-vendor identity and authorization are still the practical blockers for binding cross-company agent actions.
- The most likely first cross-vendor commitments are buyer-supplier links like GFS and Tyson (orders, availability holds). Walmart's planned supplier agent "Marty" is another candidate.

### Gaps
- Workday and Oracle agent A2A deployments were not researched (search budget ran out).
- I found no named customer with Agentforce agents talking to another vendor's agents in production. I also found no Salesforce-published A2A transaction counts.
- I found no published metrics (handoffs per day, success rates) for any cross-vendor A2A deployment.
- Whether the GFS/Tyson pilot reached production by October 2026 is unverified.

---

## 2. Procurement and negotiation: Pactum (Walmart, Maersk), Keelvar, Fairmarkit, Zip; freight agents (C.H. Robinson, Uber Freight, HappyRobot, carrier-side agents). Are both sides ever agents?

### Takeaway
Pactum's work with Walmart is the best-documented case of an AI agent making binding commercial commitments in production. It negotiates and closes supplier agreements on price and payment terms. Reported closure rates are 64–68%, savings range from 1.5% to 10% depending on the source and phase, and about 75% of suppliers say they prefer the bot. By 2025, Pactum reported that agents had signed a $140.5M deal and closed one deal in 87 seconds. In freight, broker-side agents now make large volumes of binding commitments:
- C.H. Robinson: 1M+ quotes and about 5,500 truckload orders a day.
- HappyRobot at Circle Logistics: 18% of freight booked with no human touch.

The counterparty is almost always a human: a supplier rep, carrier dispatcher, or shipper's emailed tender. Carrier-side agents have appeared (Hey Bubba AI, 2026), and suppliers have asked for "a bot on our side." Even so, I found no documented production negotiation where both sides were AI agents.

### Cited Findings
**Pactum and Walmart**
- **HBR article (November 2022), as summarized by Talking Logistics.**
  - "How Walmart Automated Supplier Negotiations" describes a three-month Walmart Canada pilot with tail-end, goods-not-for-resale suppliers (fleet services, carts, store equipment).
  - 100 suppliers were invited, with 89 suppliers and 5 buyers taking part.
  - 64% reached agreement against a 20% target. HBR's summary figure is 68% of suppliers approached.
  - Average turnaround was 11 days, average savings 1.5%, and payment terms were extended by an average of 35 days.
  - Walmart later expanded to transportation route rates, some goods for resale, and mid-tier suppliers.
  - HBR quote reproduced in the article body: suppliers "have signed agreements with cookie-cutter terms that are often not negotiated."
  - Evidence: B for the secondary summary. The primary HBR text was not fetchable.
  - Source: Adrian Gonzalez, "Negotiating With A Chatbot: A Walmart Procurement Case Study," Talking Logistics, May 1, 2023. [Source](https://talkinglogistics.com/2023/05/01/negotiating-with-a-chatbot-a-walmart-procurement-case-study/)
- **Bloomberg report (April 26, 2023), via PYMNTS.**
  - The chatbot closes deals with 68% of the suppliers it is used with.
  - Nearly three in four suppliers prefer it.
  - Average savings are 3%.
  - Quote: the chatbot "closes deals in days rather than weeks."
  - Source: PYMNTS, "Walmart Reportedly Finds 75% of Vendors Prefer Negotiating With Chatbot," April 2023. [Source](https://www.pymnts.com/news/artificial-intelligence/2023/walmart-finds-75-percent-vendors-prefer-negotiating-with-chatbot/partial/)
- **Engadget on the same Bloomberg report.**
  - Countries: Canada pilot, then the US, Chile and South Africa.
  - Average contract savings about 3%. Walmart sets budgets and payment-term inputs.
  - Quote, article body: "Three out of four suppliers prefer haggling with the AI over a human."
  - Source: Jon Fingas, "Walmart's Suppliers Would Rather Negotiate with AI than a Human," Engadget, April 28, 2023. [Source](https://www.engadget.com/walmarts-suppliers-would-rather-negotiate-with-ai-than-a-human-162131831.html)
- **MIT Sloan Management Review (c. 2023).**
  - Walmart's chatbot expanded from tail-end suppliers in one country to mid-tier suppliers in several countries.
  - Average savings 7–10%.
  - 67% of surveyed suppliers found it easy to use; 83% liked being able to counteroffer.
  - Suppliers gained termination conditions, early payment, or growth opportunities in exchange.
  - Bot on both sides is described only as a future expectation, from GCG's CEO.
  - Quote, Michael DeWitt of Walmart: "Suppliers come back again and again."
  - Source: "Procurement in the Age of Automation," MIT Sloan Management Review, n.d. (c. 2023; author names not shown on the fetched page). [Source](https://sloanreview.mit.edu/article/procurement-in-the-age-of-automation)
- **Conflict on savings.** The figures are 1.5% (2022 Canada pilot, HBR via Talking Logistics), 3% (Bloomberg, April 2023) and 7–10% (MIT SMR, 2023). They probably reflect different phases, supplier tiers and baselines. Do not merge them into one number.
- **Teaching case (February 17, 2025).**
  - Pilots at Walmart and Maersk showed efficiency gains, cost savings and higher supplier engagement.
  - No figures are given in the abstract.
  - Source: E. William Youngdahl, Shail H. Patel, Megha R. Shah, and Addison G. Sutton, *Pactum's AI in Contract Negotiations: Walmart and Maersk*, Thunderbird School of Global Management case TB0756, Harvard Business Publishing, February 17, 2025, 10 pp. [Source](https://store.hbr.org/product/pactum-s-ai-in-contract-negotiations-walmart-and-maersk/TB0756)

**Pactum at scale**
- **Series C announcement (June 9, 2025).**
  - $54M raised.
  - Customers: Walmart, Honeywell, Novartis, Tetra Pak, Veritiv, Suez, Linde, Global Industrial, Mediclinic, Vallen, Otto.
  - Spend handled by AI agents up 489%; ARR up 2.5x; 25+ Global 2000 customers.
  - Largest agent-negotiated deal $140.5M. Fastest deal "negotiated and signed by agents in 87 seconds."
  - Agents have "delegated autonomy and authority" to conclude supplier agreements.
  - Quote, CEO Kaspar Korjus: AI is "freeing up teams to focus on more strategic and meaningful work."
  - Evidence: A, but vendor-reported.
  - Source: Pactum, "Pactum Secures $54 Million in Series C Funding to Scale Agentic AI in Procurement," ACCESS Newswire, June 9, 2025. [Source](https://www.accessnewswire.com/newsroom/en/business-and-professional-services/pactum-secures-54-million-in-series-c-funding-to-scale-agentic-a-1036166)

**Pactum and Maersk**
- **FreightWaves (June 22, 2022).**
  - Pactum negotiates lane and volume agreements with local truckers while ships are at sea, about two weeks before port arrival.
  - Truckers get guaranteed volume, and Maersk moves to shorter-term agreements.
  - Large trucking companies asked whether Pactum could "put a bot on our side as well." This shows demand for bot-versus-bot, not a deployment.
  - No counts or savings are given.
  - Quote, Pactum executive: "We reach out to the local truckers and we agree on those lanes."
  - Source: Noi Mahoney, "Pactum Using AI to Revolutionize Shipping Contract Negotiations," FreightWaves, June 22, 2022. [Source](https://www.freightwaves.com/news/pactum-using-ai-to-revolutionize-shipping-contract-negotiations)
- **IEEE Spectrum, republished by HumanProgress.**
  - "Contract negotiation bots could soon be on both sides of the table" is framed as a forecast.
  - Cites a single bot running 2,000 negotiations at once.
  - No documented two-sided case.
  - Quote: "Walmart and Maersk are using AI agents to maintain and negotiate deal terms."
  - Source: HumanProgress (republishing IEEE Spectrum), November 11, 2024. [Source](https://humanprogress.org/contract-negotiation-bots-could-soon-be-on-both-sides-of-the-table/)

**Agent-versus-agent procurement: no documented production case**
- **Una (March 4, 2026).** Its 2026 survey of AI negotiation tools names no customers with metrics and no agent-versus-agent cases. The Dutch academic study it cites pitted a chatbot buyer against human suppliers. Quote, a marketing tagline cited in the article: "AI-to-AI negotiations automate low-value procurement contracts." Source: Hugo Britt, "The State of AI Negotiation Tools in 2026," Una, March 4, 2026. [Source](https://una.com/resources/article/the-state-of-ai-negotiation-tools-in-2026/)
- **NEC (April 9, 2026).** NEC's automated negotiation AI, cited in Gartner research dated March 13, 2026, was piloted only inside NEC Group procurement, adjusting parts delivery schedules with suppliers. No metrics. Quote, Gartner-related passage: "reducing procurement cycles from months to seconds." Source: NEC, "NEC's Automated Negotiation AI Recognized as a Use Case in Gartner Research," press release via Nasdaq, April 9, 2026. [Source](https://www.nasdaq.com/press-release/necs-automated-negotiation-ai-recognized-use-case-gartnerr-research-2026-04-10)

**Keelvar (sourcing bots)**
- **Newport Tank Containers (ocean freight RFP).**
  - Carrier bids came in through Keelvar and were checked against Xeneta market rates.
  - 200–250 hours freed up; market visibility on more than 90% of lanes.
  - Humans made the final awards ("procurement team still applied the commercial and operational judgment").
  - The award is a human commitment, not an agent commitment.
  - Quote, Newport procurement lead: "Before, it would be me analyzing everything in Excel."
  - Source: Keelvar, "Newport Tank Containers" success story, n.d. [Source](https://www.keelvar.com/success-stories/newport-tank-containers-ocean-freight-sourcing)

**Freight brokerage: broker-side agents with human counterparties**
- **C.H. Robinson newsroom (June 12, 2025).** More than 30 agents. Unit numbers:
  - **Quoting Agent:** more than 1M quotes, each in 32 seconds.
  - **Orders Agent:** about 5,500 truckload orders a day built from emailed tenders, each in about 90 seconds, saving 600 labor hours a day.
  - **LTL Classifier:** 2,000 shipments a day; LTL automation rose from 50% to more than 75%.
  - **Appointments Agent:** 3,000+ appointments a day across 43,000 locations.
  - Overall: 30% productivity gain since 2023.
  - Quote: "more than 30 AI agents are now deployed at scale across its global network."
  - Evidence: A, but company-reported.
  - Source: C.H. Robinson, "C.H. Robinson Scales Fleet of AI Agents Past 30," June 12, 2025. [Source](https://www.chrobinson.com/en-us/about-us/newsroom/news/2025/ch-robinson-scales-fleet-of-ai-agents-past-30/)
- **FreightWaves (April 16, 2025).**
  - More than 3M shipping tasks, 1M+ price quotes and 1M+ orders handled by AI.
  - More than 5,200 SMB customers have loads accepted in under 90 seconds, versus up to 4 hours before.
  - About 10,000 email transactions a day.
  - LTL quote volume up at least 30% after LTL was added to AI quoting.
  - A January agent for inbound carrier-capacity emails raised truck uploads tenfold.
  - No carrier rate-negotiation agent is reported.
  - Quote: "over 5,200 customers are getting their loads accepted in under 90 seconds."
  - Source: Grace Sharkey, "C.H. Robinson Delivers on AI, but Investors Still Skeptical," FreightWaves, April 16, 2025. [Source](https://www.freightwaves.com/news/c-h-robinson-delivers-on-ai-but-investors-still-skeptical)
- **Transport Topics (April 16, 2025).**
  - Agents quote, handle orders, secure capacity, schedule appointments and track shipments.
  - 1M AI-processed orders in March 2025; 83,000 customers.
  - Quote: "These agents handle basic tasks, freeing workers to focus on more valuable work."
  - Source: Connor D. Wolf, "C.H. Robinson Expands AI Agents Across Shipment Life Cycle," Transport Topics, April 16, 2025. [Source](https://www.ttnews.com/articles/ch-robinson-ai-agents)
- **HappyRobot at Circle Logistics.**
  - Voice agents answer 100% of inbound carrier calls 24/7, present loads, negotiate rates, confirm bookings and run fraud checks.
  - Results are synced to the TMS (Transport Pro) and Highway.
  - 18% of freight booked with zero human touch; 80–100% fewer manual calls per use case; 10% higher margin; 200,000 calls (headline figure).
  - No approval thresholds are disclosed.
  - Quote, Kyle Williams of Circle: "Circle Logistics, Inc is the clubhouse leader in integrated, effective AI in freight."
  - Evidence: A/C (vendor case study, undated).
  - Source: HappyRobot, "Circle Logistics" customer story, n.d. (© 2026). [Source](https://www.happyrobot.ai/customer-story/circle)
- **HappyRobot at MODE Global.**
  - 100% inbound answer rate and zero first-response time for carrier sales.
  - Carrier vetting and fraud screening; "early lane negotiations" with no figures.
  - Quote, CEO Lance Malesh: "We selected HappyRobot as a partner because of their robust technology."
  - Source: HappyRobot, "MODE Global" customer story, n.d. [Source](https://happyrobot.ai/customer-story/mode)
- **HappyRobot scale (AI-authored article).**
  - 150+ customers; "eight of the 10 largest US freight brokers" in production.
  - 10M+ interactions a month; 70%+ autonomous resolution.
  - DHL uses it for carrier tracking and ETA calls.
  - $150M Series C closed August 4, 2026 at a $1.22B post-money valuation.
  - Quote: "Logistics runs on phone calls."
  - Evidence: C.
  - Source: Dana Ellison [AI author], "HappyRobot Wants $1.2 Billion to Run Your Freight by Voice," Forkast, August 20, 2026. [Source](https://forkast.news/happyrobot-wants-1-2-billion-to-run-your-freight-by-voice/)
- **Uber Freight.** "More than 30 AI agents" and Insights AI (about 98% accuracy, per Lior Ron); about $20B of freight a year. The agents' specific commitment functions are not described. Quote: agents "execute key logistics tasks throughout the freight lifecycle." Source: Sean O'Kane, "Uber Freight Bets Big on AI Tools to Grow Its Business," TechCrunch, May 21, 2025. [Source](https://techcrunch.com/2025/05/21/uber-freight-bets-big-on-ai-tools-to-grow-its-business)

**Carrier-side agents (the other side of the table)**
- **Hey Bubba AI (2026).**
  - Its carrier-side agent negotiates with 5–10 brokers at once by phone, email and API.
  - Cuts a 5–6 hour manual booking down and presents the carrier with 5–10 offers.
  - The article does not say the brokers were themselves using AI.
  - Quote, Gabe Ribeiro: the goal is to "create five or ten different offers for them to look at."
  - Source: FreightWaves Staff, "5 Hours to Book a Truck? AI Is Coming for That," FreightWaves, September 28, 2026. [Source](https://freightwaves.com/news/5-hours-to-book-a-truck-ai-is-coming-for-that)

### Inferences
- Pactum and Walmart is the reference production case for an agent forming a binding B2B agreement. The bot negotiates within Walmart-set budgets and trade-off rules. It offers payment-term extensions in exchange for price concessions, or early payment and termination rights. The human supplier accepts, which creates the contract.
- Freight now has agents on both sides. Broker-side voice agents (HappyRobot at 8 of the top 10 brokers) and carrier-side agents (Hey Bubba) both negotiate rates by phone, email and API. So AI-to-AI freight negotiations are probably already happening without being labeled. I found no published report confirming one, and no protocol for agents to recognize each other.
- Commitment strength differs within freight. A C.H. Robinson quote is an offer. Order acceptance is a binding load tender acceptance. An appointment is a reservation. HappyRobot booking confirmation binds a carrier to haul at an agreed rate. Failure handling (fall-offs, tender rejections) still goes through human operations and industry norms; no mechanism specific to agents was found.

### Gaps
- The primary HBR text (November 2022) could not be fetched. Its author list is commonly given as Remko Van Hoek, Michael DeWitt, Mary Lacity and Travis Johnson, but I did not verify that in this session.
- I found no Walmart/Pactum figures published after 2023: total negotiations, spend under agent negotiation, current supplier preference.
- Fairmarkit and Zip were not researched (budget ran out). Keelvar's autonomous award rate is not published.
- C.H. Robinson's 2026 agent metrics were not retrieved. Its 2025 figures are the latest captured.
- I found no documented production negotiation where both sides were AI agents in any sector.

---

## 3. Voice agents calling businesses that run their own voice agents (Google Duplex/Ask for Me/Call for Me, restaurant reservations, prior authorization, insurance claims). Are agent-meets-agent calls reported?

### Takeaway
Consumer-side calling agents have moved from Duplex's 2018–2019 restaurant reservations to info-gathering calls (Ask for Me, 2025) to a 2026 Gemini "Call for Me" beta that books tables and reschedules appointments. These are reservation-level commitments. Agent-meets-agent calls are widely forecast; Gartner predicted 20% of contact-center traffic from "machine customers" by 2026. I found no published, measured report of agent-to-agent phone calls with named parties.

### Cited Findings
- **Google Duplex (March 2019).** Restaurant reservations on Pixel phones in 43 US states, expanded from pilot metros (New York, Atlanta, Phoenix, San Francisco). "A majority" of calls were automated; no counts given. Quote: "Calling restaurants to book a table might soon become a thing of the past." Source: Kyle Wiggers, "Google Duplex Rolls Out to Pixel Phones in 43 States," VentureBeat, March 6, 2019. [Source](https://venturebeat.com/ai/google-duplex-rolls-out-to-pixel-phones-in-43-states)
- **Google "Ask for Me" (Search Labs, February 2025).**
  - An AI agent calls businesses for prices and availability. Initially limited to mechanics and nail salons in the US.
  - The user gets an email or SMS summary. The article does not say the agent can commit or book.
  - The article notes that contact centers already use AI agents and cites Gartner: 20% of contact-center traffic from machine customers by 2026. That is a forecast.
  - Quote: "machine-to-machine interactions appear to be the next frontier for customer service."
  - Source: Charlie Mitchell, "Google Launches an AI Agent That Will Call Customer Service for You," CX Today, February 3, 2025. [Source](https://www.cxtoday.com/contact-center/google-launches-an-ai-agent-that-will-call-customer-service-for-you/)
- **Ask for Me, wider rollout (date not shown on page).** Expanded to auto shops, dry cleaners and pet groomers. The agent announces itself and businesses can opt out of AI calls. Quote, the agent's self-introduction: "an AI from Google." Source: PhoneArena, "Google's 'Ask for Me' Is Ready to Call Some Stores for You to Get Prices and Availability," n.d. [Source](https://www.phonearena.com/news/googles-ask-for-me-is-ready-to-make-calls-for-you_id172335)
- **Gemini "Call for Me" (beta, September 2026).**
  - Gemini calls businesses, navigates phone menus, waits on hold, checks stock, books restaurant tables and reschedules appointments.
  - The user can watch a live transcript and step in.
  - Beta for Pixel 11 owners with a Gemini subscription in the US. No numbers.
  - Quote, Google on why it is a beta: "real-world conversations are nuanced."
  - Source: Ogbonda Chivumnovu, "Gemini's Call for Me," Techloy, September 25, 2026. [Source](https://www.techloy.com/geminis-call-for-me/)
- **Reality Defender (June 2026).** A contact-center security vendor. Argues agentic AI callers are already arriving but gives no measured volumes and names no examples. Quote: "Agentic AI callers are already reaching your contact center." Source: Gabe Regan, "The Agentic AI Caller Problem," Reality Defender, June 17, 2026. [Source](https://www.realitydefender.com/insights/agentic-ai-caller-problem)
- **Customer-service resolution: Klarna as baseline (February 2024).**
  - The AI assistant handled two-thirds of customer-service chats in its first month.
  - Resolution time fell from 11 minutes to 2. Klarna estimated a $40M profit improvement for 2024 and workload equal to 700 agents.
  - Explicitly handled refunds, returns, disputes, cancellations and payment issues. These are commitments of money to the consumer.
  - The counterparty is a human consumer.
  - Quote, CEO Sebastian Siemiatkowski: "superior experiences for our customers at better prices."
  - Source: Rhys Fisher, "Klarna Claims Its New AI Assistant Does the Work of 700 Full-Time Agents," CX Today, February 29, 2024. [Source](https://www.cxtoday.com/contact-center/klarna-claims-its-new-ai-assistant-does-the-work-of-700-full-time-agents/)
- **HappyRobot outbound calls (also in section 2).** It runs outbound check calls and ETA confirmation calls (DHL) to carriers. If the carrier side runs agents such as Hey Bubba's automated tracking calls to brokers, these calls can be agent-to-agent. Neither source confirms that pairing. [Source](https://forkast.news/happyrobot-wants-1-2-billion-to-run-your-freight-by-voice/); [Source](https://freightwaves.com/news/5-hours-to-book-a-truck-ai-is-coming-for-that)

### Inferences
- What voice agents commit to has risen over time:
  - 2025: information only (Ask for Me).
  - 2026: reservations and rescheduling (Call for Me).
  - Restaurant reservations go back to Duplex in 2019.
- Payment over the phone by consumer agents is not documented.
- When the business answers with its own AI receptionist, two agents are negotiating a booking over a channel built for humans. Neither side has a machine-readable identity or a verified mandate. The safeguards are disclosure ("an AI from Google"), business opt-out and a human able to step in.
- Freight check calls and prior-authorization or claims-status calls are the most likely places where agent-to-agent phone calls already happen at volume. Payers and brokers both run voice AI.

### Gaps
- Prior-authorization voice agents (for example SuperDial and similar vendors) calling payer IVRs or AI agents surfaced only as vendor marketing pages. I did not fetch or verify them, and I have no named provider–payer pair or volumes.
- Insurance-claims agent cases were not researched (budget ran out).
- I found no measured or named report of an AI agent's phone call answered by another AI agent.
- Klarna's later partial return to human agents was not verified in this session.

---

## 4. Consumer shopping agents completing purchases (OpenAI Instant Checkout, Perplexity, Amazon Buy for Me, Google agentic checkout): what commitment is formed, and are there published counts?

### Takeaway
Agentic checkout went live at all the major AI platforms between late 2025 and 2026. In every case the retailer stays merchant of record and owns returns and cancellations. The agent forms the order, a payment-level commitment, after an explicit user confirmation step. Counterparties are conventional merchant APIs or website checkouts, not agents. No platform has published order counts. OpenAI's Instant Checkout reportedly went live with only about 12 Shopify merchants, had "dismal" conversion, and lacked a sales-tax remittance system. In March 2026 OpenAI said Instant Checkout was "moving to Apps."

### Cited Findings
- **OpenAI Instant Checkout launch (September 29, 2025).** Launched with Etsy, Shopify merchants to follow, on the Agentic Commerce Protocol (ACP) co-developed with Stripe. Only the launch headline was captured in this session, not the article details. Source: TechCrunch, "OpenAI Takes On Google, Amazon with New Agentic Shopping System," September 29, 2025. [Source](https://techcrunch.com/2025/09/29/openai-takes-on-google-amazon-with-new-agentic-shopping-system)
- **OpenAI retreat, Digital Commerce 360 (March 6, 2026).** OpenAI is sidelining Instant Checkout in favor of checkout in merchants' ChatGPT apps (Target, The Knot, DoorDash, Instacart). ACP continues for discovery. No order numbers. Quote, OpenAI spokesperson: "Instant Checkout is moving to Apps, where purchases can happen more seamlessly." Source: Brian Warmoth, "OpenAI Shifts Checkout Plans in Agentic Commerce Strategy," Digital Commerce 360, March 6, 2026. [Source](https://digitalcommerce360.com/2026/03/06/openai-shifts-checkout-plans-agentic-commerce-strategy/)
- **OpenAI retreat, Shopifreaks citing The Information (March 9, 2026).** Instant Checkout launched in October 2025 with Etsy and Walmart and "slowly added a handful of Shopify merchants." OpenAI had not built systems to collect and remit state sales tax. Source: Paul Drecksler, "OpenAI Scales Back Its Integrated Commerce Plans," Shopifreaks, March 9, 2026. [Source](https://www.shopifreaks.com/openai-scales-back-its-integrated-commerce-plans/)
- **OpenAI retreat, Spree Commerce (March 6, 2026).** "Roughly 12 Shopify merchants" went live. Users browsed but rarely bought; conversion was described as "dismal." A 4% merchant fee was planned. Evidence: C (opinion piece citing The Information, Modern Retail, PYMNTS). Source: Mike Faber, "OpenAI Just Blinked: Nobody Seems to Want to Shop Inside ChatGPT," Spree Commerce, March 6, 2026. [Source](https://spreecommerce.org/openai-just-blinked-nobody-seems-to-want-to-shop-inside-chatgpt/)
- **Perplexity and PayPal Instant Buy (November 25, 2025).**
  - In-chat purchase for US users. The retailer is merchant of record.
  - PayPal fraud screening and purchase/seller protection apply.
  - Named merchants: Abercrombie & Fitch, Ashley Furniture, Fabletics, Adorama, Newegg. No merchant count.
  - Quote, Michelle Gill of PayPal: "the opening act of PayPal's innovation in commerce for the agentic era."
  - Source: PayPal, "PayPal and Perplexity Launch Instant Buy," press release, November 25, 2025. [Source](https://newsroom.paypal-corp.com/2025-11-PayPal-and-Perplexity-Launch-Instant-Buy)
- **Perplexity follow-up (February 2026).** Passkey one-click payment through PayPal; PayPal handles shipping, tracking and billing. No order or conversion numbers. Quote: "No tab switching or cart page navigation is required." Evidence: C. Source: Stellagent, "Perplexity and PayPal In-Chat Shopping," February 26, 2026. [Source](https://stellagent.ai/insights/perplexity-paypal-in-chat-shopping)
- **Google Universal Commerce Protocol (UCP) checkout.**
  - Announced at NRF on January 11, 2026. Went live in the US around February 11, 2026, with Etsy and Wayfair.
  - Available in AI Mode in Search and in the Gemini app. Payment through Google Pay, with shipping details from Google Wallet.
  - The merchant keeps merchant-of-record status.
  - Quote, Vidhya Srinivasan of Google: "In 2026, agentic commerce is no longer a concept — it's reality."
  - Evidence: C (aggregator citing PYMNTS, Retail Brew, Google Developers).
  - Source: Stellagent, "Google Agentic Commerce: Etsy, Wayfair," February 12, 2026. [Source](https://stellagent.ai/insights/google-agentic-commerce-etsy-wayfair)
- **Google Marketing Live (May 20, 2026).**
  - Announced Universal Cart across Search, Gemini and Maps; Google Pay checkout; Affirm and Klarna BNPL.
  - UCP checkout coming to Canada and Australia, then the UK. Hotel booking in AI Mode and food ordering in Maps "in the coming months."
  - Named merchants: Nike, Sephora, Target, Ulta Beauty, Walmart, Wayfair, Fenty, Steve Madden.
  - Most features were marked "soon." No numbers.
  - Quote: "the retailer always remains the merchant of record."
  - Evidence: A.
  - Source: Google, "How We're Helping Retailers Thrive with New Universal Commerce Protocol Features and AI Tools on Google," The Keyword, May 20, 2026. [Source](https://blog.google/products-and-platforms/products/shopping/shopping-updates-google-marketing-live)
- **Amazon Buy for Me (beta, April 2025).**
  - Amazon's agent completes checkout on a third-party brand's own website using the customer's encrypted name, address and payment details.
  - The confirmation comes from the brand. The brand handles delivery, returns, exchanges and service.
  - Subset of US users; brand count not disclosed.
  - The counterparty is an ordinary web checkout (A2API). The merchant may not know an agent is buying.
  - Quote, Amazon: trust and transparency are "a cornerstone for the success of AI agents."
  - Source: Bryan Wassel, "Amazon Tests 'Buy for Me' Agentic AI for Third-Party Sites," Retail Dive, April 10, 2025. [Source](https://www.retaildive.com/news/amazon-buy-for-me-agentic-ai-thirdparty-sites/745047/)
- **Mastercard Agent Pay, Australia (announced January 28, 2026).**
  - First authenticated agentic transactions in Australia, on real cards at real merchants.
  - Purchases: movie tickets from Event Cinemas (CBA debit card) and accommodation at Thredbo (Westpac credit card), executed by the Australian LLM "Matilda."
  - Agentic Tokens identify the transaction as agent-initiated. The user approves with biometrics, and a check confirms the purchase matches the instructions.
  - Quote, Mastercard to techAU: "there is no risk of the AI agent going rogue."
  - Evidence: C (aggregator citing a Mastercard APAC press release).
  - Source: Stellagent, "Mastercard Australia First AI Agent Payment," January 30, 2026. [Source](https://stellagent.ai/insights/mastercard-australia-first-ai-agent-payment)
- **Santander and Mastercard, Europe (March 2, 2026).**
  - First live agent payment in Europe, on regulated rails, through Agent Pay with Agentic Tokens, PayOS orchestration and Microsoft Azure OpenAI/Copilot Studio.
  - The agent worked within account-holder limits: spending caps, merchant-category restrictions.
  - Described as a pilot, "not yet a commercial rollout."
  - Quote: "This was not a sandbox demo."
  - Evidence: C.
  - Source: AI2.Work, "Santander and Mastercard Complete Europe's First Live AI Agent Payment," March 6, 2026. [Source](https://ai2.work/blog/santander-and-mastercard-complete-europe-s-first-live-ai-agent-payment)

### Inferences
- How the commitment works across consumer agentic checkout:
  - **Committed:** a retail order, which is a sales contract with the merchant, plus card or wallet authorization.
  - **Confirmed:** the user taps confirm, uses a passkey or biometrics, and the merchant sends an order confirmation.
  - **Revocable:** under the merchant's normal cancellation and return policy, plus card-network or PayPal chargeback and buyer protection.
  - **On failure:** the merchant of record is liable; the platform is not.
- The agent is an intermediary that forms the order. The legal counterparty stays the human shopper.
- OpenAI's retreat suggests that being the integrator for commitments (taxes, merchant onboarding, liability) is a real barrier. Platforms are moving toward having merchants own the checkout (apps, UCP, merchant of record) and are not taking on the commitment themselves.
- Card networks (Agentic Tokens) add a machine-verifiable label saying "this payment was agent-initiated within this mandate." That is the beginning of a conditional-payment layer.

### Gaps
- No platform (OpenAI, Perplexity, Google, Amazon) has published order counts, GMV, cancellation rates or return rates for agent-initiated purchases.
- Whether Amazon Buy for Me left beta was not verified.
- Visa Intelligent Commerce live transaction details were not captured (the Nuvei page failed to load).
- I did not verify the Mastercard and Santander announcements from their primary press releases.

---

## 5. Programmatic advertising: real-time bidding as the existing machine-to-machine commitment market; agentic ad buying in 2025–2026 (IAB Tech Lab, AdCP)

### Takeaway
Programmatic real-time bidding (OpenRTB) is the largest existing machine-to-machine commitment market: automated bidders commit to pay per impression in milliseconds. The industry is now adding LLM agents on two tracks:
- **AdCP** (launched October 2025, v3 in April 2026) handles agent-to-agent negotiation of media buys above the auction.
- **IAB Tech Lab's ARTF** (v1.0 final August 12, 2026) runs containerized agents inside the auction.

Documented AdCP buys have true agent counterparties on both sides, for example Scope3 buying from Magnite's seller agent, and Omnicom's ChatGPT agent buying from R2B2 for MAFRA. Volumes are tiny: about $1M disclosed by Apostra (formerly Scope3). Humans still approve insertion orders and creatives on the sell side.

### Cited Findings
- **AdCP launch (October 15, 2025).** Founding members: Yahoo, Optable, PubMatic, Scope3, Swivel, Triton Digital. At launch it covered audience activation and media buying. Members compare its intended role to OpenRTB's, and it is meant to start on existing programmatic pipes. Quote, Weather Company CPO Olesnevich: "Now we're able to represent the true value of those premium products." Source: Tim Cross-Kovoor, "Industry Coalition Ushers in Age of Agent-to-Agent Trading with Ad Context Protocol Launch," VideoWeek, October 15, 2025. [Source](https://videoweek.com/2025/10/15/industry-coalition-ushers-in-age-of-agent-to-agent-trading-with-ad-context-protocol-launch/)
- **AdCP mechanics and status (October 24, 2026).**
  - **Tasks:**
    - `get_products` (discovery)
    - `create_media_buy` (booking)
    - `get_media_buy_delivery` (reporting)
    - `sync_creatives`, `get_signals`/`activate_signal`, `sync_accounts`/`report_usage`
  - **Pricing:** ten models, including CPM, CPC, CPA and flat rate.
  - **v3 (April 22, 2026):**
    - Idempotency is mandatory on mutating calls so retries do not double-book.
    - Insertion-order approval has its own task lifecycle.
    - Human review is required for sensitive categories (housing, lending, employment, pharma), citing GDPR Art. 22 and the EU AI Act.
    - Async states: `completed`; `working` (about 120 s); `submitted` (hours or days, for example human sales review).
  - **3.3.0-beta (October 22, 2026):** discovery calls will no longer "create accounts or accept default terms on a buyer's behalf."
  - The 2.x line was deprecated August 1, 2026.
  - **Volume:** Apostra (formerly Scope3) disclosed about $1M in agentic campaign volume, much of it from one advertiser. The article says little money flows through AdCP as of October 2026. Google, Amazon, The Trade Desk and Microsoft are not founding members.
  - Quote, Shailley Singh of IAB Tech Lab: "MCP is a communication substrate; it does not reconcile their advertising semantics."
  - Source: Luís Rijo, "Ad Context Protocol," PPC Land, October 24, 2026. [Source](https://ppc.land/ad-context-protocol/)
- **Magnite seller agent (January 6, 2026).**
  - Embedded in SpringServe. Automates 1:1 insertion-order and PMP buying with buyer agents.
  - First AdCP test in December 2025 with Scope3 as buyer agent. MiQ says it set live one of the first AdCP buys and plans to scale through its MiQ Sigma trading agent in 2026.
  - No metrics. Status is "still early."
  - Quote: "far too early to predict outcomes."
  - Source: Magnite Team, "Why Magnite Built a Seller Agent — and What It Signals for AdCP," Magnite blog, January 6, 2026. [Source](https://www.magnite.com/blog/why-magnite-built-a-seller-agent-and-what-it-signals-for-adcp/)
- **PubMatic, Butler/Till and Clubtails (December 15, 2025).**
  - The agency submitted a natural-language brief through Anthropic's Claude.
  - PubMatic's agents, on its Activate "Agentic Buying" capability, interpreted the brief, built the media plan, set up and optimized a geo-targeted CTV campaign for Clubtails (Geloso Beverage Group).
  - No spend or results disclosed; results were promised for Q1 2026.
  - Quote, Kyle Dozeman of PubMatic: "agentic capabilities are already delivering real value in market."
  - Source: PubMatic, "PubMatic and Butler/Till Launch AdCP-Enabled Agentic AI Campaign Across CTV," Business Wire, December 15, 2025. [Source](https://www.businesswire.com/news/home/20251215976339/en/PubMatic-and-ButlerTill-Launch-AdCP-Enabled-Agentic-AI-Campaign-Across-)
- **First fully autonomous agentic ad buy in the Czech Republic (June 24, 2026).**
  - A buyer agent run by Omnicom Media (Czech) through ChatGPT dealt server-to-server with R2B2's AdCP/MCP sell-side gateway.
  - Bought ad space on publisher MAFRA for Skylink (part of Canal+). No DSP was involved.
  - MAFRA manually approved every campaign and creative before launch. Budget not disclosed.
  - Quote, R2B2 CTO Lukáš Alexandr: "Artificial intelligence and autonomous, agentic purchasing are the clear future of digital advertising."
  - Source: Luís Rijo, "Czech Republic Gets Its First Fully Autonomous AI Ad Buy," PPC Land, June 2026. [Source](https://ppc.land/czech-republic-gets-its-first-fully-autonomous-ai-ad-buy/)
- **IAB Tech Lab ARTF, v1.0 draft (November 13, 2025).**
  - Agentic RTB Framework v1.0 released for public comment.
  - It containerizes one company's code (for example a fraud-detection vendor) to run inside another's bidding infrastructure, cutting latency, as a path toward agentic buying.
  - Chalice tested its full model inside Index Exchange.
  - Quote, IAB Tech Lab CEO Anthony Katsur: the gains are a "rising tide for the industry."
  - Source: Joanna Gerber, "The IAB Tech Lab Releases Its First Framework for Agentic Ad Buying Standards," AdExchanger, November 13, 2025. [Source](https://adexchanger.com/platforms/the-iab-tech-lab-releases-its-first-framework-for-agentic-ad-buying-standards)
- **ARTF final (August 12, 2026).**
  - Containers receive parts of OpenRTB bid requests and propose "mutations" that the host may accept or reject.
  - Placed at the foundation of IAB Tech Lab's AAMP umbrella (February 2026).
  - Contributors: Index Exchange, Chalice, The Trade Desk, OpenX.
  - Deployments:
    - Bedrock Platform ran a full DSP bidder inside Index Exchange (April 21, 2026).
    - PubMatic opened its auction to partner models through Decision Fabric (June 1, 2026).
    - Magnite outlined two deployment routes (August 6, 2026).
  - AdCP sits above the auction; ARTF works inside it.
  - Quote: "ARTF validates the call, not the auction."
  - Source: PPC Land, "ARTF," September 4, 2026. [Source](https://ppc.land/artf/)

### Inferences
- RTB is the precedent: billions of daily machine-made commitments in which a winning bid is a commitment to pay for an impression that is actually served. Payment is conditional on delivery and settled later through the insertion-order and invoice chain. That is effectively the "conditional payment" tier at scale, built on ordinary contracts and not escrow. (This mechanism description is general industry knowledge. I did not capture a sourced RTB volume figure; see Gaps.)
- AdCP moves agent negotiation up from per-impression bids to campaign-level insertion-order commitments. Its design choices map to commitment safety:
  - idempotency to prevent duplicate commitments
  - `submitted` states for human approval holds
  - mandatory human review for regulated categories
  - (3.3) discovery calls no longer accept default terms on the buyer's behalf
- Advertising is the clearest production example where both parties are agents and the commitment is a priced media buy. A human sign-off on the seller side remains the norm.

### Gaps
- I did not capture a sourced current figure for OpenRTB bid volume (bid requests per day) or programmatic spend.
- No AdCP campaign has published performance results (the PubMatic/Clubtails Q1 2026 results were not found).
- I found no measured volume of LLM-agent-originated ad spend beyond Apostra's roughly $1M.

---

## 6. Travel and hospitality: agent bookings with airlines and hotels (Expedia, Booking, Sabre, Amadeus)

### Takeaway
Travel distributors have shipped agent-ready booking interfaces (Sabre agentic APIs and MCP server) and announced end-to-end agent booking: Sabre, PayPal and Mindtrip, with flights targeted for Q2 2026. Live agent-facing services in 2026 mostly cover search (Skyscanner in ChatGPT) and post-booking servicing (Malaysia Airlines "Mavis"). Expedia says AI-driven booking volume is small and flags fraud risk from agentic booking without strong consent controls. Documented agent-completed travel transactions are isolated payment-network showcases, such as the Thredbo accommodation booked through Mastercard Agent Pay.

### Cited Findings
- **Sabre, PayPal and Mindtrip (announced February 12, 2026).**
  - Mindtrip's conversational agent would search, book, pay and later handle changes through SabreMosaic APIs: 420+ airlines including low-cost carriers, and 2M+ lodging options.
  - PayPal would provide checkout, identity, buyer protection and Pay Later.
  - Flights targeted for Q2 2026; hotels to follow. Nothing confirmed live in the article.
  - Quote: the promise is "fewer handoffs to websites and fewer steps."
  - Source: AltexSoft, "Sabre, PayPal, Mindtrip Bring Bookings to AI Agent, Flights Due in Q2 2026," updated February 16, 2026. [Source](https://www.altexsoft.com/travel-industry-news/sabre-paypal-power-ai-bookings-flights-q2-2026/)
- **Sabre agentic APIs and MCP server.** Launched for real-time shopping, booking and servicing (flights, hotels, post-booking). No named customers. Quote, CPTO Garry Wiseman: "the smartest enterprise AI solution in travel." Source: PhocusWire (originally in BTN), "Sabre API Agentic AI MCP," n.d. [Source](https://www.phocuswire.com/sabre-api-agentic-ai-mcp)
- **OAG's March 2026 roundup.**
  - Malaysia Airlines' "Mavis" (built on Ada's platform, launched February 24, 2026) is live for booking management, check-in and status, and hands off to humans. The article does not say it sells tickets.
  - Skyscanner's ChatGPT app (February 27, 2026) does flight search only, in the UK and US.
  - Quote, Skyscanner's Piero Sierra: "beyond form-fills toward dynamic, answer-led experiences."
  - Source: OAG, "March 2026: The Month Agentic Travel Gets Real," March 5, 2026. [Source](https://www.oag.com/blog/march-2026-the-month-agentic-travel-gets-real)
- **Expedia (early 2026, after its Q4 2025 call and 10-K).**
  - Launched its ChatGPT app in October 2025. The CEO said AI-driven volume is currently small.
  - The 10-K warns agentic booking without strong consent controls could raise fraud risk.
  - Two-thirds of bookings start directly with Expedia brands.
  - Quote, CEO Ariane Gorin: "We're experimenting aggressively."
  - Source: GeekWire, "'We're Experimenting Aggressively': How Expedia Sees AI Reshaping Travel and Its Own Business," 2026 (exact date not shown). [Source](https://geekwire.com/2026/were-experimenting-aggressively-how-expedia-sees-ai-reshaping-travel-and-its-own-business)
- **Google.** Hotel booking in AI Mode was announced as coming "in the coming months" (May 20, 2026). [Source](https://blog.google/products-and-platforms/products/shopping/shopping-updates-google-marketing-live)
- **Mastercard Agent Pay.** An agent booked accommodation at Thredbo, Australia (January 2026). [Source](https://stellagent.ai/insights/mastercard-australia-first-ai-agent-payment)

### Inferences
- Travel bookings are the strongest consumer commitments: non-refundable fares and penalties. The live services stop at search and servicing, and transactional agent booking is still being announced. That pattern points to liability and fare-rule complexity as the bottleneck.
- The GDS layer (Sabre MCP) is becoming the machine-readable counterparty. An LLM agent talking to a GDS API is A2API; the airline's own systems are not agents.

### Gaps
- Whether Sabre/Mindtrip flight booking actually went live in Q2 2026 is unverified. The Sabre Q2 2026 earnings transcript failed to load.
- Amadeus and Booking Holdings agentic booking metrics were not researched (budget ran out).
- No agent-booked travel volumes from any OTA or GDS were found.

---

## 7. Data and compute markets: agents buying API calls, data and compute (Cloudflare pay-per-crawl, x402, Browserbase, Exa, OpenRouter)

### Takeaway
Machine-to-machine payment for web resources is live at scale in transaction count but tiny in value:
- x402 on Base: 138M cumulative transactions by Q3 2026 (Chainalysis), more than 87% under $0.10.
- About half of activity may be artificial (Artemis), and real daily settlement was estimated at about $28,000 (CoinDesk, cited by Forkast).

Cloudflare moved from pay-per-crawl (2025) to "Pay Per Use/answer" (July 2026). It also proposed a deferred x402 scheme that separates a signed commitment from later settlement, an early form of conditional or credit-based agent payment. AWS added x402 support to CloudFront and WAF in July 2026.

### Cited Findings
- **Cloudflare and Coinbase (September 23, 2025).**
  - Formed the x402 Foundation and added x402 to Cloudflare's Agents SDK and MCP.
  - x402 flow: request → 402 with amount and recipient → re-request with payment authorization header → facilitator verifies and settles → resource returned with payment-response header.
  - Pay-per-crawl (private beta) charges crawlers one aggregated fee per day by card or bank.
  - **Proposed deferred scheme:** the client signs the request with HTTP Message Signatures, the server returns 200 and attributes the charge, and settlement happens later (per day, per subscription or batched). No blockchain transaction happens at commitment time.
  - Cloudflare sites send "over a billion HTTP 402 response codes" a day.
  - Evidence: A.
  - Source: Will Allen, Cam Whiteside, Rohin Lohe, and Steve James, "Launching the x402 Foundation with Coinbase, and Support for x402 Transactions," Cloudflare Blog, September 23, 2025. [Source](https://blog.cloudflare.com/x402/)
- **Cloudflare pivot (July 1, 2026).**
  - Pay Per Crawl becomes "Pay Per Use."
  - Partners: Ceramic.ai, which pays publishers when content appears in search results, and You.com, which pays on demand for premium content "with no upfront commitment from either side."
  - No adoption, transaction or revenue figures.
  - Cloudflare had been merchant of record under the original pay-per-crawl.
  - Quote, article text: "Crawling is a poor proxy for value."
  - Source: Luís Rijo, "Cloudflare Stops Charging AI per Crawl and Starts Paying per Answer," PPC Land, July 2, 2026. [Source](https://ppc.land/cloudflare-stops-charging-ai-per-crawl-and-starts-paying-per-answer/)
- **Cloudflare default blocking (from September 15, 2026).** Default settings block "mixed-use" crawlers (search plus agent plus training) on ad-supported pages for new and free customers. No pay-per-crawl adoption figures. Quote, CEO Matthew Prince: "we must go further and act faster." Source: Sarah Perez, "Cloudflare's New Policy Pushes AI Companies to Pay for Publishers' Content," TechCrunch, July 1, 2026. [Source](https://techcrunch.com/2026/07/01/cloudflares-new-policy-pushes-ai-companies-to-pay-for-publishers-content/)
- **Chainalysis via Fortune (October 2026).** More than 138M cumulative x402 transactions on Base by Q3 2026, up from about 1,500 in mid-2025; more than 87% under $0.10. Real commerce is not separated from testing. Quote, Eric Jardine of Chainalysis: "You have this perfect combination of speed plus low cost to settle." Source: AI Weekly, "Chainalysis: 138M Base x402 Bot Payments, 87% Under 10 Cents," October 15, 2026, summarizing Fortune, October 14, 2026. [Source](https://aiweekly.co/alerts/chainalysis-138m-base-x402-bot-payments-87-under-10-cents)
- **Forkast (July 2026).**
  - 169M cumulative x402 transactions on Base as of July 2026; about $600M annualized volume across chains.
  - CoinDesk analysis puts real daily settlement near $28,000. Artemis estimates about 50% of transactions are artificial (self-dealing or wash).
  - AWS shipped x402 in CloudFront and WAF (July 2026).
  - The x402 Foundation launched April 2026 under the Linux Foundation, with Stripe and Visa as members.
  - Items bought: web pages, datasets, MCP tools.
  - Quote: "embedding the protocol into core infrastructure."
  - Evidence: C (AI-authored).
  - Source: Nolan Pratt [AI author], "The Giants Are Building on x402; the Transaction Count Is the Least Interesting Part," Forkast, July 10, 2026. [Source](https://forkast.news/the-giants-are-building-on-x402-the-transaction-count-is-the-least-interesting-part/)
- **Conflicts.**
  - Transaction counts: 169M (July 2026, Forkast) versus 138M (Q3 2026, Chainalysis). The difference likely comes from methodology or filtering.
  - Foundation formation: Cloudflare (September 2025) describes forming it with Coinbase, while Forkast says it launched April 2026 under the Linux Foundation. These may be announcement versus formal launch.

### Inferences
- x402 and Cloudflare's 402 flows are the only places where agents routinely complete binding payment with no human approving each transaction. The counterparty is an automated server, so the case is A2API. It is high-volume and low-value; most payments are fractions of a cent to $1, with value shifting toward $1+ payments.
- Cloudflare's deferred scheme is a design for credit-based commitment: a cryptographically signed promise to pay, settled later. It suits pay-per-use content and is a precursor to conditional payment. No production numbers exist for it.
- The pay-per-crawl to pay-per-answer pivot shows that per-fetch pricing failed to match value. Commitments are moving toward outcome-based triggers, paying when content is used in an answer.

### Gaps
- Browserbase, Exa paid search and OpenRouter were not researched (budget ran out).
- I found no adoption figures (publishers, paying AI companies, revenue) for Cloudflare Pay Per Crawl or Pay Per Use.
- I found no reliable split of x402 volume into genuine agent commerce versus testing or wash, beyond Artemis's rough 50% estimate.
- No production evidence of AP2 (Agent Payments Protocol) mandates beyond its 60+ supporting organizations.

---

## 8. Cross-case anatomy and pattern catalog: what is committed, how it is confirmed, whether it can be revoked, what happens on failure, and how strong the evidence is, ordered by commitment strength

### Takeaway
Ordered by commitment strength, production deployments cluster at the reservation and binding-agreement tiers in B2B (freight, procurement, ad buys) and at the payment tier in consumer checkout and machine micropayments (x402). Escrowed or conditional payment exists only as protocol designs (x402 deferred scheme, AP2 mandates, Agentic Tokens with mandate checks) or through traditional rails: card chargebacks, PayPal buyer protection, and RTB's pay-on-delivery invoicing. Verified agent-to-agent commitments where both sides are agents are confined to programmatic advertising (AdCP pilots) and machine payment protocols. Elsewhere the counterparty is a human or a conventional API.

### Cited Findings

**Pattern catalog, from weakest to strongest commitment.** Each row cites sources from sections 1–7.

| Tier | Use case and named deployment | Counterparty type | What is committed | Confirmation | Revocable? / failure path | Evidence |
|---|---|---|---|---|---|---|
| 1. Trigger/notification | C.H. Robinson tracking and truck-posting agents ([CHR 2025](https://www.chrobinson.com/en-us/about-us/newsroom/news/2025/ch-robinson-scales-fleet-of-ai-agents-past-30/)); HappyRobot check calls and ETA (DHL) ([Forkast 2026](https://forkast.news/happyrobot-wants-1-2-billion-to-run-your-freight-by-voice/)) | A2H / A2API | Status info, capacity posting | TMS sync | N/A | A / C |
| 1. Trigger/notification | Google Ask for Me info calls ([CX Today 2025](https://www.cxtoday.com/contact-center/google-launches-an-ai-agent-that-will-call-customer-service-for-you/)); GFS–Tyson A2A product search and sales tracking, pilot ([Google Cloud](https://cloud.google.com/customers/gordonfoodservice)) | A2H; **A2A (pilot)** | Information only | Summary to user | N/A | B / A |
| 2. Reservation/hold | C.H. Robinson Appointments Agent: 3,000+ a day across 43,000 locations ([CHR 2025](https://www.chrobinson.com/en-us/about-us/newsroom/news/2025/ch-robinson-scales-fleet-of-ai-agents-past-30/)) | A2API / A2H (facilities) | Dock appointment slot | Facility confirmation (mechanism not disclosed) | Reschedulable | A |
| 2. Reservation/hold | Duplex restaurant reservations, 2019 ([VentureBeat](https://venturebeat.com/ai/google-duplex-rolls-out-to-pixel-phones-in-43-states)); Gemini Call for Me tables and rescheduling, beta, September 2026 ([Techloy](https://www.techloy.com/geminis-call-for-me/)); Amplifon appointment scheduling on Agentforce ([CX Today](https://www.cxtoday.com/crm/agentforce-case-studies)) | A2H (possibly A2A if the business uses AI reception) | Table or appointment | Verbal confirmation; live transcript; user can step in | Cancellable; no-show norms | B |
| 2. Reservation/hold | AdCP `submitted` state awaiting human insertion-order approval ([PPC Land](https://ppc.land/ad-context-protocol/)) | **A2A** | Pending media buy | Seller-side human review | Can be rejected | B |
| 3. Binding agreement | Pactum: Walmart supplier agreements on price and payment terms; 64–68% closure; $140.5M largest deal; 87-second fastest ([Talking Logistics](https://talkinglogistics.com/2023/05/01/negotiating-with-a-chatbot-a-walmart-procurement-case-study/); [Pactum 2025](https://www.accessnewswire.com/newsroom/en/business-and-professional-services/pactum-secures-54-million-in-series-c-funding-to-scale-agentic-a-1036166)); Maersk trucker lane agreements ([FreightWaves 2022](https://www.freightwaves.com/news/pactum-using-ai-to-revolutionize-shipping-contract-negotiations)) | A2H (human supplier) | Contract terms (price, payment days, termination) | Supplier accepts in chat; agreement signed | Contract law; renegotiation | A / B |
| 3. Binding agreement | C.H. Robinson quotes (1M+) and order acceptance (about 5,500 a day; under 90 s) ([CHR](https://www.chrobinson.com/en-us/about-us/newsroom/news/2025/ch-robinson-scales-fleet-of-ai-agents-past-30/); [FreightWaves](https://www.freightwaves.com/news/c-h-robinson-delivers-on-ai-but-investors-still-skeptical)) | A2H (shipper email) | Priced offer; load tender acceptance | Email or TMS confirmation | Fall-off handled by human ops | A / B |
| 3. Binding agreement | HappyRobot at Circle: rate negotiation plus booking, 18% zero-touch ([HappyRobot](https://www.happyrobot.ai/customer-story/circle)); Hey Bubba carrier-side multi-broker negotiation ([FreightWaves 2026](https://freightwaves.com/news/5-hours-to-book-a-truck-ai-is-coming-for-that)) | A2H (likely some unreported A2A) | Load at an agreed rate | Verbal plus rate confirmation synced to TMS | Industry fall-off norms; fraud checks | C / B |
| 3. Binding agreement | AdCP media buys: Scope3 to Magnite (December 2025); MiQ; Butler/Till via Claude to PubMatic (CTV); Omnicom via ChatGPT to R2B2/MAFRA (June 2026) ([Magnite](https://www.magnite.com/blog/why-magnite-built-a-seller-agent-and-what-it-signals-for-adcp/); [Business Wire](https://www.businesswire.com/news/home/20251215976339/en/PubMatic-and-ButlerTill-Launch-AdCP-Enabled-Agentic-AI-Campaign-Across-); [PPC Land](https://ppc.land/czech-republic-gets-its-first-fully-autonomous-ai-ad-buy/)) | **A2A** | Insertion order or media buy at a priced model | `create_media_buy` plus human approval of creatives and IO | Idempotency; IO terms | A / B |
| 4. Payment | Klarna refunds and returns (2024) ([CX Today](https://www.cxtoday.com/contact-center/klarna-claims-its-new-ai-assistant-does-the-work-of-700-full-time-agents/)) | A2H (consumer) | Money returned to customer | In-chat resolution | Internal policy | B |
| 4. Payment | OpenAI Instant Checkout (about 12 Shopify merchants; moved to Apps) ([Spree](https://spreecommerce.org/openai-just-blinked-nobody-seems-to-want-to-shop-inside-chatgpt/); [DC360](https://digitalcommerce360.com/2026/03/06/openai-shifts-checkout-plans-agentic-commerce-strategy/)); Perplexity/PayPal Instant Buy ([PayPal](https://newsroom.paypal-corp.com/2025-11-PayPal-and-Perplexity-Launch-Instant-Buy)); Google UCP with Etsy and Wayfair ([Stellagent](https://stellagent.ai/insights/google-agentic-commerce-etsy-wayfair)); Amazon Buy for Me ([Retail Dive](https://www.retaildive.com/news/amazon-buy-for-me-agentic-ai-thirdparty-sites/745047/)) | A2API (merchant checkout or API) | Retail order plus card or wallet authorization | User confirm (passkey or biometric); merchant order email | Merchant returns policy; chargeback; PayPal protection; merchant of record liable | A / B / C |
| 4. Payment | Mastercard Agent Pay: Event Cinemas, Thredbo (Australia, January 2026); Santander pilot (Europe, March 2026) ([Stellagent](https://stellagent.ai/insights/mastercard-australia-first-ai-agent-payment); [AI2.Work](https://ai2.work/blog/santander-and-mastercard-complete-europe-s-first-live-ai-agent-payment)) | A2API | Card payment tagged with an Agentic Token | Biometric approval; instruction-match check | Card dispute rights | C |
| 4. Payment | x402 per-request payments: 138M+ on Base by Q3 2026 ([AI Weekly/Fortune](https://aiweekly.co/alerts/chainalysis-138m-base-x402-bot-payments-87-under-10-cents)); Cloudflare pay-per-crawl, daily aggregated billing ([Cloudflare](https://blog.cloudflare.com/x402/)) | **A2API (automated server)** | Micro-payment for resource | Payment-response header; on-chain settlement | Generally final (stablecoin); none for crawl beyond billing | A / C |
| 5. Escrowed/conditional payment | x402 "deferred" scheme: signed commitment now, settle later; proposed, not in production ([Cloudflare](https://blog.cloudflare.com/x402/)); AP2 (60+ supporting organizations, no production evidence) ([Linux Foundation](https://www.linuxfoundation.org/press/a2a-protocol-surpasses-150-organizations-lands-in-major-cloud-platforms-and-sees-enterprise-production-use-in-first-year)) | A2API / A2A (design) | Promise to pay, attributable to a signing key | HTTP Message Signature | Settlement-time dispute (undefined) | A (design only) |
| 5. Conditional payment (legacy analog) | OpenRTB auctions: pay only for impressions served; invoiced later. ARTF containers mutate bids inside auctions ([PPC Land ARTF](https://ppc.land/artf/)) | A2A (algorithmic, not LLM) | Price per impression | Win notice / impression served | IVT/fraud clawbacks via IO terms | B (mechanism); volume unsourced |

**Chicago-style bibliography (sources cited above, alphabetical by author or organization).** Accessed October 29, 2026 unless noted.
- AgentMarketCap. "A2A Protocol Six Months In: What Adobe, Microsoft, SAP, and ServiceNow Are Actually Building." April 6, 2026. https://agentmarketcap.ai/blog/2026/04/06/a2a-protocol-enterprise-adoption-adobe-microsoft-sap-servicenow.
- AI Weekly. "Chainalysis: 138M Base x402 Bot Payments, 87% Under 10 Cents." October 15, 2026. https://aiweekly.co/alerts/chainalysis-138m-base-x402-bot-payments-87-under-10-cents.
- AI2.Work. "Santander and Mastercard Complete Europe's First Live AI Agent Payment." March 6, 2026. https://ai2.work/blog/santander-and-mastercard-complete-europe-s-first-live-ai-agent-payment.
- Allen, Will, Cam Whiteside, Rohin Lohe, and Steve James. "Launching the x402 Foundation with Coinbase, and Support for x402 Transactions." *Cloudflare Blog*, September 23, 2025. https://blog.cloudflare.com/x402/.
- AltexSoft. "Sabre, PayPal, Mindtrip Bring Bookings to AI Agent, Flights Due in Q2 2026." Updated February 16, 2026. https://www.altexsoft.com/travel-industry-news/sabre-paypal-power-ai-bookings-flights-q2-2026/.
- Britt, Hugo. "The State of AI Negotiation Tools in 2026." Una, March 4, 2026. https://una.com/resources/article/the-state-of-ai-negotiation-tools-in-2026/.
- C.H. Robinson. "C.H. Robinson Scales Fleet of AI Agents Past 30." June 12, 2025. https://www.chrobinson.com/en-us/about-us/newsroom/news/2025/ch-robinson-scales-fleet-of-ai-agents-past-30/.
- Carter, Rebekah. "10 Agentforce Case Studies, and What We Learned from Them." *CX Today*, July 22, 2025. https://www.cxtoday.com/crm/agentforce-case-studies.
- Chivumnovu, Ogbonda. "Gemini's Call for Me." *Techloy*, September 25, 2026. https://www.techloy.com/geminis-call-for-me/.
- Cross-Kovoor, Tim. "Industry Coalition Ushers in Age of Agent-to-Agent Trading with Ad Context Protocol Launch." *VideoWeek*, October 15, 2025. https://videoweek.com/2025/10/15/industry-coalition-ushers-in-age-of-agent-to-agent-trading-with-ad-context-protocol-launch/.
- Drecksler, Paul. "OpenAI Scales Back Its Integrated Commerce Plans." *Shopifreaks*, March 9, 2026. https://www.shopifreaks.com/openai-scales-back-its-integrated-commerce-plans/.
- Ellison, Dana [AI-generated author]. "HappyRobot Wants $1.2 Billion to Run Your Freight by Voice." *Forkast*, August 20, 2026. https://forkast.news/happyrobot-wants-1-2-billion-to-run-your-freight-by-voice/.
- Faber, Mike. "OpenAI Just Blinked: Nobody Seems to Want to Shop Inside ChatGPT." Spree Commerce, March 6, 2026. https://spreecommerce.org/openai-just-blinked-nobody-seems-to-want-to-shop-inside-chatgpt/.
- Fingas, Jon. "Walmart's Suppliers Would Rather Negotiate with AI than a Human." *Engadget*, April 28, 2023. https://www.engadget.com/walmarts-suppliers-would-rather-negotiate-with-ai-than-a-human-162131831.html.
- Fisher, Rhys. "Klarna Claims Its New AI Assistant Does the Work of 700 Full-Time Agents." *CX Today*, February 29, 2024. https://www.cxtoday.com/contact-center/klarna-claims-its-new-ai-assistant-does-the-work-of-700-full-time-agents/.
- FreightWaves Staff. "5 Hours to Book a Truck? AI Is Coming for That." *FreightWaves*, September 28, 2026. https://freightwaves.com/news/5-hours-to-book-a-truck-ai-is-coming-for-that.
- GeekWire. "'We're Experimenting Aggressively': How Expedia Sees AI Reshaping Travel and Its Own Business." 2026. https://geekwire.com/2026/were-experimenting-aggressively-how-expedia-sees-ai-reshaping-travel-and-its-own-business.
- Gerber, Joanna. "The IAB Tech Lab Releases Its First Framework for Agentic Ad Buying Standards." *AdExchanger*, November 13, 2025. https://adexchanger.com/platforms/the-iab-tech-lab-releases-its-first-framework-for-agentic-ad-buying-standards.
- Glukhov, Rost. "Google A2A Protocol in 2026: Adoption, Hype, and Reality." June 24, 2026. https://www.glukhov.org/ai-systems/comparisons/a2a-protocol-2026-adoption/.
- Gonzalez, Adrian. "Negotiating With A Chatbot: A Walmart Procurement Case Study." *Talking Logistics*, May 1, 2023. https://talkinglogistics.com/2023/05/01/negotiating-with-a-chatbot-a-walmart-procurement-case-study/.
- Google. "How We're Helping Retailers Thrive with New Universal Commerce Protocol Features and AI Tools on Google." *The Keyword*, May 20, 2026. https://blog.google/products-and-platforms/products/shopping/shopping-updates-google-marketing-live.
- Google Cloud. "Gordon Food Service." Customer story, n.d. https://cloud.google.com/customers/gordonfoodservice.
- HappyRobot. "Circle Logistics." Customer story, n.d. https://www.happyrobot.ai/customer-story/circle.
- HappyRobot. "MODE Global." Customer story, n.d. https://happyrobot.ai/customer-story/mode.
- HumanProgress. "Contract Negotiation Bots Could Soon Be on Both Sides of the Table." November 11, 2024 (republished from *IEEE Spectrum*). https://humanprogress.org/contract-negotiation-bots-could-soon-be-on-both-sides-of-the-table/.
- Keelvar. "Newport Tank Containers Frees Up 200+ Hours in Ocean Freight Sourcing with Keelvar + Xeneta." Success story, n.d. https://www.keelvar.com/success-stories/newport-tank-containers-ocean-freight-sourcing.
- Linux Foundation. "A2A Protocol Surpasses 150 Organizations, Lands in Major Cloud Platforms, and Sees Enterprise Production Use in First Year." Press release, April 9, 2026. https://www.linuxfoundation.org/press/a2a-protocol-surpasses-150-organizations-lands-in-major-cloud-platforms-and-sees-enterprise-production-use-in-first-year.
- Magnite Team. "Why Magnite Built a Seller Agent — and What It Signals for AdCP." Magnite blog, January 6, 2026. https://www.magnite.com/blog/why-magnite-built-a-seller-agent-and-what-it-signals-for-adcp/.
- Mahoney, Noi. "Pactum Using AI to Revolutionize Shipping Contract Negotiations." *FreightWaves*, June 22, 2022. https://www.freightwaves.com/news/pactum-using-ai-to-revolutionize-shipping-contract-negotiations.
- MarketBeat. "Transcript: Salesforce Q2 Earnings Call Highlights." August 26, 2026. https://www.marketbeat.com/instant-alerts/transcript-salesforce-q2-earnings-call-highlights-2026-08-26/.
- MIT Sloan Management Review. "Procurement in the Age of Automation." n.d. (c. 2023). https://sloanreview.mit.edu/article/procurement-in-the-age-of-automation.
- Mitchell, Charlie. "Google Launches an AI Agent That Will Call Customer Service for You." *CX Today*, February 3, 2025. https://www.cxtoday.com/contact-center/google-launches-an-ai-agent-that-will-call-customer-service-for-you/.
- Modern Distribution Management. "Walmart Consolidating AI Agents into 4 'Super Agents.'" July 24 [2025]. https://www.mdm.com/news/technology/ai/walmart-consolidating-ai-agents-into-4-super-agents/.
- NEC. "NEC's Automated Negotiation AI Recognized as a Use Case in Gartner Research." Press release, April 9, 2026. https://www.nasdaq.com/press-release/necs-automated-negotiation-ai-recognized-use-case-gartnerr-research-2026-04-10.
- O'Kane, Sean. "Uber Freight Bets Big on AI Tools to Grow Its Business." *TechCrunch*, May 21, 2025. https://techcrunch.com/2025/05/21/uber-freight-bets-big-on-ai-tools-to-grow-its-business.
- OAG. "March 2026: The Month Agentic Travel Gets Real." March 5, 2026. https://www.oag.com/blog/march-2026-the-month-agentic-travel-gets-real.
- Pactum. "Pactum Secures $54 Million in Series C Funding to Scale Agentic AI in Procurement." ACCESS Newswire, June 9, 2025. https://www.accessnewswire.com/newsroom/en/business-and-professional-services/pactum-secures-54-million-in-series-c-funding-to-scale-agentic-a-1036166.
- PayPal. "PayPal and Perplexity Launch Instant Buy." Press release, November 25, 2025. https://newsroom.paypal-corp.com/2025-11-PayPal-and-Perplexity-Launch-Instant-Buy.
- Perez, Sarah. "Cloudflare's New Policy Pushes AI Companies to Pay for Publishers' Content." *TechCrunch*, July 1, 2026. https://techcrunch.com/2026/07/01/cloudflares-new-policy-pushes-ai-companies-to-pay-for-publishers-content/.
- PhocusWire. "Sabre API Agentic AI MCP." n.d. (originally in *Business Travel News*). https://www.phocuswire.com/sabre-api-agentic-ai-mcp.
- PhoneArena. "Google's 'Ask for Me' Is Ready to Call Some Stores for You to Get Prices and Availability." n.d. https://www.phonearena.com/news/googles-ask-for-me-is-ready-to-make-calls-for-you_id172335.
- PPC Land. "ARTF." September 4, 2026. https://ppc.land/artf/.
- Pratt, Nolan [AI-generated author]. "The Giants Are Building on x402; the Transaction Count Is the Least Interesting Part." *Forkast*, July 10, 2026. https://forkast.news/the-giants-are-building-on-x402-the-transaction-count-is-the-least-interesting-part/.
- PubMatic. "PubMatic and Butler/Till Launch AdCP-Enabled Agentic AI Campaign Across CTV." *Business Wire*, December 15, 2025. https://www.businesswire.com/news/home/20251215976339/en/PubMatic-and-ButlerTill-Launch-AdCP-Enabled-Agentic-AI-Campaign-Across-.
- PYMNTS. "Walmart Reportedly Finds 75% of Vendors Prefer Negotiating With Chatbot." April 2023. https://www.pymnts.com/news/artificial-intelligence/2023/walmart-finds-75-percent-vendors-prefer-negotiating-with-chatbot/partial/.
- Regan, Gabe. "The Agentic AI Caller Problem." Reality Defender, June 17, 2026. https://www.realitydefender.com/insights/agentic-ai-caller-problem.
- Rijo, Luís. "Ad Context Protocol." *PPC Land*, October 24, 2026. https://ppc.land/ad-context-protocol/.
- Rijo, Luís. "Cloudflare Stops Charging AI per Crawl and Starts Paying per Answer." *PPC Land*, July 2, 2026. https://ppc.land/cloudflare-stops-charging-ai-per-crawl-and-starts-paying-per-answer/.
- Rijo, Luís. "Czech Republic Gets Its First Fully Autonomous AI Ad Buy." *PPC Land*, June 2026. https://ppc.land/czech-republic-gets-its-first-fully-autonomous-ai-ad-buy/.
- SAP Architecture Center. "Microsoft Copilot Integration with Joule Agents." n.d. https://architecture.learning.sap.com/docs/ref-arch/a2c0f1.
- ServiceNow. "AI Agent Fabric." Product page, n.d. https://www.servicenow.com/platform/ai-agent-fabric.html.
- Sharkey, Grace. "C.H. Robinson Delivers on AI, but Investors Still Skeptical." *FreightWaves*, April 16, 2025. https://www.freightwaves.com/news/c-h-robinson-delivers-on-ai-but-investors-still-skeptical.
- Smith, Tom. "With Latest Agentic AI Products, ServiceNow Embraces Third-Party Platforms, Data Sources." *Cloud Wars*, May 7, 2025. https://cloudwars.com/cloud/with-latest-agentic-ai-products-servicenow-embraces-third-party-platforms-data-sources/.
- Stellagent. "Google Agentic Commerce: Etsy, Wayfair." February 12, 2026. https://stellagent.ai/insights/google-agentic-commerce-etsy-wayfair.
- Stellagent. "Mastercard Australia First AI Agent Payment." January 30, 2026. https://stellagent.ai/insights/mastercard-australia-first-ai-agent-payment.
- Stellagent. "Perplexity and PayPal In-Chat Shopping." February 26, 2026. https://stellagent.ai/insights/perplexity-paypal-in-chat-shopping.
- TechCrunch. "OpenAI Takes On Google, Amazon with New Agentic Shopping System." September 29, 2025. https://techcrunch.com/2025/09/29/openai-takes-on-google-amazon-with-new-agentic-shopping-system.
- Warmoth, Brian. "OpenAI Shifts Checkout Plans in Agentic Commerce Strategy." *Digital Commerce 360*, March 6, 2026. https://digitalcommerce360.com/2026/03/06/openai-shifts-checkout-plans-agentic-commerce-strategy/.
- Wassel, Bryan. "Amazon Tests 'Buy for Me' Agentic AI for Third-Party Sites." *Retail Dive*, April 10, 2025. https://www.retaildive.com/news/amazon-buy-for-me-agentic-ai-thirdparty-sites/745047/.
- Wiggers, Kyle. "Google Duplex Rolls Out to Pixel Phones in 43 States." *VentureBeat*, March 6, 2019. https://venturebeat.com/ai/google-duplex-rolls-out-to-pixel-phones-in-43-states.
- Wolf, Connor D. "C.H. Robinson Expands AI Agents Across Shipment Life Cycle." *Transport Topics*, April 16, 2025. https://www.ttnews.com/articles/ch-robinson-ai-agents.
- Youngdahl, E. William, Shail H. Patel, Megha R. Shah, and Addison G. Sutton. *Pactum's AI in Contract Negotiations: Walmart and Maersk*. Case TB0756. Thunderbird School of Global Management / Harvard Business Publishing, February 17, 2025. https://store.hbr.org/product/pactum-s-ai-in-contract-negotiations-walmart-and-maersk/TB0756.

### Inferences
- **Commitment strength and counterparty type are inversely related in today's deployments.** The strongest bespoke commitments (multi-million-dollar supplier contracts, freight bookings) are made with humans. True agent-to-agent exchanges are either low-value machine payments (x402) or human-gated media buys (AdCP).
- **Four recurring safety mechanisms:**
  1. **Delegated envelopes:** Walmart-set budgets for Pactum; spending caps and merchant-category limits for Agent Pay.
  2. **Explicit confirmation steps:** passkey or biometric checkout; MAFRA approving every creative.
  3. **Idempotency and async approval states:** AdCP v3.
  4. **Merchant-of-record liability:** liability stays with an existing legal entity.
- **No case found where failure handling is native to agents.** There is no agent-level dispute, rollback or escrow release in production. Revocation always falls back to existing institutions: contract law, card chargebacks, PayPal protection, return policies, IO terms.
- **Evidence quality is weakest for the newest, most agent-to-agent claims.** A2A production claims, Forkast/Stellagent aggregations and x402 volumes are less reliable. The strongest evidence is older and covers agent-to-human cases: Pactum/Walmart 2022–2023, C.H. Robinson 2025, Klarna 2024.

### Gaps
- Insurance, B2B data exchange beyond GFS/Tyson, Workday, Oracle, Booking Holdings, Amadeus, Fairmarkit, Zip, Browserbase, Exa, OpenRouter and prior authorization were not researched to production-case depth before the search budget ran out. A follow-up pass should target these.
- No source gave failure or reversal rates (cancellations, disputes, fall-offs) for agent-made commitments in any sector.
- Verbatim quotes and some figures came through automated extraction. The primary HBR (November 2022) and Bloomberg (April 26, 2023) Walmart articles could not be fetched directly, so their numbers rest on secondary reports.
