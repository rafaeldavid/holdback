// The build a Worker runs, for Crow Control (T-413). The site, the test agents and early access each answer
// GET <their path>/version.json with buildInfo()'s shape, pinned by build-info.schema.json beside this file:
//
//   { "schema": "crow.build/1", "worker": "<the Worker's name>", "commit": "<40 hex>" | null,
//     "deployedAt": "<ISO 8601 UTC>" | null, "versionId": "<UUID>" | null }
//
// `commit` is what the Worker's deploy fills in (the site's build writes it to its version.json asset; the test agents
// and early access get it as the BUILD_COMMIT variable from their deploy scripts). `deployedAt` and `versionId` come
// from Cloudflare's version-metadata binding (CF_VERSION_METADATA): the time Cloudflare created the version that is
// live, at its upload, and that version's ID. After a rollback they name the older version, which is what runs.
// Nothing secret is in it. The answer is never cached (`no-store`), so a read after a deploy sees the new version.
export const BUILD_SCHEMA = 'crow.build/1';
const COMMIT = /^[0-9a-f]{40}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The body of a Worker's version.json. Anything malformed reads null: never a guess.
 * @param {{ worker: string, commit?: unknown, metadata?: { id?: unknown, timestamp?: unknown } | null }} input
 *   `metadata` is the version-metadata binding, or undefined where the Worker has none (a local run, a test).
 */
export function buildInfo({ worker, commit, metadata }) {
  const c = typeof commit === 'string' ? commit.trim().toLowerCase() : '';
  const id = typeof metadata?.id === 'string' ? metadata.id.toLowerCase() : '';
  const at = typeof metadata?.timestamp === 'string' && metadata.timestamp !== '' ? new Date(metadata.timestamp) : null;
  return {
    schema: BUILD_SCHEMA,
    worker,
    commit: COMMIT.test(c) ? c : null,
    deployedAt: at && !Number.isNaN(at.getTime()) ? at.toISOString() : null,
    versionId: UUID.test(id) ? id : null,
  };
}

/** The answer: JSON, never cached, readable from any page (it holds nothing a page could not read anyway). */
export function buildResponse(info, method = 'GET') {
  return new Response(method === 'HEAD' ? null : `${JSON.stringify(info, null, 2)}\n`, {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': '*' },
  });
}

/** Whether a request is a read of version.json at `path`. */
export const isBuildRead = (request, path) => (request.method === 'GET' || request.method === 'HEAD') && new URL(request.url).pathname === path;
