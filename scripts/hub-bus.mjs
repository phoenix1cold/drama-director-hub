/**
 * Cross-module event bus. Plain pub/sub, no Foundry hooks.
 *
 * Feature modules use this to announce / listen for cross-module events,
 * for example:
 *   - cinematic emits 'recorder:trigger-finale' before playing JoJo Session ending
 *   - footsteps emits 'token:moved' if you wanted other modules to react
 *   - novella listens for 'cinematic:effect-applied' to suspend its own filters
 *
 * Persistence: none — bus state is in-memory only.
 */
export class DDHubBus {
  constructor() {
    this._handlers = new Map();
  }

  on(event, cb) {
    if (!event || typeof cb !== 'function') return () => {};
    if (!this._handlers.has(event)) this._handlers.set(event, new Set());
    this._handlers.get(event).add(cb);
    return () => this.off(event, cb);
  }

  off(event, cb) {
    this._handlers.get(event)?.delete(cb);
  }

  emit(event, data) {
    const set = this._handlers.get(event);
    if (!set || !set.size) return;
    for (const cb of set) {
      try { cb(data); } catch (e) { console.warn(`[DDHub.bus] handler for "${event}" threw`, e); }
    }
  }

  /** Remove all handlers (used in tests / on hub teardown). */
  clear() { this._handlers.clear(); }
}
