// The public demo's judge panel: live pinned models from two families when the three model variables are
// set as Worker secrets, within a daily cap on live judge calls; scripted fake judges otherwise. The cap is the
// spending limit for the public faucet: past it, panels are scripted for the rest of the UTC day, and their
// verdicts carry the fake-judge mark, so a record never passes scripted output for a model's.
import { liveJudges, liveRegistry, LIVE_REGISTRY_URI, markedFake, markerFake, missingLiveEnv, placeholderRegistry, type JudgeUsage, type TestAdjudicatorOptions } from '@holdback/adjudicator';
import type { WorldStorage } from './storage.js';

export type JudgeProvider = NonNullable<TestAdjudicatorOptions['provider']>;
type Registry = NonNullable<TestAdjudicatorOptions['registry']>;

/** Live judge calls a day across the whole demo, unless LIVE_JUDGE_CALLS_PER_DAY says otherwise. */
export const DEFAULT_LIVE_CALLS_PER_DAY = 30;
const PLACEHOLDER_REGISTRY_URI = 'file:///config/judges.yaml';

interface Day {
  day: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
}

/** Today's live calls and tokens, kept in world storage under `lj:<UTC date>`. */
export class JudgeBudget {
  private today: Day | undefined;
  private dirty = false;

  constructor(
    private readonly storage: WorldStorage,
    readonly perDay: number,
    private readonly now: () => number,
  ) {}

  private async load(): Promise<Day> {
    const day = new Date(this.now()).toISOString().slice(0, 10);
    if (this.today?.day !== day) this.today = (await this.storage.get<Day>(`lj:${day}`)) ?? { day, calls: 0, inputTokens: 0, outputTokens: 0 };
    return this.today;
  }

  async used(): Promise<Day> {
    return { ...(await this.load()) };
  }

  /** A day's live calls and tokens: today's as counted so far, another day's from storage. */
  async on(day: string): Promise<Day> {
    if (this.today?.day === day) return { ...this.today };
    return (await this.storage.get<Day>(`lj:${day}`)) ?? { day, calls: 0, inputTokens: 0, outputTokens: 0 };
  }

  async remaining(): Promise<number> {
    return Math.max(0, this.perDay - (await this.load()).calls);
  }

  /** Takes one call from today's budget; false when none is left. */
  async take(): Promise<boolean> {
    const d = await this.load();
    if (d.calls >= this.perDay) return false;
    d.calls++;
    this.dirty = true;
    return true;
  }

  usage(u: JudgeUsage): void {
    if (!this.today) return;
    this.today.inputTokens += u.inputTokens;
    this.today.outputTokens += u.outputTokens;
    this.dirty = true;
  }

  async flush(): Promise<void> {
    if (!this.dirty || !this.today) return;
    this.dirty = false;
    await this.storage.put({ [`lj:${this.today.day}`]: { ...this.today } });
  }
}

export interface PanelConfig {
  live: boolean;
  registry: Registry;
  registryUri: string;
  /** The live-judging variables that are missing, by name (empty when live). */
  missing: string[];
  /** What every adjudicator calls: live while `allowLive` is set and the budget lasts, scripted otherwise. */
  provider: JudgeProvider;
  budget: JudgeBudget;
  /** Set before each adjudicator pass: live only when today's budget holds a whole panel. */
  allowLive: boolean;
}

export interface PanelOptions {
  env: Readonly<Record<string, string | undefined>>;
  storage: WorldStorage;
  now: () => number;
  /** Stands in for the live models (tests). */
  judgeProvider?: JudgeProvider;
  liveCallsPerDay?: number;
}

/** Live when a stand-in is given or all three model variables are set; scripted otherwise. */
export function panelConfig(o: PanelOptions): PanelConfig {
  const fromEnv = Number(o.env['LIVE_JUDGE_CALLS_PER_DAY']);
  const perDay = o.liveCallsPerDay ?? (Number.isSafeInteger(fromEnv) && fromEnv >= 0 && o.env['LIVE_JUDGE_CALLS_PER_DAY'] ? fromEnv : DEFAULT_LIVE_CALLS_PER_DAY);
  const budget = new JudgeBudget(o.storage, perDay, o.now);
  const scripted = markedFake(markerFake());
  const live = o.judgeProvider ? { ok: true as const, value: o.judgeProvider } : liveJudges(o.env, { onUsage: (u) => budget.usage(u) });
  if (!live.ok) {
    return { live: false, registry: placeholderRegistry(), registryUri: PLACEHOLDER_REGISTRY_URI, missing: missingLiveEnv(o.env), provider: scripted, budget, allowLive: false };
  }
  const cfg: PanelConfig = {
    live: true,
    registry: liveRegistry(),
    registryUri: LIVE_REGISTRY_URI,
    missing: [],
    budget,
    allowLive: false,
    provider: {
      complete: async (r) => ((cfg.allowLive && (await budget.take())) ? live.value.complete(r) : scripted.complete(r)),
    },
  };
  return cfg;
}
