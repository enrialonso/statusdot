import GLib from 'gi://GLib';
import Soup from 'gi://Soup';
import {normalizeStatuspage, normalizeStatusio, normalizeSlack} from './lib.js';
export {PROVIDERS} from './providers-data.js';


// ─── Fetch ────────────────────────────────────────────────────────────────────

function _fetchAndNormalize(normalize, session, provider, callback) {
    const message = Soup.Message.new('GET', provider.url);
    session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (_session, result) => {
        try {
            const bytes = _session.send_and_read_finish(result);
            if (message.get_status() !== Soup.Status.OK) {
                callback(new Error(`HTTP ${message.get_status()}`), null);
                return;
            }
            callback(null, normalize(JSON.parse(new TextDecoder().decode(bytes.get_data())), provider));
        } catch (error) {
            callback(error, null);
        }
    });
}

export function fetchStatus(session, provider, callback) {
    const normalize = provider.type === 'statusio' ? normalizeStatusio
                   : provider.type === 'slack'    ? normalizeSlack
                   : normalizeStatuspage;
    _fetchAndNormalize(normalize, session, provider, callback);
}
