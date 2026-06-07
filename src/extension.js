import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {PROVIDERS, fetchStatus} from './providers.js';

// ─── Configuration ────────────────────────────────────────────────────────────

const REQUEST_TIMEOUT_SECONDS = 15;
const MAX_CONSECUTIVE_ERRORS  = 3;

// ─── Status mappings ──────────────────────────────────────────────────────────

// Internal status → CSS class
const COLOR_CLASS = {
    operational:    'status-green',
    degraded:       'status-yellow',
    partial_outage: 'status-yellow',
    major_outage:   'status-red',
    unknown:        'status-gray',
};

// Internal status → display label
const STATUS_LABEL = {
    operational:    'Operational',
    degraded:       'Degraded performance',
    partial_outage: 'Partial outage',
    major_outage:   'Major outage',
    unknown:        'Unknown',
};

// Internal status → sort priority (lower = more severe)
const SEVERITY_ORDER = {
    major_outage:   0,
    partial_outage: 1,
    degraded:       2,
    unknown:        3,
    operational:    4,
};

// Statuspage.io incident status → display label
const INCIDENT_STATUS_LABEL = {
    investigating: 'Investigating',
    identified:    'Identified',
    monitoring:    'Monitoring',
    resolved:      'Resolved',
};

// ─── Small helpers ────────────────────────────────────────────────────────────

function colorClass(status) {
    return COLOR_CLASS[status] ?? 'status-gray';
}

function statusLabel(status) {
    return STATUS_LABEL[status] ?? 'Unknown';
}

function formatRelative(date) {
    if (!date || isNaN(date.getTime())) return '—';
    const minutes = Math.floor((Date.now() - date) / 60000);
    if (minutes < 1)  return 'just now';
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24)   return `${hours}h ago`;
    const pad = n => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// ─── Extension ────────────────────────────────────────────────────────────────

const PANEL_WIDTH      = 440;                          // detail view
const GRID_PANEL_WIDTH = 32 + 4 * 76 + 3 * 12;        // 372px — always 4-col wide
const SPINNER_FRAMES   = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];


export default class StatusDotExtension extends Extension {

    enable() {
        this._session             = new Soup.Session();
        this._session.timeout     = REQUEST_TIMEOUT_SECONDS;
        this._button              = null;
        this._dot                 = null;
        this._panel               = null;
        this._overlay             = null;
        this._header              = null;
        this._gridContainer       = null;
        this._scroll              = null;
        this._content             = null;
        this._incidents           = null;
        this._refreshBtn          = null;
        this._timer               = null;
        this._fetching            = false;
        this._consecutiveErrors   = 0;
        this._spinnerTimer        = null;
        this._spinnerStopTimer    = null;
        this._spinnerFrame        = 0;
        this._refreshStart        = 0;
        this._incidentExpanded    = false;
        this._isErrorState        = false;
        this._statuses            = {};    // providerId → normalized status
        this._currentProviderId   = null;  // null = grid view
        this._currentPanelWidth   = PANEL_WIDTH;

        try {
            this._settings = this.getSettings();
            this._settings.connect('changed::poll-interval', () => {
                this._stopPolling();
                this._startPolling();
            });
            this._settings.connect('changed::disabled-providers', () => {
                const active = this._activeProviders();
                if (this._currentProviderId && !active.find(p => p.id === this._currentProviderId))
                    this._currentProviderId = null;
                this._renderCurrentView();
                this._stopPolling();
                this._refresh();
                this._startPolling();
            });
        } catch (_e) {
            console.warn('[StatusDot] settings unavailable, using defaults');
            this._settings = null;
        }

        this._buildUI();
        this._refresh();
        this._startPolling();
    }

    disable() {
        this._stopPolling();
        this._stopSpinner();
        this._hidePanel();
        this._overlay?.destroy();
        this._panel?.destroy();
        this._button?.destroy();
        this._button            = null;
        this._dot               = null;
        this._overlay           = null;
        this._panel             = null;
        this._header            = null;
        this._gridContainer     = null;
        this._scroll            = null;
        this._content           = null;
        this._incidents         = null;
        this._refreshBtn          = null;
        this._refreshLabel        = null;
        this._refreshIcon         = null;
        this._statuses            = {};
        this._settings            = null;
        this._session             = null;
        this._fetching            = false;
        this._consecutiveErrors   = 0;
        this._spinnerTimer        = null;
        this._spinnerStopTimer    = null;
        this._spinnerFrame        = 0;
        this._refreshStart        = 0;
        this._incidentExpanded    = false;
        this._isErrorState        = false;
        this._currentProviderId   = null;
        this._currentPanelWidth   = PANEL_WIDTH;
    }

