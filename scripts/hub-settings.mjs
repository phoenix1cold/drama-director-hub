/**
 * Thin wrapper around game.settings used by feature modules through the hub.
 * Each feature module still registers its own keys under its own moduleId —
 * this just gives a uniform get/set with safe fallbacks for code that runs
 * before settings are registered.
 */
export const DDHubSettings = {
  get(moduleId, key, fallback = null) {
    try {
      const v = game.settings.get(moduleId, key);
      return (v === undefined || v === null) ? fallback : v;
    } catch {
      return fallback;
    }
  },

  async set(moduleId, key, value) {
    try {
      await game.settings.set(moduleId, key, value);
      return true;
    } catch (e) {
      console.warn(`[DDHub.settings] set(${moduleId}, ${key}) failed`, e);
      return false;
    }
  },
};
