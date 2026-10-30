import { validateExamples } from './spec.mjs';

const results = validateExamples();
for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.file}${r.ok ? '' : `\n     ${r.errors.join('\n     ')}`}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} examples valid`);
process.exit(failed ? 1 : 0);
