// The source `pnpm demo` uses: SimChain wherever T-012 has a runner, the labeled stand-in elsewhere.
// Beat 7 is all stand-in. Beat 6 is mixed: the injection half (stand-in, each event marked) then the
// hidden-tags half measured on SimChain, its times shifted to start after the stand-in's.
import type { BeatTranscript, EventSource } from '../transcript/types.js';
import { simchainSource, SIMCHAIN_NOTE } from './simchain.js';
import { BEAT_6_SUMMARY, BEAT_6_TITLE, STAND_IN_NOTE, standInSource } from './stand-in.js';

export function demoSource(): EventSource {
  const sim = simchainSource();
  const stand = standInSource();
  const beats = [...new Set([...sim.beats(), ...stand.beats()])].sort((a, b) => a - b);
  return {
    name: 'simchain + stand-in',
    beats: () => beats,
    run: async (beat): Promise<BeatTranscript> => {
      if (beat === 6) {
        const injection = await stand.run(6);
        const tags = await sim.run(6);
        const scripted = injection.events.filter((e) => e.kind !== 'balances').map((e) => ({ ...e, standIn: true as const }));
        const offset = (scripted.at(-1)?.atMs ?? 0) + 1;
        return {
          ...tags,
          title: BEAT_6_TITLE,
          summary: BEAT_6_SUMMARY,
          source: {
            kind: 'mixed',
            note: `the first delivery (base64 injection, events marked stand-in) is a ${STAND_IN_NOTE} The second delivery (hidden tag characters) is ${SIMCHAIN_NOTE} Its times start ${offset} ms in, after the stand-in's.`,
          },
          events: [...scripted, ...tags.events.map((e) => ({ ...e, atMs: e.atMs + offset }))],
        };
      }
      if (sim.beats().includes(beat)) return sim.run(beat);
      return stand.run(beat);
    },
  };
}
