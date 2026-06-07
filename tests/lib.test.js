import {describe, it, expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {stripHtml, wrapText, normalizeStatuspage, normalizeStatusio, normalizeSlack, SLACK_SERVICES} from '../src/lib.js';
import {PROVIDERS} from '../src/providers-data.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = name => JSON.parse(
    readFileSync(join(__dirname, 'fixtures', name), 'utf-8')
);

const GITHUB = {
    id:     'github',
    name:   'GitHub',
    hidden: new Set(['Visit www.githubstatus.com for more information']),
};

const SIMPLE = {id: 'test', name: 'Test'};

// ─── stripHtml ────────────────────────────────────────────────────────────────

describe('stripHtml', () => {
    it('passes clean text through', () => {
        expect(stripHtml('hello world')).toBe('hello world');
    });

    it('removes HTML tags', () => {
        expect(stripHtml('<p>hello <strong>world</strong></p>')).toBe('hello world');
    });

    it('converts double <br> to newline', () => {
        expect(stripHtml('line one<br><br>line two')).toBe('line one\nline two');
    });

    it('converts single <br> to space', () => {
        expect(stripHtml('line one<br>line two')).toBe('line one line two');
    });

    it('trims leading and trailing whitespace', () => {
        expect(stripHtml('  <p>  text  </p>  ')).toBe('text');
    });
});

// ─── wrapText ─────────────────────────────────────────────────────────────────

describe('wrapText', () => {
    it('leaves short text unchanged', () => {
        expect(wrapText('short text')).toBe('short text');
    });

    it('wraps long lines at word boundaries', () => {
        const long = 'word '.repeat(20).trim();
        const result = wrapText(long, 40);
        for (const line of result.split('\n'))
            expect(line.length).toBeLessThanOrEqual(40);
    });

    it('preserves existing newlines between paragraphs', () => {
        const input = 'first paragraph\nsecond paragraph';
        expect(wrapText(input)).toBe(input);
    });

    it('handles empty string', () => {
        expect(wrapText('')).toBe('');
    });

    it('does not break a single word longer than maxLen', () => {
        const long = 'a'.repeat(100);
        expect(wrapText(long, 40)).toBe(long);
    });
});

// ─── normalizeStatuspage ──────────────────────────────────────────────────────

