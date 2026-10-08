/**
 * dsh-session-map — host half.
 *
 * The map is a client-only feature: it reads the session and workspace
 * snapshots the client already subscribes to, so there is nothing for the host
 * to serve yet. This half exists because a cordis plugin row is what makes the
 * bundle's client half discoverable and loadable.
 *
 * Room for later, if the map needs data the client cannot see (for example the
 * durable archive set, which lives in the workspace storage rather than in any
 * client-readable store): register a read-only route here.
 */
export const name = 'dsh-session-map';
export const inject = [];

export function apply() {
  /* no host-side behaviour yet */
}
