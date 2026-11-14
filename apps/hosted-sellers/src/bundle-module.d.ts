// The bundle module the deploy script aliases (T-436): one seller's HostedBundle, as JSON.
declare module 'crow-hosted-seller-bundle' {
  import type { HostedBundle } from './bundle.ts';
  const bundle: HostedBundle;
  export default bundle;
}
