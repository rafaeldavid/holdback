// A seller's preflight (T-316): what the adjudicator's intake and stage 1 will say about a file, run by the
// seller on the exact bytes it will deliver, before it delivers. The rules contract takes one delivery
// attempt and a failed required check refunds the buyer, so this is the seller's only look in advance.
//
// It is the adjudicator's code, not a copy: the three plaintext rules are the functions intake() calls, and
// the checks are the stageOne() that runPipeline() calls. Like them it reads the file as data: nothing from
// the deliverable or the terms is executed, and nothing here opens a file or a network connection.
//
// What it cannot tell a seller: the screen (stage 2) and the judges (stage 4) are not run, so on a rubric
// deal `panel` means only that the checks do not refuse the file.
import type { MimeType, Sha256 } from '@holdback/core';
import { sha256 } from '@holdback/core/crypto';
import type { PreDecision } from './aggregate.js';
import type { CheckOutcome } from './checks/index.js';
import { decodePlaintext, refuseMime, refuseSize, type IntakeError } from './intake.js';
import { stageOne } from './pipeline.js';
import type { JudgmentAcceptance } from './terms.js';

export interface PreflightInput {
  /** The exact bytes the seller will encrypt and deliver. */
  plaintext: Uint8Array;
  /** The format the seller will declare as the delivery's `plaintextMime`. */
  mime: MimeType;
  /** The commitment's `acceptance`: the deterministic checks and the rubric. */
  acceptance: JudgmentAcceptance;
  /** The commitment's `deliverable.format`. When given, another delivered format is refused, as at intake. */
  format?: MimeType;
  /**
   * Reference files by committed sha256, for `reference_row_match_min` checks: the bytes the adjudicator's
   * content store holds under the hash the terms commit to (`loadReferences`, T-327). Given the same bytes, the
   * result matches the adjudicator's. A reference left out fails its check with "reference not available", as
   * it does on an adjudicator whose store does not hold it.
   */
  references?: ReadonlyMap<string, Uint8Array>;
}

export interface Preflight {
  /** The hash of the bytes checked: the delivery's `plaintextSha256` if the seller delivers these bytes. */
  plaintextSha256: Sha256;
  bytes: number;
  /** Set when intake would refuse the bytes. The adjudicator then rejects with no check run. */
  refused?: IntakeError;
  /** One outcome per check, as the adjudicator's judgment record lists them. Empty when intake refuses. */
  deterministic: CheckOutcome[];
  /** Ids of checks that ran out of the work budget: neither passed nor failed. */
  inconclusive: string[];
  /**
   * What stage 1 decides for these bytes:
   * - `reject`: intake refuses them or a required check fails; the buyer is refunded.
   * - `escalate`: a check ran out of its work budget; the deal escalates.
   * - `accept`: every check passes and the rubric is empty; the seller is paid.
   * - `panel`: the checks do not refuse the file and the judges decide next.
   */
  result: PreDecision;
}

export function preflightDelivery(input: PreflightInput): Preflight {
  const { plaintext, mime } = input;
  const head = { plaintextSha256: sha256(plaintext), bytes: plaintext.length };
  const refuse = (refused: IntakeError): Preflight => ({ ...head, refused, deterministic: [], inconclusive: [], result: 'reject' });

  const refused = refuseMime(mime, input.format) ?? refuseSize(plaintext);
  if (refused) return refuse(refused);
  const decoded = decodePlaintext(plaintext, mime);
  if (!decoded.ok) return refuse(decoded.error);

  const { deterministic, inconclusive, next } = stageOne(decoded.value, input.acceptance, input.references);
  return { ...head, deterministic, inconclusive, result: next };
}