    _buildUI() {
        // ── Panel button ──────────────────────────────────────────────────────
        this._button = new PanelMenu.Button(0.0, 'StatusDot');
        this._dot = new St.Label({
            text: '●',
            style_class: 'status-dot status-gray',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._button.add_child(this._dot);
        Main.panel.addToStatusArea(this.uuid, this._button);
        this._button.menu.toggle = () => this._togglePanel();

        // ── Floating panel ────────────────────────────────────────────────────
        this._panel = new St.BoxLayout({
            vertical: true,
            style_class: 'popup-menu-content statusdot-window',
            reactive: true,
            visible: false,
        });

        this._header = new St.BoxLayout({ vertical: true, style_class: 'statusdot-header' });
        this._panel.add_child(this._header);
        this._panel.add_child(new St.Widget({ style_class: 'statusdot-separator', x_expand: true }));

        // Grid lives outside the ScrollView so its natural width drives the
        // panel size directly — no pixel-perfect width calculation needed.
        this._gridContainer = new St.BoxLayout({
            vertical: true, visible: false,
            style: 'padding: 0 16px 12px 16px;',
        });
        this._panel.add_child(this._gridContainer);

        this._scroll = new St.ScrollView({
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            x_expand: true,
            style: 'max-height: 380px;',
        });
        this._content = new St.BoxLayout({ vertical: true, x_expand: true, style: 'padding: 0 16px 12px 16px;' });
        this._scroll.set_child(this._content);
        this._panel.add_child(this._scroll);

        this._incidents = new St.BoxLayout({ vertical: true, x_expand: true, visible: false, style_class: 'statusdot-incidents' });
        this._panel.add_child(this._incidents);

        this._panel.add_child(new St.Widget({ style_class: 'statusdot-separator', x_expand: true }));

        const footer = new St.BoxLayout({ style_class: 'statusdot-footer' });

        const settingsBtn = new St.Button({ style_class: 'statusdot-settings-button', y_align: Clutter.ActorAlign.CENTER });
        settingsBtn.set_child(new St.Icon({ icon_name: 'emblem-system-symbolic', icon_size: 15, y_align: Clutter.ActorAlign.CENTER }));
        settingsBtn.connect('clicked', () => {
            this._hidePanel();
            this.openPreferences();
        });
        footer.add_child(settingsBtn);

        footer.add_child(new St.Widget({ x_expand: true }));

        this._refreshLabel = new St.Label({ text: 'Refresh', y_align: Clutter.ActorAlign.CENTER });
        this._refreshIcon  = new St.Icon({ gicon: Gio.icon_new_for_string(`${this.path}/icons/refresh-symbolic.svg`), icon_size: 16, y_align: Clutter.ActorAlign.CENTER });
        const btnContent = new St.BoxLayout({ style: 'spacing: 6px;' });
        btnContent.add_child(this._refreshLabel);
        btnContent.add_child(this._refreshIcon);
        this._refreshBtn = new St.Button({ style_class: 'statusdot-refresh-button' });
        this._refreshBtn.set_child(btnContent);
        this._refreshBtn.connect('clicked', () => this._refresh(true));
        footer.add_child(this._refreshBtn);
        this._panel.add_child(footer);

        this._panel.connect('key-press-event', (_a, event) => {
            if (event.get_key_symbol() === Clutter.KEY_Escape) {
                this._hidePanel();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });

        this._overlay = new St.Widget({ reactive: true });
        this._overlay.hide();
        this._overlay.connect('button-press-event', () => {
            this._hidePanel();
            return Clutter.EVENT_PROPAGATE;
        });
        Main.layoutManager.uiGroup.add_child(this._overlay);
        Main.layoutManager.uiGroup.add_child(this._panel);
    }

    // ── Panel visibility ──────────────────────────────────────────────────────

    _togglePanel() {
        this._panel.visible ? this._hidePanel() : this._showPanel();
    }

    _showPanel() {
        this._currentProviderId = null;   // always open on grid view
        this._renderCurrentView();
        this._positionPanel();
        this._overlay.set_size(global.stage.width, global.stage.height);
        this._overlay.show();
        this._panel.show();
        global.stage.set_key_focus(this._panel);
    }

    _positionPanel() {
        const monitor      = Main.layoutManager.primaryMonitor;
        const topBarHeight = Main.layoutManager.panelBox.height;
        const x = Math.floor(monitor.x + (monitor.width - this._currentPanelWidth) / 2);
        const y = monitor.y + topBarHeight + 8;
        this._panel.set_position(x, y);
    }

    _applyPanelWidth(width) {
        this._currentPanelWidth = width;
        this._panel.style = `width: ${width}px;`;
        if (this._panel.visible)
            this._positionPanel();
    }

    _hidePanel() {
        this._overlay?.hide();
        this._panel?.hide();
    }

    // ── Active providers ──────────────────────────────────────────────────────

    _activeProviders() {
        const disabled = this._settings?.get_strv('disabled-providers') ?? [];
        return PROVIDERS.filter(p => !disabled.includes(p.id));
    }

    // ── Status aggregation ────────────────────────────────────────────────────

    _worstStatus() {
        const all = this._activeProviders()
            .map(p => this._statuses[p.id]?.overallStatus)
            .filter(Boolean);
        return all.sort((a, b) => (SEVERITY_ORDER[a] ?? 3) - (SEVERITY_ORDER[b] ?? 3))[0] ?? 'unknown';
    }

    // ── Render dispatcher ─────────────────────────────────────────────────────

    _renderCurrentView() {
        if (this._isErrorState) {
            this._renderError();
            return;
        }
        const active = this._activeProviders();
        this._dot.style_class = `status-dot ${colorClass(this._worstStatus())}`;

        if (active.length === 0) {
            this._renderNoProviders();
            return;
        }

        // Skip grid when only one provider is active
        if (active.length === 1) {
            const status = this._statuses[active[0].id];
            if (status) this._renderDetail(status);
            return;
        }

        if (this._currentProviderId === null) {
            this._renderGrid();
        } else {
            const status = this._statuses[this._currentProviderId];
            if (status) this._renderDetail(status);
        }
    }

    // ── Grid view ─────────────────────────────────────────────────────────────

    _renderGrid() {
        this._content.destroy_all_children();
        this._incidents.destroy_all_children();
        this._incidents.hide();
        this._gridContainer.destroy_all_children();
        this._scroll.hide();
        this._gridContainer.show();
        this._applyPanelWidth(GRID_PANEL_WIDTH);

        const active  = this._activeProviders();
        const worst   = this._worstStatus();
        const troubled = active
            .filter(p => {
                const s = this._statuses[p.id]?.overallStatus;
                return s && s !== 'operational' && s !== 'unknown';
            })
            .sort((a, b) =>
                (SEVERITY_ORDER[this._statuses[a.id].overallStatus] ?? 3) -
                (SEVERITY_ORDER[this._statuses[b.id].overallStatus] ?? 3)
            );
        const allGood = troubled.length === 0;
        const opCount = active.filter(p => this._statuses[p.id]?.overallStatus === 'operational').length;

        // ── Header ────────────────────────────────────────────────────────────
        this._header.destroy_all_children();
        const titleRow = new St.BoxLayout({ style: 'spacing: 8px;' });
        titleRow.add_child(new St.Label({
            text: '●',
            style_class: colorClass(worst),
            style: 'font-size: 13px;',
            y_align: Clutter.ActorAlign.CENTER,
        }));
        titleRow.add_child(new St.Label({
            text: allGood
                ? 'All systems operational'
                : `${troubled.length} service${troubled.length !== 1 ? 's' : ''} need attention`,
            style: 'font-size: 15px; font-weight: bold;',
            y_align: Clutter.ActorAlign.CENTER,
        }));
        this._header.add_child(titleRow);
        this._header.add_child(new St.Label({
            text: `${opCount} operational · ${active.length} monitored`,
            style_class: 'dim-label',
            style: 'font-size: 12px; margin-top: 2px;',
        }));

        // ── Alert cards (non-operational providers) ───────────────────────────
        if (!allGood) {
            const alertBox = new St.BoxLayout({ vertical: true, style: 'padding-top: 8px;' });
            for (const provider of troubled)
                alertBox.add_child(this._buildAlertCard(provider));
            this._gridContainer.add_child(alertBox);
        }

        // ── Section label + grid ──────────────────────────────────────────────
        this._sectionLabel(this._gridContainer, allGood ? 'SERVICES' : 'ALL SERVICES');

        const grid = new St.BoxLayout({ vertical: true, style: 'spacing: 12px; padding-top: 8px;' });
        for (let i = 0; i < active.length; i += 4) {
            const row = new St.BoxLayout({ style: 'spacing: 12px;' });
            for (const provider of active.slice(i, i + 4))
                row.add_child(this._buildProviderCard(provider, this._statuses[provider.id]));
            grid.add_child(row);
        }
        this._gridContainer.add_child(grid);
    }

    _buildAlertCard(provider) {
        const status = this._statuses[provider.id];
        const gicon  = Gio.icon_new_for_string(`${this.path}/icons/${provider.icon}.svg`);
        const cls    = colorClass(status.overallStatus);

        const worstComp = [...status.components]
            .map(c => {
                const eff = c.children?.length > 0
                    ? [c.status, ...c.children.map(ch => ch.status)]
                        .sort((a, b) => (SEVERITY_ORDER[a] ?? 3) - (SEVERITY_ORDER[b] ?? 3))[0]
                    : c.status;
                return {c, eff};
            })
            .filter(({eff}) => eff !== 'operational' && eff !== 'unknown')
            .sort((a, b) => (SEVERITY_ORDER[a.eff] ?? 3) - (SEVERITY_ORDER[b.eff] ?? 3))[0]?.c;

        // Left accent bar
        const bar = new St.Widget({
            style_class: `statusdot-alert-bar ${cls}`,
            y_align: Clutter.ActorAlign.CENTER,
        });

        // Provider icon (inherits status color via CSS cascade)
        const icon = new St.Icon({ gicon, icon_size: 20, y_align: Clutter.ActorAlign.CENTER });

        // Text column
        const nameLabel = new St.Label({
            text:  provider.name,
            style: 'font-weight: bold; font-size: 13px; color: rgba(255,255,255,0.94);',
            y_align: Clutter.ActorAlign.CENTER,
        });

        const subRow = new St.BoxLayout({});
        subRow.add_child(new St.Label({
            text:        statusLabel(status.overallStatus),
            style_class: cls,
            style:       'font-size: 11px;',
        }));
        if (worstComp) {
            subRow.add_child(new St.Label({
                text:        ` · ${worstComp.name}`,
                style_class: 'dim-label',
                style:       'font-size: 11px;',
            }));
        }

        const textCol = new St.BoxLayout({ vertical: true, x_expand: true });
        textCol.add_child(nameLabel);
        textCol.add_child(subRow);

        const chevron = new St.Label({
            text:    '›',
            style:   'font-size: 16px; color: rgba(255,255,255,0.38);',
            y_align: Clutter.ActorAlign.CENTER,
        });

        const contentRow = new St.BoxLayout({ x_expand: true, style: 'spacing: 8px; padding: 10px 10px 10px 8px;' });
        contentRow.add_child(icon);
        contentRow.add_child(textCol);
        contentRow.add_child(chevron);

        const cardBox = new St.BoxLayout({ x_expand: true });
        cardBox.add_child(bar);
        cardBox.add_child(contentRow);

        const btn = new St.Button({
            style_class: `statusdot-alert-card ${cls}`,
            x_expand: true,
        });
        btn.set_child(cardBox);
        btn.connect('clicked', () => {
            this._currentProviderId = provider.id;
            this._incidentExpanded  = false;
            this._renderCurrentView();
        });
        return btn;
    }

    _buildProviderCard(provider, status) {
        const gicon = Gio.icon_new_for_string(`${this.path}/icons/${provider.icon}.svg`);

        // topSpacer + iconBin + dotRow: topSpacer and dotRow are the same fixed
        // height so the icon lands exactly at the card's vertical center.
        const topSpacer = new St.Widget({ x_expand: true, style_class: 'statusdot-card-row' });

        const iconBin = new St.Bin({
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            child: new St.Icon({ gicon, icon_size: 28 }),
        });

        const dotRow = new St.BoxLayout({ x_expand: true, style_class: 'statusdot-card-row' });
        dotRow.add_child(new St.Widget({ x_expand: true }));
        dotRow.add_child(new St.Widget({
            style_class: `statusdot-tile-dot ${colorClass(status?.overallStatus ?? 'unknown')}`,
            y_align: Clutter.ActorAlign.CENTER,
        }));

        const col = new St.BoxLayout({ vertical: true, x_expand: true, y_expand: true });
        col.add_child(topSpacer);
        col.add_child(iconBin);
        col.add_child(dotRow);

        const isAlert = status?.overallStatus && status.overallStatus !== 'operational' && status.overallStatus !== 'unknown';
        const btn = new St.Button({
            style_class: `statusdot-provider-card${isAlert ? ` ${colorClass(status.overallStatus)}` : ''}`,
            reactive: true,
        });
        btn.set_child(col);
        btn.connect('clicked', () => {
            this._currentProviderId = provider.id;
            this._incidentExpanded = false;
            this._renderCurrentView();
        });

        const wrapper = new St.BoxLayout({ vertical: true, style: 'spacing: 4px;' });
        wrapper.add_child(btn);
        wrapper.add_child(new St.Label({
            text:        provider.name,
            style_class: 'dim-label',
            style:       'font-size: 11px;',
            x_align:     Clutter.ActorAlign.CENTER,
        }));
        return wrapper;
    }

    // ── Detail view ───────────────────────────────────────────────────────────

    _renderDetail(status) {
        this._gridContainer.hide();
        this._scroll.show();
        this._applyPanelWidth(PANEL_WIDTH);

        this._header.destroy_all_children();
        this._buildDetailHeader(status);

        this._content.destroy_all_children();
        if (status.components.length > 0) {
            const affected = [];
            const operational = [];
            for (const c of status.components) {
                const eff = c.children?.length > 0
                    ? [c.status, ...c.children.map(ch => ch.status)]
                        .sort((a, b) => (SEVERITY_ORDER[a] ?? 3) - (SEVERITY_ORDER[b] ?? 3))[0]
                    : c.status;
                if (eff !== 'operational' && eff !== 'unknown') affected.push({component: c, eff});
                else operational.push(c);
            }
            if (affected.length > 0) {
                this._sectionLabel(this._content, 'AFFECTED');
                const limit = 3;
                const visible = affected.slice(0, limit);
                const hidden  = affected.slice(limit);
                for (const {component, eff} of visible)
                    this._content.add_child(this._buildDetailAffectedCard(component, eff));
                if (hidden.length > 0) {
                    const hiddenBox = new St.BoxLayout({ vertical: true, visible: false });
                    for (const {component, eff} of hidden)
                        hiddenBox.add_child(this._buildDetailAffectedCard(component, eff));
                    const showMoreBtn = new St.Button({ style_class: 'statusdot-show-more-btn', x_expand: true });
                    const showMoreLbl = new St.Label({
                        text: `Show ${hidden.length} more affected`,
                        style_class: 'dim-label',
                        style: 'font-size: 12px;',
                        x_align: Clutter.ActorAlign.CENTER,
                        y_align: Clutter.ActorAlign.CENTER,
                    });
                    showMoreBtn.set_child(showMoreLbl);
                    showMoreBtn.connect('clicked', () => {
                        hiddenBox.show();
                        showMoreBtn.hide();
                    });
                    this._content.add_child(showMoreBtn);
                    this._content.add_child(hiddenBox);
                }
            }
            if (operational.length > 0) {
                this._sectionLabel(this._content, affected.length > 0 ? 'OPERATIONAL' : 'COMPONENTS');
                for (const c of operational) {
                    if (c.children?.length > 0) this._groupRow(this._content, c);
                    else this._dotRow(this._content, c.name, c.status);
                }
            }
        }

        this._incidents.destroy_all_children();
        if (status.incidents.length > 0) {
            this._buildIncidentSection(this._incidents, status.incidents);
            this._incidents.show();
        } else {
            this._incidents.hide();
        }

    }

    _renderNoProviders() {
        this._gridContainer.hide();
        this._scroll.show();
        this._applyPanelWidth(PANEL_WIDTH);

        this._header.destroy_all_children();
        this._header.add_child(new St.Label({
            text: 'No providers enabled',
            style: 'font-size: 15px; font-weight: bold;',
        }));

        this._content.destroy_all_children();
        this._incidents.destroy_all_children();
        this._incidents.hide();
        this._content.add_child(new St.Label({
            text: 'No providers enabled. Enable some in Settings.',
            style: 'margin-top: 8px;',
        }));

    }

    _renderError() {
        this._isErrorState = true;
        this._dot.style_class = 'status-dot status-gray';

        this._gridContainer.hide();
        this._scroll.show();
        this._applyPanelWidth(PANEL_WIDTH);

        this._header.destroy_all_children();
        this._header.add_child(new St.Label({
            text: 'Could not reach services',
            style: 'font-size: 15px; font-weight: bold;',
        }));

        this._content.destroy_all_children();
        this._incidents.destroy_all_children();
        this._incidents.hide();
        this._content.add_child(new St.Label({
            text: 'Could not fetch service status.',
            style: 'margin-top: 8px;',
        }));
    }

    // ── Detail header ─────────────────────────────────────────────────────────

    _buildDetailHeader(status) {
        const provider = PROVIDERS.find(p => p.id === status.id);
        const gicon    = provider
            ? Gio.icon_new_for_string(`${this.path}/icons/${provider.icon}.svg`)
            : null;

        const row = new St.BoxLayout({ style: 'spacing: 8px;' });

        if (this._activeProviders().length > 1) {
            const backBtn = new St.Button({ style_class: 'statusdot-back-button' });
            backBtn.set_child(new St.Label({ text: '‹', style: 'font-size: 20px; font-weight: bold;' }));
            backBtn.connect('clicked', () => {
                this._currentProviderId = null;
                this._renderCurrentView();
            });
            row.add_child(backBtn);
        }

        if (gicon)
            row.add_child(new St.Icon({ gicon, icon_size: 20, y_align: Clutter.ActorAlign.CENTER }));
        row.add_child(new St.Label({ text: status.name, style: 'font-size: 15px; font-weight: bold;', y_align: Clutter.ActorAlign.CENTER }));

        if (provider) {
            if (provider.web) {
                const webUrl = provider.web;
                const linkIcon = new St.Icon({
                    gicon: Gio.icon_new_for_string(`${this.path}/icons/external-link-symbolic.svg`),
                    icon_size: 16,
                    y_align: Clutter.ActorAlign.CENTER,
                    style_class: 'statusdot-link-icon',
                    reactive: true,
                });
                linkIcon.connect('button-press-event', () => {
                    try { Gio.AppInfo.launch_default_for_uri(webUrl, null); } catch (_e) { console.error('[StatusDot] failed to open URL', _e); }
                    this._hidePanel();
                    return Clutter.EVENT_STOP;
                });
                row.add_child(linkIcon);
            }
        }

        row.add_child(new St.Widget({ x_expand: true }));
        row.add_child(this._buildStatusPill(status.overallStatus));
        this._header.add_child(row);

        const leaves = [];
        for (const c of status.components) {
            if (c.children?.length > 0) for (const ch of c.children) leaves.push(ch.status);
            else leaves.push(c.status);
        }
        if (leaves.length > 0) {
            const ok = leaves.filter(s => s === 'operational').length;
            this._header.add_child(new St.Label({
                text: `${ok}/${leaves.length} components operational`,
                style_class: 'dim-label',
                style: 'margin-top: 2px; font-size: 12px;',
            }));
            const MAX_SEGMENTS = 40;
            const segments = leaves.length <= MAX_SEGMENTS ? leaves : Array.from({length: MAX_SEGMENTS}, (_, i) => {
                const start = Math.floor(i * leaves.length / MAX_SEGMENTS);
                const end   = Math.floor((i + 1) * leaves.length / MAX_SEGMENTS);
                return leaves.slice(start, end).sort((a, b) => (SEVERITY_ORDER[a] ?? 3) - (SEVERITY_ORDER[b] ?? 3))[0];
            });
            const progressBar = new St.BoxLayout({ style: 'spacing: 2px; padding-top: 8px;' });
            for (const s of segments) {
                progressBar.add_child(new St.Widget({
                    style_class: `statusdot-progress-segment ${colorClass(s)}`,
                    x_expand: true,
                }));
            }
            this._header.add_child(progressBar);
        }
    }

    _buildDetailAffectedCard(component, effectiveStatus) {
        const cls = colorClass(effectiveStatus);

        const bar = new St.Widget({
            style_class: `statusdot-alert-bar ${cls}`,
            y_align: Clutter.ActorAlign.FILL,
        });

        const textCol = new St.BoxLayout({ vertical: true, x_expand: true });
        textCol.add_child(new St.Label({
            text: component.name,
            style: 'font-weight: bold; font-size: 13px;',
            y_align: Clutter.ActorAlign.CENTER,
        }));
        if (component.description) {
            const desc = new St.Label({
                text: component.description,
                style_class: 'dim-label',
                style: 'font-size: 11px; margin-top: 2px;',
            });
            desc.clutter_text.line_wrap = true;
            desc.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            textCol.add_child(desc);
        } else if (component.children?.length > 0) {
            const n = component.children.filter(ch => ch.status !== 'operational' && ch.status !== 'unknown').length;
            if (n > 0) {
                textCol.add_child(new St.Label({
                    text: `${n}/${component.children.length} sub-components affected`,
                    style_class: 'dim-label',
                    style: 'font-size: 11px; margin-top: 2px;',
                }));
            }
        }

        const rightCol = new St.BoxLayout({ style: 'spacing: 6px;', y_align: Clutter.ActorAlign.CENTER });
        rightCol.add_child(new St.Label({
            text: statusLabel(effectiveStatus),
            style_class: cls,
            style: 'font-size: 11px;',
            y_align: Clutter.ActorAlign.CENTER,
        }));
        rightCol.add_child(new St.Widget({
            style_class: `statusdot-row-dot ${cls}`,
            y_align: Clutter.ActorAlign.CENTER,
        }));

        const contentRow = new St.BoxLayout({ x_expand: true, style: 'spacing: 8px; padding: 10px 10px 10px 8px;' });
        contentRow.add_child(textCol);
        contentRow.add_child(rightCol);

        const cardBox = new St.BoxLayout({ x_expand: true });
        cardBox.add_child(bar);
        cardBox.add_child(contentRow);

        const card = new St.BoxLayout({
            style_class: `statusdot-alert-card ${cls}`,
            x_expand: true,
        });
        card.add_child(cardBox);
        return card;
    }

    _buildStatusPill(status) {
        const pill = new St.BoxLayout({
            style_class: `statusdot-status-pill ${colorClass(status)}`,
            y_align: Clutter.ActorAlign.CENTER,
        });
        pill.add_child(new St.Widget({
            style_class: `statusdot-row-dot ${colorClass(status)}`,
            y_align: Clutter.ActorAlign.CENTER,
        }));
        pill.add_child(new St.Label({ text: statusLabel(status), style: 'font-size: 13px;', y_align: Clutter.ActorAlign.CENTER }));
        return pill;
    }

    // ── Content row builders ──────────────────────────────────────────────────

    _sectionLabel(container, text) {
        container.add_child(new St.Label({ text, style_class: 'statusdot-section-label' }));
    }

    _dotRow(container, text, status) {
        const row = new St.BoxLayout({ style: 'padding: 5px 0; spacing: 8px;' });
        row.add_child(new St.Label({ text, x_expand: true, y_align: Clutter.ActorAlign.CENTER }));
        if (status !== 'operational' && status !== 'unknown') {
            row.add_child(new St.Label({
                text: statusLabel(status),
                style_class: colorClass(status),
                style: 'font-size: 11px;',
                y_align: Clutter.ActorAlign.CENTER,
            }));
        }
        row.add_child(new St.Widget({
            style_class: `statusdot-row-dot ${colorClass(status)}`,
            y_align: Clutter.ActorAlign.CENTER,
        }));
        container.add_child(row);
    }

    _groupRow(container, group) {
        const chevron = new St.Label({text: '▸', style_class: 'statusdot-group-chevron', y_align: Clutter.ActorAlign.CENTER});

        const row = new St.BoxLayout({x_expand: true, style: 'spacing: 6px;'});
        row.add_child(chevron);
        row.add_child(new St.Label({text: group.name, x_expand: true, y_align: Clutter.ActorAlign.CENTER}));
        if (group.status !== 'operational' && group.status !== 'unknown') {
            row.add_child(new St.Label({
                text: statusLabel(group.status),
                style_class: colorClass(group.status),
                style: 'font-size: 11px;',
                y_align: Clutter.ActorAlign.CENTER,
            }));
        }
        row.add_child(new St.Widget({
            style_class: `statusdot-row-dot ${colorClass(group.status)}`,
            y_align: Clutter.ActorAlign.CENTER,
        }));

        const toggleBtn = new St.Button({style_class: 'statusdot-group-toggle', x_expand: true});
        toggleBtn.set_child(row);

        const childrenBox = new St.BoxLayout({vertical: true, visible: false, style: 'padding-left: 16px;'});
        const sorted = [...group.children].sort((a, b) => (SEVERITY_ORDER[a.status] ?? 3) - (SEVERITY_ORDER[b.status] ?? 3));
        for (const child of sorted)
            this._dotRow(childrenBox, child.name, child.status);

        toggleBtn.connect('clicked', () => {
            childrenBox.visible = !childrenBox.visible;
            chevron.text = childrenBox.visible ? '▾' : '▸';
        });

        container.add_child(toggleBtn);
        container.add_child(childrenBox);
    }

    // ── Incidents ─────────────────────────────────────────────────────────────

    _buildIncidentSection(container, incidents) {
        const headerText = incidents.length === 1 ? 'Incident (1)' : `Incidents (${incidents.length})`;

        const body = new St.BoxLayout({ vertical: true, x_expand: true });
        const scroll = new St.ScrollView({
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            x_expand: true,
            style: 'max-height: 300px;',
            visible: this._incidentExpanded,
        });
        scroll.set_child(body);

        const toggleRow = new St.BoxLayout({ x_expand: true });
        toggleRow.add_child(new St.Label({ text: headerText, style: 'font-weight: bold; font-size: 13px;', x_expand: true, y_align: Clutter.ActorAlign.CENTER }));
        const chevron = new St.Label({ text: this._incidentExpanded ? '▾' : '▸', style_class: 'statusdot-incident-chevron', y_align: Clutter.ActorAlign.CENTER });
        toggleRow.add_child(chevron);

        const toggleBtn = new St.Button({ style_class: 'statusdot-incident-toggle', x_expand: true });
        toggleBtn.set_child(toggleRow);
        toggleBtn.connect('clicked', () => {
            this._incidentExpanded = !this._incidentExpanded;
            scroll.visible = this._incidentExpanded;
            chevron.text = this._incidentExpanded ? '▾' : '▸';
        });
        container.add_child(toggleBtn);
        container.add_child(scroll);

        for (const [i, incident] of incidents.entries()) {
            if (i > 0)
                body.add_child(new St.Widget({ style_class: 'statusdot-separator', x_expand: true, style: 'margin: 6px 0;' }));

            // [●]  Name (bold)
            //      Status · Started X ago
            const nameCol = new St.BoxLayout({ vertical: true, x_expand: true });
            nameCol.add_child(new St.Label({ text: incident.name, style: 'font-weight: bold; font-size: 14px;' }));
            nameCol.add_child(new St.Label({
                text: `${INCIDENT_STATUS_LABEL[incident.status] ?? incident.status}  ·  Started ${formatRelative(incident.startedAt)}`,
                style_class: 'dim-label',
                style: 'margin-top: 2px; margin-bottom: 6px; font-size: 12px;',
            }));

            const nameRow = new St.BoxLayout({ style: 'margin-top: 6px; spacing: 6px;' });
            nameRow.add_child(new St.Label({ text: '●', style_class: colorClass(incident.impact), y_align: Clutter.ActorAlign.START }));
            nameRow.add_child(nameCol);
            body.add_child(nameRow);

            for (const update of incident.updates) {
                const card = new St.BoxLayout({ vertical: true, style_class: 'statusdot-update-card', x_expand: true });
                const bodyLbl = new St.Label({ text: update.body, x_expand: true });
                bodyLbl.clutter_text.line_wrap = true;
                bodyLbl.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
                card.add_child(bodyLbl);
                card.add_child(new St.Label({
                    text: formatRelative(update.createdAt),
                    style_class: 'dim-label',
                    style: 'margin-top: 4px; font-size: 11px;',
                }));
                body.add_child(card);
            }
        }
    }

    // ── Spinner ───────────────────────────────────────────────────────────────

    _startSpinner() {
        if (!this._refreshBtn) return;
        this._refreshBtn.reactive = false;
        this._refreshStart = Date.now();
        this._spinnerFrame = 0;
        this._refreshLabel.text = SPINNER_FRAMES[0];
        this._refreshIcon.hide();
        this._spinnerTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
            if (!this._refreshLabel) return GLib.SOURCE_REMOVE;
            this._spinnerFrame = (this._spinnerFrame + 1) % SPINNER_FRAMES.length;
            this._refreshLabel.text = SPINNER_FRAMES[this._spinnerFrame];
            return GLib.SOURCE_CONTINUE;
        });
    }

    _stopSpinner() {
        if (this._spinnerStopTimer) {
            GLib.Source.remove(this._spinnerStopTimer);
            this._spinnerStopTimer = null;
        }
        if (this._spinnerTimer) {
            GLib.Source.remove(this._spinnerTimer);
            this._spinnerTimer = null;
        }
        if (this._refreshBtn) {
            this._refreshLabel.text   = 'Refresh';
            this._refreshIcon.show();
            this._refreshBtn.reactive = true;
        }
    }

    // ── Polling ───────────────────────────────────────────────────────────────

    _refresh(showSpinner = false) {
        if (this._fetching) return;
        this._fetching = true;
        if (showSpinner) this._startSpinner();

        const all         = this._activeProviders();
        const providers   = showSpinner && this._currentProviderId
            ? all.filter(p => p.id === this._currentProviderId)
            : all;
        const isFullRefresh = providers.length === all.length;
        let pending       = providers.length;
        let anyError      = false;
        let anySuccess    = false;

        if (pending === 0) {
            this._fetching = false;
            this._renderCurrentView();
            if (showSpinner) this._stopSpinner();
            return;
        }

        for (const provider of providers) {
            const t0 = Date.now();
            fetchStatus(this._session, provider, (error, status) => {
                const ms = Date.now() - t0;
                if (error) {
                    anyError = true;
                    console.error(`[StatusDot] ${provider.name}: error — ${error.message} (${ms}ms)`);
                } else {
                    anySuccess = true;
                    const prev = this._statuses[provider.id]?.overallStatus;
                    this._statuses[provider.id] = status;
                    console.log(`[StatusDot] ${provider.name}: ok (${ms}ms)`);
                    const next = status.overallStatus;
                    if (this._settings?.get_boolean('notifications-enabled') &&
                        prev && prev !== next &&
                        prev !== 'unknown' && next !== 'unknown') {
                        if (prev === 'operational')
                            Main.notify(`${provider.name} is down`, statusLabel(next));
                        else if (next === 'operational')
                            Main.notify(`${provider.name} recovered`, 'Back to operational');
                    }
                }

                pending--;
                if (pending > 0) return;

                // All providers have responded
                this._fetching = false;
                if (!this._button) return;

                if (anyError && !anySuccess && isFullRefresh) {
                    this._consecutiveErrors++;
                    console.error(`[StatusDot] all providers failed (${this._consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS})`);
                    if (this._consecutiveErrors >= MAX_CONSECUTIVE_ERRORS)
                        this._renderError();
                    else
                        this._renderCurrentView();
                } else {
                    if (anyError)
                        console.warn('[StatusDot] some providers failed, showing partial data');
                    if (anySuccess) {
                        this._isErrorState = false;
                        this._consecutiveErrors = 0;
                    }
                    this._renderCurrentView();
                }

                if (showSpinner) {
                    const remaining = Math.max(0, 2000 - (Date.now() - this._refreshStart));
                    if (remaining > 0)
                        this._spinnerStopTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, remaining, () => {
                            this._spinnerStopTimer = null;
                            this._stopSpinner();
                            return GLib.SOURCE_REMOVE;
                        });
                    else
                        this._stopSpinner();
                }
            });
        }
    }

    _startPolling() {
        this._timer = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            this._settings?.get_int('poll-interval') ?? 60,
            () => { this._refresh(); return GLib.SOURCE_CONTINUE; }
        );
    }

    _stopPolling() {
        if (this._timer) {
            GLib.Source.remove(this._timer);
            this._timer = null;
        }
    }
}