describe('normalizeStatuspage', () => {
    it('returns operational when all systems ok', () => {
        const result = normalizeStatuspage(fixture('operational.json'), GITHUB);
        expect(result.overallStatus).toBe('operational');
    });

    it('filters out the hidden component', () => {
        const result = normalizeStatuspage(fixture('operational.json'), GITHUB);
        const names = result.components.map(c => c.name);
        expect(names).not.toContain('Visit www.githubstatus.com for more information');
    });

    it('returns 11 components after filtering', () => {
        const result = normalizeStatuspage(fixture('operational.json'), GITHUB);
        expect(result.components).toHaveLength(11);
    });

    it('maps degraded_performance to degraded', () => {
        const result = normalizeStatuspage(fixture('degraded.json'), GITHUB);
        const actions = result.components.find(c => c.name === 'Actions');
        expect(actions.status).toBe('degraded');
    });

    it('maps partial_outage correctly', () => {
        const result = normalizeStatuspage(fixture('degraded.json'), GITHUB);
        const packages = result.components.find(c => c.name === 'Packages');
        expect(packages.status).toBe('partial_outage');
    });

    it('returns degraded overall status for minor indicator', () => {
        const result = normalizeStatuspage(fixture('degraded.json'), GITHUB);
        expect(result.overallStatus).toBe('degraded');
    });

    it('parses incidents correctly', () => {
        const result = normalizeStatuspage(fixture('incident.json'), GITHUB);
        expect(result.incidents).toHaveLength(1);
        expect(result.incidents[0].name).toBe('Actions and Codespaces degraded performance');
        expect(result.incidents[0].updates).toHaveLength(3);
    });

    it('parses incident startedAt as a Date', () => {
        const result = normalizeStatuspage(fixture('incident.json'), GITHUB);
        expect(result.incidents[0].startedAt).toBeInstanceOf(Date);
    });

    it('strips HTML from incident update bodies', () => {
        const json = {
            status: {indicator: 'minor'},
            components: [],
            incidents: [{
                name: 'Test', impact: 'minor', status: 'investigating',
                started_at: new Date().toISOString(),
                incident_updates: [{body: '<p>Hello<br>world</p>', created_at: new Date().toISOString()}],
            }],
        };
        const result = normalizeStatuspage(json, SIMPLE);
        expect(result.incidents[0].updates[0].body).toBe('Hello world');
    });

    it('includes provider id and name', () => {
        const result = normalizeStatuspage(fixture('operational.json'), GITHUB);
        expect(result.id).toBe('github');
        expect(result.name).toBe('GitHub');
    });

    it('attaches children to their group and excludes them from top level', () => {
        const json = {
            status: {indicator: 'none'},
            components: [
                {id: 'g1', name: 'Europe',  group: true,  group_id: null, status: 'partial_outage'},
                {id: 'c1', name: 'Paris',   group: false, group_id: 'g1', status: 'partial_outage'},
                {id: 'c2', name: 'Berlin',  group: false, group_id: 'g1', status: 'operational'},
                {id: 'f1', name: 'API',     group: false, group_id: null, status: 'operational'},
            ],
            incidents: [],
        };
        const result = normalizeStatuspage(json, SIMPLE);
        const topNames = result.components.map(c => c.name);
        expect(topNames).toContain('Europe');
        expect(topNames).toContain('API');
        expect(topNames).not.toContain('Paris');
        expect(topNames).not.toContain('Berlin');
        const europe = result.components.find(c => c.name === 'Europe');
        expect(europe.children).toHaveLength(2);
        expect(europe.children.map(c => c.name)).toContain('Paris');
        expect(europe.children.map(c => c.name)).toContain('Berlin');
    });

    it('maps group container status correctly', () => {
        const json = {
            status: {indicator: 'minor'},
            components: [
                {id: 'g1', name: 'US Region', group: true,  group_id: null, status: 'degraded_performance'},
                {id: 'c1', name: 'us-east-1', group: false, group_id: 'g1', status: 'degraded_performance'},
            ],
            incidents: [],
        };
        const result = normalizeStatuspage(json, SIMPLE);
        expect(result.components).toHaveLength(1);
        expect(result.components[0].name).toBe('US Region');
        expect(result.components[0].status).toBe('degraded');
        expect(result.components[0].children[0].name).toBe('us-east-1');
    });

    it('flat components without group_id remain at top level', () => {
        const json = {
            status: {indicator: 'none'},
            components: [
                {id: 'f1', name: 'API',     group: false, group_id: null, status: 'operational'},
                {id: 'f2', name: 'Billing', group: false, group_id: null, status: 'operational'},
            ],
            incidents: [],
        };
        const result = normalizeStatuspage(json, SIMPLE);
        expect(result.components).toHaveLength(2);
        expect(result.components.every(c => !c.children)).toBe(true);
    });

    it('maps under_maintenance to degraded', () => {
        const json = {
            status: {indicator: 'minor'},
            components: [{id: 'f1', name: 'API', group: false, group_id: null, status: 'under_maintenance'}],
            incidents: [],
        };
        expect(normalizeStatuspage(json, SIMPLE).components[0].status).toBe('degraded');
    });

    it('falls back to unknown for unrecognized overall indicator', () => {
        const json = {status: {indicator: 'catastrophic'}, components: [], incidents: []};
        expect(normalizeStatuspage(json, SIMPLE).overallStatus).toBe('unknown');
    });

    it('falls back to unknown for unrecognized component status', () => {
        const json = {
            status: {indicator: 'none'},
            components: [{id: 'f1', name: 'API', group: false, group_id: null, status: 'something_new'}],
            incidents: [],
        };
        expect(normalizeStatuspage(json, SIMPLE).components[0].status).toBe('unknown');
    });

    it('preserves description on leaf components', () => {
        const json = {
            status: {indicator: 'none'},
            components: [{id: 'f1', name: 'API', group: false, group_id: null, status: 'operational', description: 'The main API'}],
            incidents: [],
        };
        expect(normalizeStatuspage(json, SIMPLE).components[0].description).toBe('The main API');
    });

    it('sets description to null when absent', () => {
        const json = {
            status: {indicator: 'none'},
            components: [{id: 'f1', name: 'API', group: false, group_id: null, status: 'operational'}],
            incidents: [],
        };
        expect(normalizeStatuspage(json, SIMPLE).components[0].description).toBeNull();
    });

    it('preserves description on group containers', () => {
        const json = {
            status: {indicator: 'none'},
            components: [
                {id: 'g1', name: 'Region', group: true,  group_id: null, status: 'operational', description: 'US Region'},
                {id: 'c1', name: 'us-east', group: false, group_id: 'g1', status: 'operational'},
            ],
            incidents: [],
        };
        const region = normalizeStatuspage(json, SIMPLE).components.find(c => c.name === 'Region');
        expect(region.description).toBe('US Region');
    });
});

