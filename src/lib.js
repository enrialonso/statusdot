// ─── Status mappings ──────────────────────────────────────────────────────────

const OVERALL_STATUS_MAP = {
    none:     'operational',
    minor:    'degraded',
    major:    'partial_outage',
    critical: 'major_outage',
};

const COMPONENT_STATUS_MAP = {
    operational:          'operational',
    degraded_performance: 'degraded',
    partial_outage:       'partial_outage',
    major_outage:         'major_outage',
    under_maintenance:    'degraded',
};

const STATUSIO_MAP = {
    100: 'operational',
    200: 'degraded',
    300: 'partial_outage',
    400: 'major_outage',
    500: 'major_outage',
};

const STATUSIO_INCIDENT_STATUS = {
    100: 'investigating',
    200: 'identified',
    300: 'monitoring',
    400: 'resolved',
};

export const SLACK_SERVICES = [
    'Login/SSO', 'Connectivity', 'Messaging', 'Files',
    'Notifications', 'Huddles', 'Search', 'Apps/Integrations/APIs',
    'Workspace/Org Administration', 'Workflows', 'Canvases',
];

// ─── Text helpers ─────────────────────────────────────────────────────────────

export function stripHtml(html) {
    return html
        .replace(/<br\s*\/?>\s*<br\s*\/?>/gi, '\n')
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<[^>]+>/g, '')
        .trim();
}

export function wrapText(text, maxLen = 80) {
    return text.split('\n').map(para => {
        if (para.length <= maxLen) return para;
        const words = para.split(' ');
        const lines = [];
        let line = '';
        for (const word of words) {
            const next = line ? `${line} ${word}` : word;
            if (next.length > maxLen && line) { lines.push(line); line = word; }
            else line = next;
        }
        if (line) lines.push(line);
        return lines.join('\n');
    }).join('\n');
}

// ─── Normalizers ──────────────────────────────────────────────────────────────

export function normalizeStatuspage(json, provider) {
    const allComps = json.components ?? [];
    const groupMap = new Map();
    const components = [];

    for (const c of allComps) {
        if (!c.group || provider.hidden?.has(c.name)) continue;
        const g = {name: c.name, status: COMPONENT_STATUS_MAP[c.status] ?? 'unknown', description: c.description ?? null, children: []};
        groupMap.set(c.id, g);
        components.push(g);
    }
    for (const c of allComps) {
        if (c.group || provider.hidden?.has(c.name)) continue;
        const entry = {name: c.name, status: COMPONENT_STATUS_MAP[c.status] ?? 'unknown', description: c.description ?? null};
        if (c.group_id && groupMap.has(c.group_id))
            groupMap.get(c.group_id).children.push(entry);
        else
            components.push(entry);
    }

    return {
        id:            provider.id,
        name:          provider.name,
        overallStatus: OVERALL_STATUS_MAP[json.status?.indicator] ?? 'unknown',
        components,
        incidents: (json.incidents ?? []).map(i => ({
            name:      i.name,
            impact:    OVERALL_STATUS_MAP[i.impact] ?? 'unknown',
            status:    i.status,
            startedAt: new Date(i.started_at ?? i.created_at),
            updates:   (i.incident_updates ?? []).map(u => ({
                body:      wrapText(stripHtml(u.body ?? '')),
                createdAt: new Date(u.created_at),
            })),
        })),
    };
}

export function normalizeStatusio(json, provider) {
    const result = json.result;
    const overallCode = result.status_overall?.status_code ?? 0;
    return {
        id:            provider.id,
        name:          provider.name,
        overallStatus: STATUSIO_MAP[overallCode] ?? 'unknown',
        components:    (result.status ?? []).map(c => ({
            name:   c.name,
            status: STATUSIO_MAP[c.status_code] ?? 'unknown',
        })),
        incidents: (result.incidents ?? []).map(i => ({
            name:      i.name,
            impact:    STATUSIO_MAP[i.impact] ?? 'unknown',
            status:    STATUSIO_INCIDENT_STATUS[i.status] ?? 'investigating',
            startedAt: new Date(i.started ?? i.datetime),
            updates:   (i.updates ?? []).map(u => ({
                body:      wrapText(stripHtml(u.details ?? '')),
                createdAt: new Date(u.datetime),
            })),
        })),
    };
}

export function normalizeSlack(json, provider) {
    const incidents = json.active_incidents ?? [];

    const overallStatus = (json.status === 'ok' && incidents.length === 0)
        ? 'operational'
        : 'partial_outage';

    const affectedServices = new Set();
    for (const incident of incidents)
        for (const service of (incident.services ?? []))
            affectedServices.add(service);

    return {
        id:            provider.id,
        name:          provider.name,
        overallStatus,
        components:    SLACK_SERVICES.map(name => ({
            name,
            status: affectedServices.has(name) ? 'partial_outage' : 'operational',
        })),
        incidents:     incidents.map(i => ({
            name:      i.title,
            impact:    'partial_outage',
            status:    'investigating',
            startedAt: new Date(i.date_created),
            updates:   (i.notes ?? []).map(n => ({
                body:      wrapText(stripHtml(n.body ?? '')),
                createdAt: new Date(n.date_created),
            })),
        })),
    };
}
