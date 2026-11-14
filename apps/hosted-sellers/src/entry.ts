// The Worker's entry (T-435): the deploy script points the module `crow-hosted-seller-bundle` at the seller's bundle,
// built from its private folder, so the bundle never enters the repository. worker.ts holds everything else.
import bundle from 'crow-hosted-seller-bundle';
import { HostedSellerObject, setupOf, workerFor, type DurableObjectState, type Env } from './worker.ts';

const setup = setupOf(bundle);

/** The seller's Durable Object, bound to the deployed bundle. */
export class HostedSeller extends HostedSellerObject {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env, setup);
  }
}

export default workerFor(setup);
