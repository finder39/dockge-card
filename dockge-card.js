/**
 * Dockge Card - Custom Lovelace card for Dockge integration
 * Auto-discovers servers and stacks from Dockge HA entities.
 */

const CARD_VERSION = '1.6.0';

// Global popup state — survives card element re-creation by HA/bubble
if (!window.__dockgePopup) {
  window.__dockgePopup = { el: null, escHandler: null };
}

const STACK_ICONS = {
  adguard: 'mdi:shield-check',
  agents: 'mdi:cog',
  frigate: 'mdi:cctv',
  'home-assistant': 'mdi:home-assistant',
  nginx: 'mdi:web',
  pangolin: 'mdi:tunnel',
  dawarich: 'mdi:map-marker-path',
  n8n: 'mdi:sitemap-outline',
  nocodb: 'mdi:database',
  teslamate: 'mdi:car-electric',
  restic: 'mdi:backup-restore',
  windmill: 'mdi:wind-turbine',
  'folding-at-home': 'mdi:dna',
  plex: 'mdi:plex',
  sonarr: 'mdi:television-classic',
  radarr: 'mdi:filmstrip',
  grafana: 'mdi:chart-line',
  mosquitto: 'mdi:antenna',
  zigbee2mqtt: 'mdi:zigbee',
  portainer: 'mdi:docker',
  traefik: 'mdi:routes',
  nextcloud: 'mdi:cloud',
  vaultwarden: 'mdi:shield-lock',
  pihole: 'mdi:pi-hole',
  unifi: 'mdi:access-point',
  jellyfin: 'mdi:movie-open',
};

const STATUS_COLORS = {
  running: 'var(--success-color, #4caf50)',
  exited: 'var(--error-color, #f44336)',
  unhealthy: 'var(--warning-color, #ff9800)',
  unknown: 'var(--disabled-color, #9e9e9e)',
  processing: 'var(--info-color, #2196f3)',
};

class DockgeCard extends HTMLElement {
  set hass(hass) {
    const oldHass = this._hass;
    this._hass = hass;
    if (!this._initialized) return;
    // Skip re-render if popup is open (popup manages its own state)
    if (window.__dockgePopup.el) return;
    // Only re-render if dockge-related entities changed
    if (oldHass && !this._dockgeStateChanged(oldHass, hass)) return;
    this._renderCard();
  }

  get hass() {
    return this._hass;
  }

  setConfig(config) {
    this._config = {
      icons: {},
      show_header: true,
      ...config,
    };
    this._popupEl = null;
  }

  getCardSize() {
    return 6;
  }

  static getConfigElement() {
    return document.createElement('dockge-card-editor');
  }

  static getStubConfig() {
    return {};
  }

  connectedCallback() {
    if (!this.shadowRoot) {
      this.attachShadow({ mode: 'open' });
    }
    this._initialized = true;
    this._renderCard();
  }

  disconnectedCallback() {
    // Don't remove popup on disconnect — HA/bubble recreates elements frequently
  }

  _dockgeStateChanged(oldHass, newHass) {
    for (const id in newHass.states) {
      if (!id.includes('dockge') && !(newHass.states[id].attributes && newHass.states[id].attributes.stack_name)) continue;
      if (!oldHass.states[id]) return true;
      if (oldHass.states[id].state !== newHass.states[id].state) return true;
      if (oldHass.states[id].last_updated !== newHass.states[id].last_updated) return true;
    }
    return false;
  }

  _getIcon(stackName) {
    return (this._config.icons && this._config.icons[stackName]) || STACK_ICONS[stackName] || 'mdi:docker';
  }

  _getGlobalSummary() {
    for (const id in this._hass.states) {
      if (id.match(/^sensor\.dockge_server_.*_global_summary$/)) return this._hass.states[id];
    }
    return null;
  }

  _getUpdatesAvailable(serverName) {
    const slug = serverName.toLowerCase().replace(/[^a-z0-9]/g, '_');
    const entity = this._hass.states[`sensor.dockge_server_${slug}_image_updates_available`];
    return entity ? parseInt(entity.state, 10) || 0 : 0;
  }

  _getVersion(serverName) {
    const slug = serverName.toLowerCase().replace(/[^a-z0-9]/g, '_');
    const entity = this._hass.states[`sensor.dockge_server_${slug}_version`];
    return entity ? entity.state : null;
  }

