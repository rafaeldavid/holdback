// The two validator sets the boundary parsers (parse.ts) check against, built from the code in
// validators.generated.ts, which is compiled ahead of time from spec/schemas (T-233). Building a set creates plain
// functions and generates no code, so it is cheap at a Worker's start-up and allowed in a request.
//
// One set reads date-time as a signable timestamp (for everything an agent signs), the other as the schema's
// ordinary date-time (event log, read model, judgment record, registrations). Both run the same code; only the
// formats differ. The generated code calls `uri` as a function and `date-time` through `validate`.
import formatsModule from 'ajv-formats/dist/formats.js';
import { schemaValidators, type SchemaValidator } from './validators.generated.js';

export type { SchemaValidator };

// Signed values are encoded as uint64 Unix seconds, so a signed timestamp must be an exact RFC 3339
// instant in whole seconds, at or after 1970, that Date can represent. The schema's date-time is wider.
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
export function signedTimestamp(s: string): boolean {
  const ms = Date.parse(s);
  return RFC3339.test(s) && Number.isFinite(ms) && ms >= 0 && ms % 1000 === 0;
}

// ajv-formats is CommonJS; under NodeNext its module arrives as the default export.
const { fullFormats } = formatsModule;

/** For everything an agent signs: date-time is a signable timestamp. */
export const signedValidators = schemaValidators({ uri: fullFormats.uri, 'date-time': { type: 'string', validate: signedTimestamp } });
/** For records the operators and adjudicators write: the formats as ajv-formats defines them. */
export const plainValidators = schemaValidators(fullFormats);
