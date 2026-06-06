import {describe, it, expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {stripHtml, wrapText, normalizeStatuspage, normalizeStatusio, normalizeSlack, SLACK_SERVICES} from '../src/lib.js';

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
});
