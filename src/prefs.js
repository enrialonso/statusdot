import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import {PROVIDERS} from './providers-data.js';

export default class StatusDotPreferences extends ExtensionPreferences {

    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage();
        window.add(page);

        // ── Notifications ─────────────────────────────────────────────────────
        const notifGroup = new Adw.PreferencesGroup({ title: 'Notifications' });
        page.add(notifGroup);

        const notifRow = new Adw.SwitchRow({
            title:    'Enable notifications',
            subtitle: 'Notify when a service goes down or recovers',
        });
        settings.bind('notifications-enabled', notifRow, 'active', 0);
        notifGroup.add(notifRow);

        // ── Polling ───────────────────────────────────────────────────────────
        const pollingGroup = new Adw.PreferencesGroup({ title: 'Polling' });
        page.add(pollingGroup);

        const intervalRow = new Adw.SpinRow({
            title:    'Refresh interval',
            subtitle: 'Seconds between service status checks',
            adjustment: new Gtk.Adjustment({
                lower:          10,
                upper:          3600,
                step_increment: 10,
                value:          settings.get_int('poll-interval'),
            }),
        });
        settings.bind('poll-interval', intervalRow, 'value', 0 /* DEFAULT */);
        pollingGroup.add(intervalRow);

        // ── Providers ─────────────────────────────────────────────────────────
        const providersGroup = new Adw.PreferencesGroup({
            title:       'Providers',
            description: 'Choose which services to monitor in your panel.',
        });
        page.add(providersGroup);

        // "Disable all" / "Enable all" button in the group header
        const toggleAllBtn = new Gtk.Button({ valign: Gtk.Align.CENTER });
        toggleAllBtn.add_css_class('flat');
        providersGroup.set_header_suffix(toggleAllBtn);

        let disabled;
        try {
            disabled = settings.get_strv('disabled-providers');
        } catch (_e) {
            console.error('[StatusDot] prefs: could not read disabled-providers', _e);
            disabled = [];
        }

        // Build switch rows
        const rows = [];
        for (const provider of PROVIDERS) {
            try {
                const gicon = Gio.icon_new_for_string(`${this.path}/icons/${provider.icon}.svg`);
                const icon  = new Gtk.Image({ gicon, pixel_size: 20 });

                const row = new Adw.SwitchRow({
                    title:  provider.name,
                    active: !disabled.includes(provider.id),
                });
                row.add_prefix(icon);
                rows.push({ row, provider });
                providersGroup.add(row);
            } catch (_e) {
                console.error(`[StatusDot] prefs: failed to build row for ${provider.id}`, _e);
            }
        }

        // Update toggle-all button label based on current state
        const _updateToggleBtn = () => {
            const current = settings.get_strv('disabled-providers');
            toggleAllBtn.label = current.length === 0 ? 'Disable all' : 'Enable all';
        };
        _updateToggleBtn();

        toggleAllBtn.connect('clicked', () => {
            const current = settings.get_strv('disabled-providers');
            if (current.length === 0) {
                settings.set_strv('disabled-providers', PROVIDERS.map(p => p.id));
                for (const {row} of rows) row.active = false;
            } else {
                settings.set_strv('disabled-providers', []);
                for (const {row} of rows) row.active = true;
            }
            _updateToggleBtn();
        });

        // Keep toggle-all button label in sync when individual rows change
        for (const {row, provider} of rows) {
            row.connect('notify::active', () => {
                const current = settings.get_strv('disabled-providers');
                if (row.active)
                    settings.set_strv('disabled-providers', current.filter(id => id !== provider.id));
                else if (!current.includes(provider.id))
                    settings.set_strv('disabled-providers', [...current, provider.id]);
                _updateToggleBtn();
            });
        }
    }
}
