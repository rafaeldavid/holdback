// A scripted stand-in for the Agent SDK's query(), for `run.mjs --dry-run <script.json>` (T-370). It plays a fixed
// script through the harness's own loop: the init message, each tool request through the harness's canUseTool, the
// PreToolUse and Stop hooks, the tool results and the result message. No model, no key, no network, and no SDK
// import, so CI runs the harness end to end and checks the run file it writes.
//
// The script: { prompt, defaultEffort, init, turns: [{ steps: [{ tool, input, result, ask }], result }] }. A step with
// `ask: false` runs without a permission request, as an allowed read-only tool would. Each turn after the first waits
// for the harness's chat reply.

/** Returns a query() that plays `script`. */
export function scriptedQuery(script) {
  return ({ prompt, options }) => {
    let closed = false;
    const effort = () => ({ effort: { level: options.effort ?? script.defaultEffort ?? null } });
    const hooks = async (name) => {
      for (const matcher of options.hooks?.[name] ?? []) for (const fn of matcher.hooks ?? []) await fn(effort());
    };
    async function* play() {
      const inbox = prompt[Symbol.asyncIterator]();
      for (const [n, turn] of (script.turns ?? []).entries()) {
        const next = await inbox.next();
        if (next.done || closed) return;
        if (n === 0) yield { ...script.init, type: 'system', subtype: 'init' };
        for (const [i, step] of (turn.steps ?? []).entries()) {
          if (closed) return;
          const id = `toolu_scripted_${n}_${i}`;
          yield { type: 'assistant', message: { content: [{ type: 'tool_use', id, name: step.tool, input: step.input ?? {} }] } };
          await hooks('PreToolUse');
          let text = String(step.result ?? '');
          if (step.ask !== false) {
            const answer = await options.canUseTool(step.tool, step.input ?? {}, { toolUseID: id, signal: new AbortController().signal });
            if (answer.behavior !== 'allow') text = String(answer.message ?? 'denied');
          }
          yield { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: text }] } };
        }
        await hooks('Stop');
        yield { ...turn.result, type: 'result' };
      }
    }
    const run = play();
    return Object.assign(run, {
      interrupt: async () => {
        closed = true;
      },
      close: () => {
        closed = true;
      },
    });
  };
}