  _getContainersForStack(stackName, serverName) {
    const containers = [];
    for (const id in this._hass.states) {
      const s = this._hass.states[id];
      if (s.attributes && s.attributes.stack_name === stackName && s.attributes.agent_name === serverName && s.attributes.icon === 'mdi:docker' && id.startsWith('sensor.')) {
        containers.push(s);
      }
    }
    return containers.sort((a, b) => (a.attributes.container_name || '').localeCompare(b.attributes.container_name || ''));
  }

  _getStackColor(containers) {
    if (containers.length === 0) return STATUS_COLORS.unknown;
    if (containers.some(c => c.attributes.health === 'unhealthy')) return STATUS_COLORS.unhealthy;
    if (!containers.every(c => c.state === 'running')) return STATUS_COLORS.exited;
    if (containers.some(c => c.attributes.update_available === true)) return STATUS_COLORS.unhealthy;
    return STATUS_COLORS.running;
  }

  _getAgentParam(serverName) {
    const globalEntity = this._getGlobalSummary();
    if (globalEntity && serverName === globalEntity.attributes.agent_name) return '';
    return serverName;
  }

  _isStackProcessing(stackName, serverName) {
    for (const id in this._hass.states) {
      if (!id.startsWith('binary_sensor.')) continue;
      const s = this._hass.states[id];
      if (!s.attributes || s.attributes.processing !== true) continue;
      if (s.attributes.stack_name === stackName && s.attributes.agent_name === serverName) return true;
    }
    return false;
  }

  // ── Popup (appended to document.body to escape shadow DOM) ──

