// Node stand-in for the workerd built-in `cloudflare:workers`, which
// @cloudflare/workers-oauth-provider imports at module load. Only the class
// reference is needed; nothing in the tests runs on it.
export class WorkerEntrypoint {}
