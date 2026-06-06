import js from '@eslint/js';

export default [
    js.configs.recommended,
    {
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: {
                // GJS built-ins
                global:      'readonly',
                console:     'readonly',
                log:         'readonly',
                logError:    'readonly',
                print:       'readonly',
                printerr:    'readonly',
                TextDecoder: 'readonly',
                TextEncoder: 'readonly',
                // Gettext
                _:           'readonly',
                C_:          'readonly',
                N_:          'readonly',
                ngettext:    'readonly',
            },
        },
        rules: {
            'no-unused-vars': ['error', {
                varsIgnorePattern:        '^_',
                argsIgnorePattern:        '^_',
                caughtErrorsIgnorePattern: '^_',
            }],
        },
    },
];