// ─── normalizeStatusio ────────────────────────────────────────────────────────

describe('normalizeStatusio', () => {
    const make = (code, components = [], incidents = []) => ({
        result: {
            status_overall: {status_code: code},
            status: components,
            incidents,
            maintenance: {},
        },
    });

    it('maps status_code 100 to operational', () => {
        expect(normalizeStatusio(make(100), SIMPLE).overallStatus).toBe('operational');
    });

    it('maps status_code 200 to degraded', () => {
        expect(normalizeStatusio(make(200), SIMPLE).overallStatus).toBe('degraded');
    });

    it('maps status_code 300 to partial_outage', () => {
        expect(normalizeStatusio(make(300), SIMPLE).overallStatus).toBe('partial_outage');
    });

    it('maps status_code 400 to major_outage', () => {
        expect(normalizeStatusio(make(400), SIMPLE).overallStatus).toBe('major_outage');
    });

    it('maps status_code 500 to major_outage', () => {
        expect(normalizeStatusio(make(500), SIMPLE).overallStatus).toBe('major_outage');
    });

    it('maps component status codes', () => {
        const json = make(100, [{name: 'API', status_code: 300}]);
        const result = normalizeStatusio(json, SIMPLE);
        expect(result.components[0].status).toBe('partial_outage');
    });

    it('falls back to unknown for unrecognized status_code', () => {
        expect(normalizeStatusio(make(999), SIMPLE).overallStatus).toBe('unknown');
    });

    it('parses incidents with impact and status', () => {
        const json = make(300, [], [{
            name: 'DB outage', impact: 300, status: 100,
            started: new Date().toISOString(), updates: [],
        }]);
        const result = normalizeStatusio(json, SIMPLE);
        expect(result.incidents).toHaveLength(1);
        expect(result.incidents[0].name).toBe('DB outage');
        expect(result.incidents[0].impact).toBe('partial_outage');
        expect(result.incidents[0].status).toBe('investigating');
    });

    it('maps all STATUSIO_INCIDENT_STATUS codes', () => {
        const makeInc = code => make(100, [], [{
            name: 'x', impact: 100, status: code,
            started: new Date().toISOString(), updates: [],
        }]);
        expect(normalizeStatusio(makeInc(100), SIMPLE).incidents[0].status).toBe('investigating');
        expect(normalizeStatusio(makeInc(200), SIMPLE).incidents[0].status).toBe('identified');
        expect(normalizeStatusio(makeInc(300), SIMPLE).incidents[0].status).toBe('monitoring');
        expect(normalizeStatusio(makeInc(400), SIMPLE).incidents[0].status).toBe('resolved');
    });

    it('falls back to investigating for unknown incident status code', () => {
        const json = make(100, [], [{
            name: 'x', impact: 100, status: 999,
            started: new Date().toISOString(), updates: [],
        }]);
        expect(normalizeStatusio(json, SIMPLE).incidents[0].status).toBe('investigating');
    });

    it('parses incident updates and strips HTML', () => {
        const json = make(300, [], [{
            name: 'DB outage', impact: 300, status: 100,
            started: new Date().toISOString(),
            updates: [{details: '<p>Engineers investigating</p>', datetime: new Date().toISOString()}],
        }]);
        const updates = normalizeStatusio(json, SIMPLE).incidents[0].updates;
        expect(updates).toHaveLength(1);
        expect(updates[0].body).toBe('Engineers investigating');
    });
});

