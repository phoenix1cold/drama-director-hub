/**
 * Sidebar tab for the hub.
 *
 * Foundry V13 registers sidebar tabs by adding an entry to
 * `CONFIG.ui.sidebar.TABS` and assigning an instance to `ui[tabName]` —
 * the framework then takes care of injecting the nav button, switching
 * activation, and rendering the tab body. Do NOT inject DOM manually.
 */

const HUB_ID = 'drama-director-hub';

export class DramaDirectorHubTab extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.sidebar.AbstractSidebarTab
) {
  static tabName = HUB_ID;

  static DEFAULT_OPTIONS = {
    classes: ['drama-director-hub-tab', 'flexcol'],
    window: { title: 'DDHUB.sidebar.title' },
    actions: {
      openPanel:    DramaDirectorHubTab._onOpenPanel,
      checkUpdates: DramaDirectorHubTab._onCheckUpdates,
      openUpdate:   DramaDirectorHubTab._onOpenUpdate,
    },
  };

  static PARTS = {
    main: {
      template: `modules/${HUB_ID}/templates/hub-panel.hbs`,
    },
  };

  /**
   * Register the tab with Foundry. Called from main.mjs at init time.
   * The actual nav button + tab body are wired by Foundry once we put an
   * entry into CONFIG.ui.sidebar.TABS and assign an instance to ui[…].
   */
  static register() {
    try {
      CONFIG.ui.sidebar.TABS[HUB_ID] = {
        icon:    'fa-solid fa-theater-masks',
        tooltip: 'DDHUB.sidebar.title',
      };
      ui[HUB_ID] = new this();
    } catch (e) {
      console.error('[DDHub.tab] registration failed', e);
    }

    // Re-render when feature modules register a new panel, or when the
    // auto-update check publishes a result.
    Hooks.on('drama-director-hub.panelsChanged', () => this.requestRerender());
    Hooks.on('drama-director-hub.updatesChecked', () => this.requestRerender());

    // Hide the nav button for non-GM players.
    Hooks.on('renderSidebar', (_sidebar, html) => {
      if (game.user?.isGM) return;
      const root = html instanceof HTMLElement ? html : html?.[0];
      const btn  = root?.querySelector?.(`[data-tab="${HUB_ID}"]`);
      if (btn) btn.style.display = 'none';
    });

    // If a non-GM somehow lands on our tab, send them to chat.
    Hooks.once('ready', () => {
      if (!game.user?.isGM && ui.sidebar?.activeTab === HUB_ID) {
        try { ui.sidebar.activateTab?.('chat'); } catch {}
      }
    });
  }

  /** Force the tab to re-render if it's currently mounted. */
  static requestRerender() {
    try { ui[HUB_ID]?.render?.(false); } catch {}
  }

  async _preparePartContext(partId, context) {
    context.partId = partId;
    context.isGM = !!game.user?.isGM;

    const hub = game.modules.get(HUB_ID)?.api;
    const panels = hub?.getPanels?.() ?? [];

    const localize = (s) => (typeof s === 'string' && /^[A-Z][A-Z0-9]*\./.test(s))
      ? game.i18n.localize(s)
      : (s || '');

    // Cached update statuses — never trigger a fetch from inside render.
    const updates = (hub?.getUpdateStatus?.() ?? []).reduce((acc, r) => {
      acc[r.id] = r;
      return acc;
    }, {});

    context.buttons = panels
      .filter(p => context.isGM || p.gmOnly === false)
      .map(p => {
        const u = updates[p.moduleId];
        return {
          id:             p.id,
          moduleId:       p.moduleId,
          label:          localize(p.label),
          hint:           localize(p.hint),
          description:    localize(p.description),
          icon:           p.icon || 'fa-solid fa-circle',
          color:          p.color || '#888',
          order:          p.order ?? 100,
          hasUpdate:      !!u?.hasUpdate,
          latestVersion:  u?.latest ?? null,
          currentVersion: u?.current ?? null,
        };
      });

    context.hubUpdate  = updates[HUB_ID] || null;
    context.anyUpdate  = (hub?.getAvailableUpdates?.() ?? []).length > 0;
    context.empty      = !context.buttons.length;
    context.hubVersion = game.modules.get(HUB_ID)?.version ?? '?';
    return context;
  }

  /** Action: "Check updates" toolbar button. */
  static async _onCheckUpdates() {
    const hub = game.modules.get(HUB_ID)?.api;
    if (!hub) return;
    ui.notifications?.info(game.i18n.localize('DDHUB.updates.checking') || 'Checking for updates…');
    try {
      const results = await hub.checkUpdates({ force: true });
      DramaDirectorHubTab.requestRerender();
      const updates = results.filter(r => r.hasUpdate);
      const errors  = results.filter(r => r.error && r.installed);
      if (updates.length) {
        const list = updates.map(u => `${u.id} (${u.current}→${u.latest})`).join(', ');
        ui.notifications?.info(
          (game.i18n.localize('DDHUB.updates.foundUpdates') || 'Updates available:') + ' ' + list
        );
      } else if (errors.length) {
        ui.notifications?.warn(
          (game.i18n.localize('DDHUB.updates.someErrors') || 'Update check finished with errors. See console.')
        );
        console.warn('[DDHub] update check errors:', errors);
      } else {
        ui.notifications?.info(game.i18n.localize('DDHUB.updates.upToDate') || 'All Drama Director modules are up to date.');
      }
    } catch (e) {
      console.error('[DDHub] check updates failed', e);
      ui.notifications?.error(game.i18n.localize('DDHUB.updates.failed') || 'Update check failed.');
    }
  }

  /** Action: click on an update badge — open the GitHub release page. */
  static _onOpenUpdate(_event, target) {
    const moduleId = target?.dataset?.moduleId;
    if (!moduleId) return;
    const hub = game.modules.get(HUB_ID)?.api;
    const status = (hub?.getUpdateStatus?.() ?? []).find(r => r.id === moduleId);
    const url = status?.releaseUrl;
    if (url) window.open(url, '_blank', 'noopener');
  }

  /** Action: click on a feature-module button — call its open() callback. */
  static _onOpenPanel(_event, target) {
    const id = target?.dataset?.panelId;
    if (!id) return;
    const hub = game.modules.get(HUB_ID)?.api;
    const panel = hub?.getPanels?.().find(p => p.id === id);
    if (!panel) {
      ui.notifications?.warn(game.i18n.localize('DDHUB.sidebar.panelMissing') || 'Panel not registered');
      return;
    }
    try { panel.open(); }
    catch (e) {
      console.error(`[DDHub] panel "${id}" open failed`, e);
      ui.notifications?.error(game.i18n.localize('DDHUB.sidebar.openFailed') || 'Failed to open panel');
    }
  }
}
