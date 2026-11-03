import { validateExamples } from './spec.mjs';
import { checkOpenApiDocument } from './openapi.mjs';

const results = validateExamples();
for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.file}${r.ok ? '' : `\n     ${r.errors.join('\n     ')}`}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} examples valid`);

// spec/openapi.json is fresh, its references resolve, and every schema in it compiles under Ajv strict.
const openapi = checkOpenApiDocument();
console.log(`${openapi.ok ? 'ok  ' : 'FAIL'} spec/openapi.json${openapi.ok ? ` (${openapi.summary})` : `\n     ${openapi.errors.join('\n     ')}`}`);

process.exit(failed || !openapi.ok ? 1 : 0);
