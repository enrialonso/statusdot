// ─── Provider list ────────────────────────────────────────────────────────────
// Pure data — no GI imports so this module is safe to load in any context
// (extension, prefs, tests).

export const PROVIDERS = [
    // ── Core dev infrastructure ───────────────────────────────────────────────
    {
        id:     'github',
        name:   'GitHub',
        url:    'https://www.githubstatus.com/api/v2/summary.json',
        web:    'https://www.githubstatus.com',
        icon:   'github-symbolic',
        hidden: new Set(['Visit www.githubstatus.com for more information']),
    },
    {
        id:     'npm',
        name:   'npm',
        url:    'https://status.npmjs.org/api/v2/summary.json',
        web:    'https://status.npmjs.org',
        icon:   'npm-symbolic',
    },
    {
        id:     'cloudflare',
        name:   'Cloudflare',
        url:    'https://www.cloudflarestatus.com/api/v2/summary.json',
        web:    'https://www.cloudflarestatus.com',
        icon:   'cloudflare-symbolic',
    },
    {
        id:     'docker',
        name:   'Docker',
        url:    'https://api.status.io/1.0/status/533c6539221ae15e3f000031',
        web:    'https://www.dockerstatus.com',
        icon:   'docker-symbolic',
        type:   'statusio',
    },
    // ── Code hosting & CI/CD ─────────────────────────────────────────────────
    {
        id:     'gitlab',
        name:   'GitLab',
        url:    'https://api.status.io/1.0/status/5b36dc6502d06804c08349f7',
        web:    'https://status.gitlab.com',
        icon:   'gitlab-symbolic',
        type:   'statusio',
    },
    {
        id:     'bitbucket',
        name:   'Bitbucket',
        url:    'https://bitbucket.status.atlassian.com/api/v2/summary.json',
        web:    'https://bitbucket.status.atlassian.com',
        icon:   'bitbucket-symbolic',
    },
    {
        id:     'circleci',
        name:   'CircleCI',
        url:    'https://status.circleci.com/api/v2/summary.json',
        web:    'https://status.circleci.com',
        icon:   'circleci-symbolic',
    },
    // ── Cloud & deployment ────────────────────────────────────────────────────
    {
        id:     'vercel',
        name:   'Vercel',
        url:    'https://www.vercel-status.com/api/v2/summary.json',
        web:    'https://www.vercel-status.com',
        icon:   'vercel-symbolic',
    },
    {
        id:     'netlify',
        name:   'Netlify',
        url:    'https://www.netlifystatus.com/api/v2/summary.json',
        web:    'https://www.netlifystatus.com',
        icon:   'netlify-symbolic',
    },
    {
        id:     'digitalocean',
        name:   'DigitalOcean',
        url:    'https://status.digitalocean.com/api/v2/summary.json',
        web:    'https://status.digitalocean.com',
        icon:   'digitalocean-symbolic',
    },
    // ── AI ────────────────────────────────────────────────────────────────────
    {
        id:     'openai',
        name:   'OpenAI',
        url:    'https://status.openai.com/api/v2/summary.json',
        web:    'https://status.openai.com',
        icon:   'openai-symbolic',
    },
    {
        id:     'anthropic',
        name:   'Anthropic',
        url:    'https://status.anthropic.com/api/v2/summary.json',
        web:    'https://status.anthropic.com',
        icon:   'anthropic-symbolic',
    },
    // ── Databases ─────────────────────────────────────────────────────────────
    {
        id:     'mongodb',
        name:   'MongoDB',
        url:    'https://status.mongodb.com/api/v2/summary.json',
        web:    'https://status.mongodb.com',
        icon:   'mongodb-symbolic',
    },
    {
        id:     'supabase',
        name:   'Supabase',
        url:    'https://status.supabase.com/api/v2/summary.json',
        web:    'https://status.supabase.com',
        icon:   'supabase-symbolic',
    },
    // ── Payments ──────────────────────────────────────────────────────────────
    {
        id:     'stripe',
        name:   'Stripe',
        url:    'https://www.stripestatus.com/api/v2/summary.json',
        web:    'https://www.stripestatus.com',
        icon:   'stripe-symbolic',
    },
    // ── Observability ─────────────────────────────────────────────────────────
    {
        id:     'datadog',
        name:   'Datadog',
        url:    'https://status.datadoghq.com/api/v2/summary.json',
        web:    'https://status.datadoghq.com',
        icon:   'datadog-symbolic',
    },
    {
        id:     'sentry',
        name:   'Sentry',
        url:    'https://status.sentry.io/api/v2/summary.json',
        web:    'https://status.sentry.io',
        icon:   'sentry-symbolic',
    },
    {
        id:     'newrelic',
        name:   'New Relic',
        url:    'https://status.newrelic.com/api/v2/summary.json',
        web:    'https://status.newrelic.com',
        icon:   'newrelic-symbolic',
    },
    // ── Communication ─────────────────────────────────────────────────────────
    {
        id:     'slack',
        name:   'Slack',
        url:    'https://slack-status.com/api/v2.0.0/current',
        web:    'https://slack-status.com',
        icon:   'slack-symbolic',
        type:   'slack',
    },
    {
        id:     'discord',
        name:   'Discord',
        url:    'https://discordstatus.com/api/v2/summary.json',
        web:    'https://discordstatus.com',
        icon:   'discord-symbolic',
    },
    // ── Developer tools ───────────────────────────────────────────────────────
    {
        id:     'sendgrid',
        name:   'SendGrid',
        url:    'https://status.sendgrid.com/api/v2/summary.json',
        web:    'https://status.sendgrid.com',
        icon:   'sendgrid-symbolic',
    },
    {
        id:     'postman',
        name:   'Postman',
        url:    'https://status.postman.com/api/v2/summary.json',
        web:    'https://status.postman.com',
        icon:   'postman-symbolic',
    },
    {
        id:     'linear',
        name:   'Linear',
        url:    'https://linearstatus.com/api/v2/summary.json',
        web:    'https://linearstatus.com',
        icon:   'linear-symbolic',
    },
    {
        id:     'jira',
        name:   'Jira',
        url:    'https://jira-software.status.atlassian.com/api/v2/summary.json',
        web:    'https://jira-software.status.atlassian.com',
        icon:   'jira-symbolic',
    },
    {
        id:     'figma',
        name:   'Figma',
        url:    'https://status.figma.com/api/v2/summary.json',
        web:    'https://status.figma.com',
        icon:   'figma-symbolic',
    },
    // ── Docs & collaboration ──────────────────────────────────────────────────
    {
        id:     'confluence',
        name:   'Confluence',
        url:    'https://confluence.status.atlassian.com/api/v2/summary.json',
        web:    'https://confluence.status.atlassian.com',
        icon:   'confluence-symbolic',
    },
    {
        id:     'notion',
        name:   'Notion',
        url:    'https://www.notion-status.com/api/v2/summary.json',
        web:    'https://www.notion-status.com',
        icon:   'notion-symbolic',
    },
    // ── E-commerce ────────────────────────────────────────────────────────────
    {
        id:     'shopify',
        name:   'Shopify',
        url:    'https://www.shopifystatus.com/api/v2/summary.json',
        web:    'https://www.shopifystatus.com',
        icon:   'shopify-symbolic',
    },
];