  _showPopup(stackName, serverName, agentParam) {
    DockgeCard._removePopup();

    const containers = this._getContainersForStack(stackName, serverName);
    const isProcessing = this._isStackProcessing(stackName, serverName);
    let selectedAction = null;

    const overlay = document.createElement('div');
    overlay.className = 'dockge-popup-overlay';
    overlay.innerHTML = `
      <style>${this._getPopupStyles()}</style>
      <div class="dockge-popup">
        <div class="popup-header">
          <ha-icon icon="${this._getIcon(stackName)}"></ha-icon>
          <span>${stackName}</span>
          <span class="popup-server">${serverName}</span>
          ${isProcessing ? '<span class="popup-processing">Processing...</span>' : ''}
        </div>
        <div class="popup-table-wrapper">
          <table class="container-table">
            <thead><tr><th>Container</th><th>State</th><th>Uptime</th><th>Image</th><th>Update</th></tr></thead>
            <tbody>
              ${containers.map(c => {
                const a = c.attributes;
                const color = c.state === 'running' ? STATUS_COLORS.running : STATUS_COLORS.exited;
                return `<tr>
                  <td>${a.container_name || '?'}</td>
                  <td><span class="state-badge" style="--badge-color: ${color}">${c.state}</span></td>
                  <td class="uptime-cell">${a.status || '—'}</td>
                  <td><code>${a.image_tag || '?'}</code></td>
                  <td class="update-cell">${a.update_available ? '⬆️' : '✓'}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
        ${isProcessing ? '<div class="action-chips-disabled">Actions unavailable while processing</div>' : `<div class="action-chips">
          ${[
            { name: 'Check Updates', icon: 'mdi:magnify', color: 'var(--info-color, #2196f3)' },
            { name: 'Start', icon: 'mdi:play', color: 'var(--success-color, #4caf50)' },
            { name: 'Stop', icon: 'mdi:stop', color: 'var(--error-color, #f44336)' },
            { name: 'Restart', icon: 'mdi:restart', color: 'var(--warning-color, #ff9800)' },
            { name: 'Update', icon: 'mdi:package-up', color: 'var(--accent-color, #ff9800)' },
          ].map(a => `<div class="action-chip" data-action="${a.name}" style="--action-color: ${a.color}"><ha-icon icon="${a.icon}"></ha-icon><span>${a.name}</span></div>`).join('')}
        </div>`}
        <div class="popup-buttons">
          <button class="btn-cancel">Cancel</button>
          <button class="btn-confirm" disabled>${isProcessing ? 'Processing...' : 'Select Action'}</button>
        </div>
      </div>
    `;

    // Stop events from propagating outside overlay to bubble card / HA
    // Use bubble phase (not capture) so child elements get their events first
    for (const evt of ['click', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'touchstart', 'touchend']) {
      overlay.addEventListener(evt, (e) => {
        e.stopPropagation();
      });
    }

    // Close on overlay background click (not popup content)
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) DockgeCard._removePopup();
    });

    // Event: cancel
    overlay.querySelector('.btn-cancel').addEventListener('click', () => DockgeCard._removePopup());

    // Event: action selection
    overlay.querySelectorAll('.action-chip').forEach(chip => {
      chip.addEventListener('click', (e) => {
        overlay.querySelectorAll('.action-chip').forEach(c => c.classList.remove('action-selected'));
        e.currentTarget.classList.add('action-selected');
        selectedAction = e.currentTarget.dataset.action;
        const btn = overlay.querySelector('.btn-confirm');
        btn.disabled = false;
        btn.textContent = selectedAction;
        btn.classList.add('btn-active');
      });
    });

    // Event: confirm — execute action, mark processing, close popup, re-render card
    overlay.querySelector('.btn-confirm').addEventListener('click', () => {
      if (!selectedAction) return;
      const serviceMap = {
        'Check Updates': 'check_updates',
        Start: 'start_stack',
        Stop: 'stop_stack',
        Restart: 'restart_stack',
        Update: 'update_stack',
      };
      const svc = serviceMap[selectedAction];
      if (svc) {
        const data = { stack_name: stackName };
        if (agentParam) data.agent = agentParam;
        this._hass.callService('dockge', svc, data);
      }
      DockgeCard._removePopup();
      this._renderCard();
    });

    // Escape key
    const escHandler = (e) => { if (e.key === 'Escape') DockgeCard._removePopup(); };
    document.addEventListener('keydown', escHandler);

    document.body.appendChild(overlay);
    window.__dockgePopup = { el: overlay, escHandler };
  }

  static _removePopup() {
    const p = window.__dockgePopup;
    if (p.el) {
      p.el.remove();
      p.el = null;
    }
    if (p.escHandler) {
      document.removeEventListener('keydown', p.escHandler);
      p.escHandler = null;
    }
  }

  // ── Main card render ──

  _renderCard() {
    if (!this._hass || !this.shadowRoot) return;

    const globalSummary = this._getGlobalSummary();
    if (!globalSummary || !globalSummary.attributes.agents) {
      this.shadowRoot.innerHTML = `<ha-card><div style="padding:16px;text-align:center;color:var(--secondary-text-color);">No Dockge integration found.</div></ha-card>`;
      return;
    }

    const agents = globalSummary.attributes.agents;
    const total = globalSummary.attributes.total_containers || 0;
    const running = globalSummary.attributes.running_containers || 0;

    let totalIssues = 0;
    let totalUpdates = 0;
    for (const id in this._hass.states) {
      const s = this._hass.states[id];
      if (s.attributes && s.attributes.icon === 'mdi:docker' && id.startsWith('sensor.') && s.attributes.stack_name) {
        if (s.state !== 'running') totalIssues++;
        if (s.attributes.health === 'unhealthy') totalIssues++;
      }
    }
    for (const name in agents) totalUpdates += this._getUpdatesAvailable(name);

    let html = `<style>${this._getCardStyles()}</style>`;

    if (this._config.show_header !== false) {
      html += `<div class="header"><div class="header-icon"><ha-icon icon="mdi:docker"></ha-icon></div><div class="header-info"><div class="header-title">Docker</div><div class="header-subtitle">${running}/${total} running</div></div></div>`;
    }

    html += `<div class="summary-chips">
      <div class="chip ${running === total ? 'chip-green' : 'chip-red'}"><ha-icon icon="mdi:checkbox-marked-circle"></ha-icon><span>${running}/${total} Running</span></div>
      <div class="chip ${totalIssues === 0 ? 'chip-green' : 'chip-red'}"><ha-icon icon="mdi:alert-circle"></ha-icon><span>${totalIssues === 0 ? 'No Issues' : totalIssues + ' Issue' + (totalIssues > 1 ? 's' : '')}</span></div>
      <div class="chip ${totalUpdates === 0 ? 'chip-green' : 'chip-amber'}"><ha-icon icon="mdi:update"></ha-icon><span>${totalUpdates === 0 ? 'All Up to Date' : totalUpdates + ' Update' + (totalUpdates > 1 ? 's' : '')}</span></div>
    </div>`;

    for (const serverName of Object.keys(agents)) {
      const ad = agents[serverName];
      const stacks = (ad.stacks || []).sort();
      const updates = this._getUpdatesAvailable(serverName);
      const agentParam = this._getAgentParam(serverName);

      const version = this._getVersion(serverName);
      html += `<div class="server-section"><div class="server-header"><ha-icon icon="mdi:server" class="server-icon"></ha-icon><div class="server-info"><div class="server-name">${serverName}${version ? '<span class="server-version">v' + version + '</span>' : ''}</div><div class="server-status">${ad.running_containers}/${ad.total_containers} running${updates > 0 ? ' · ' + updates + ' update' + (updates > 1 ? 's' : '') : ''}</div></div></div><div class="stack-chips">`;

      for (const stackName of stacks) {
        const containers = this._getContainersForStack(stackName, serverName);
        const color = this._getStackColor(containers);
        const isProcessing = this._isStackProcessing(stackName, serverName);
        const chipColor = isProcessing ? STATUS_COLORS.processing : color;
        const processingClass = isProcessing ? ' stack-chip-processing' : '';
        html += `<div class="stack-chip${processingClass}" data-stack="${stackName}" data-server="${serverName}" data-agent="${agentParam}" style="--chip-color: ${chipColor}"><ha-icon icon="${this._getIcon(stackName)}" class="stack-icon"></ha-icon><span class="stack-name">${stackName}</span></div>`;
      }

      html += `</div></div>`;
    }

    this.shadowRoot.innerHTML = `<ha-card>${html}</ha-card>`;

    this.shadowRoot.querySelectorAll('.stack-chip').forEach(chip => {
      chip.addEventListener('click', e => {
        const el = e.currentTarget;
        this._showPopup(el.dataset.stack, el.dataset.server, el.dataset.agent);
      });
    });
  }

  _getCardStyles() {
    return `
      :host { --chip-radius: 18px; }
      ha-card { padding: 0; overflow: hidden; background: none; box-shadow: none; }
      .header { display: flex; align-items: center; gap: 12px; padding: 16px 16px 8px; }
      .header-icon { width: 40px; height: 40px; border-radius: 50%; background: rgba(var(--rgb-primary-color, 3, 169, 244), 0.2); display: flex; align-items: center; justify-content: center; }
      .header-icon ha-icon { color: var(--primary-color); --mdc-icon-size: 24px; }
      .header-title { font-size: 18px; font-weight: 500; color: var(--primary-text-color); }
      .header-subtitle { font-size: 13px; color: var(--secondary-text-color); }
      .summary-chips { display: flex; justify-content: center; gap: 8px; padding: 8px 16px 12px; flex-wrap: wrap; }
      .chip { display: flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: var(--chip-radius); background: rgba(127,127,127,0.15); font-size: 13px; color: var(--primary-text-color); }
      .chip ha-icon { --mdc-icon-size: 18px; }
      .chip-green ha-icon { color: var(--success-color, #4caf50); }
      .chip-red ha-icon { color: var(--error-color, #f44336); }
      .chip-amber ha-icon { color: var(--warning-color, #ff9800); }
      .server-section { padding: 0 16px 16px; }
      .server-header { display: flex; align-items: center; gap: 12px; padding: 12px 16px; background: rgba(127,127,127,0.1); border-radius: 12px; margin-bottom: 8px; }
      .server-icon { --mdc-icon-size: 24px; color: var(--secondary-text-color); }
      .server-name { font-size: 16px; font-weight: 500; color: var(--primary-text-color); }
      .server-version { font-size: 11px; font-weight: 400; color: var(--secondary-text-color); background: rgba(127,127,127,0.15); padding: 1px 6px; border-radius: 4px; margin-left: 8px; vertical-align: middle; }
      .server-status { font-size: 12px; color: var(--secondary-text-color); }
      .stack-chips { display: flex; flex-wrap: wrap; gap: 6px; padding: 4px 0; justify-content: center; }
      .stack-chip { display: flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: var(--chip-radius); background: rgba(127,127,127,0.12); cursor: pointer; transition: background 0.2s, transform 0.1s; font-size: 13px; color: var(--primary-text-color); }
      .stack-chip:hover { background: rgba(127,127,127,0.25); transform: scale(1.03); }
      .stack-chip:active { transform: scale(0.97); }
      .stack-icon { --mdc-icon-size: 18px; color: var(--chip-color); }
      .stack-name { white-space: nowrap; }
      .stack-chip-processing .stack-icon { animation: dockgePulse 1.2s ease-in-out infinite; }
      @keyframes dockgePulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
    `;
  }

  _getPopupStyles() {
    return `
      .dockge-popup-overlay {
        position: fixed; top: 0; left: 0; right: 0; bottom: 0;
        background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center;
        z-index: 9999; padding: 16px; animation: dockgeFadeIn 0.15s ease;
        font-family: var(--paper-font-body1_-_font-family, 'Roboto', sans-serif);
      }
      @keyframes dockgeFadeIn { from { opacity: 0; } to { opacity: 1; } }
      .dockge-popup {
        background: var(--card-background-color, #1c1c1c); border-radius: 16px; padding: 20px;
        max-width: 500px; width: 100%; max-height: 80vh; overflow-y: auto;
        box-shadow: 0 8px 32px rgba(0,0,0,0.4); animation: dockgeSlideUp 0.2s ease;
        color: var(--primary-text-color, #fff);
      }
      @keyframes dockgeSlideUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
      .popup-header { display: flex; align-items: center; gap: 10px; font-size: 18px; font-weight: 500; margin-bottom: 16px; }
      .popup-header ha-icon { --mdc-icon-size: 24px; color: var(--primary-color, #2196f3); }
      .popup-server { font-size: 13px; color: var(--secondary-text-color, #999); margin-left: auto; }
      .popup-table-wrapper { overflow-x: auto; margin-bottom: 16px; }
      .container-table { width: 100%; border-collapse: collapse; font-size: 13px; }
      .container-table th { text-align: left; padding: 6px 8px; font-weight: 500; color: var(--secondary-text-color, #999); border-bottom: 1px solid rgba(127,127,127,0.2); font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
      .container-table td { padding: 8px; border-bottom: 1px solid rgba(127,127,127,0.08); }
      .container-table code { background: rgba(127,127,127,0.15); padding: 2px 6px; border-radius: 4px; font-size: 12px; }
      .state-badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 12px; font-weight: 500; background: color-mix(in srgb, var(--badge-color) 20%, transparent); color: var(--badge-color); }
      .uptime-cell { font-size: 12px; color: var(--secondary-text-color, #999); }
      .update-cell { text-align: center; }
      .action-chips { display: flex; justify-content: center; gap: 6px; flex-wrap: wrap; margin-bottom: 16px; }
      .action-chip { display: flex; align-items: center; gap: 6px; padding: 8px 14px; border-radius: 18px; background: rgba(127,127,127,0.12); cursor: pointer; transition: all 0.2s; font-size: 13px; }
      .action-chip:hover { background: rgba(127,127,127,0.25); }
      .action-chip ha-icon { --mdc-icon-size: 18px; }
      .action-selected { background: color-mix(in srgb, var(--action-color) 25%, transparent) !important; }
      .action-selected ha-icon { color: var(--action-color); }
      .popup-buttons { display: flex; gap: 8px; }
      .popup-buttons button { flex: 1; padding: 12px; border: none; border-radius: 12px; font-size: 14px; font-weight: 500; cursor: pointer; transition: all 0.2s; }
      .btn-cancel { background: rgba(127,127,127,0.15); color: var(--primary-text-color, #fff); }
      .btn-cancel:hover { background: rgba(127,127,127,0.3); }
      .btn-confirm { background: rgba(127,127,127,0.1); color: rgba(127,127,127,0.5); }
      .btn-confirm.btn-active { background: var(--primary-color, #2196f3); color: white; }
      .btn-confirm.btn-active:hover { filter: brightness(1.1); }
      .btn-confirm:disabled { cursor: default; }
      .popup-processing { font-size: 12px; color: var(--info-color, #2196f3); animation: dockgePulse 1.2s ease-in-out infinite; }
      @keyframes dockgePulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
      .action-chips-disabled { text-align: center; padding: 12px; color: var(--secondary-text-color, #999); font-size: 13px; }
    `;
  }
}

class DockgeCardEditor extends HTMLElement {
  set hass(hass) { this._hass = hass; }
  setConfig(config) {
    this._config = config;
    if (!this.innerHTML) {
      this.innerHTML = `<div style="padding:16px"><p>Dockge Card auto-discovers your servers and stacks.</p><p style="color:var(--secondary-text-color);font-size:13px">Optional: Add custom stack icons in YAML mode using the <code>icons</code> key.</p></div>`;
    }
  }
}

customElements.define('dockge-card', DockgeCard);
customElements.define('dockge-card-editor', DockgeCardEditor);

window.customCards = window.customCards || [];
window.customCards.push({
  type: 'dockge-card',
  name: 'Dockge Card',
  description: 'Auto-discovering Docker management card for Dockge integration',
  preview: false,
});

console.info(`%c DOCKGE-CARD %c v${CARD_VERSION} `, 'color: white; background: #2196f3; font-weight: bold;', 'color: #2196f3; background: white; font-weight: bold;');
