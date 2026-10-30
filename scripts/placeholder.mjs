// Stand-in for commands that later tasks implement. Exits 0 so CI stays green on the empty skeleton.
const [command, task] = process.argv.slice(2);
console.log(`pnpm ${command}: not implemented yet (placeholder until ${task}).`);