// ─── normalizeSlack ───────────────────────────────────────────────────────────

describe('normalizeSlack', () => {
    it('returns operational when status is ok and no incidents', () => {
        const json = {status: 'ok', active_incidents: []};
        expect(normalizeSlack(json, SIMPLE).overallStatus).toBe('operational');
    });

    it('returns partial_outage when there are active incidents', () => {
        const json = {
            status: 'active',
            active_incidents: [{
                title: 'Outage', date_created: new Date().toISOString(),
                services: ['Messaging'], notes: [],
            }],
        };
        expect(normalizeSlack(json, SIMPLE).overallStatus).toBe('partial_outage');
    });

    it('always returns all SLACK_SERVICES as components', () => {
        const json = {status: 'ok', active_incidents: []};
        const result = normalizeSlack(json, SIMPLE);
        expect(result.components).toHaveLength(SLACK_SERVICES.length);
    });

    it('marks affected services as partial_outage', () => {
        const json = {
            status: 'active',
            active_incidents: [{
                title: 'Outage', date_created: new Date().toISOString(),
                services: ['Messaging', 'Search'], notes: [],
            }],
        };
        const result = normalizeSlack(json, SIMPLE);
        const messaging = result.components.find(c => c.name === 'Messaging');
        const search    = result.components.find(c => c.name === 'Search');
        const login     = result.components.find(c => c.name === 'Login/SSO');
        expect(messaging.status).toBe('partial_outage');
        expect(search.status).toBe('partial_outage');
        expect(login.status).toBe('operational');
    });

    it('parses incidents from active_incidents', () => {
        const json = {
            status: 'active',
            active_incidents: [{
                title: 'Messaging outage', date_created: new Date().toISOString(),
                services: ['Messaging'], notes: [],
            }],
        };
        const result = normalizeSlack(json, SIMPLE);
        expect(result.incidents).toHaveLength(1);
        expect(result.incidents[0].name).toBe('Messaging outage');
        expect(result.incidents[0].impact).toBe('partial_outage');
        expect(result.incidents[0].status).toBe('investigating');
    });

    it('parses incident notes as updates and strips HTML', () => {
        const now = new Date().toISOString();
        const json = {
            status: 'active',
            active_incidents: [{
                title: 'Outage', date_created: now, services: ['Messaging'],
                notes: [{body: '<p>We are looking into it</p>', date_created: now}],
            }],
        };
        const updates = normalizeSlack(json, SIMPLE).incidents[0].updates;
        expect(updates).toHaveLength(1);
        expect(updates[0].body).toBe('We are looking into it');
    });
});

// ─── PROVIDERS data integrity ─────────────────────────────────────────────────

describe('PROVIDERS', () => {
    it('every provider has required fields', () => {
        for (const p of PROVIDERS) {
            expect(p.id,   `${p.name ?? '?'} missing id`).toBeTruthy();
            expect(p.name, `${p.id} missing name`).toBeTruthy();
            expect(p.url,  `${p.id} missing url`).toBeTruthy();
            expect(p.web,  `${p.id} missing web`).toBeTruthy();
            expect(p.icon, `${p.id} missing icon`).toBeTruthy();
        }
    });

    it('all provider ids are unique', () => {
        const ids = PROVIDERS.map(p => p.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('type field is either absent or a known value', () => {
        const validTypes = new Set(['statusio', 'slack', undefined]);
        for (const p of PROVIDERS)
            expect(validTypes.has(p.type), `${p.id} has unknown type: ${p.type}`).toBe(true);
    });
});
