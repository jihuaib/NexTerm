module.exports = {
    root: true,
    env: {
        browser: true,
        node: true,
        es2021: true
    },
    extends: ['eslint:recommended', 'plugin:vue/vue3-recommended', 'prettier'],
    parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        parser: '@babel/eslint-parser',
        requireConfigFile: false
    },
    plugins: ['vue', 'import'],
    rules: {
        'no-console': process.env.NODE_ENV === 'production' ? 'warn' : 'off',
        'no-debugger': process.env.NODE_ENV === 'production' ? 'warn' : 'off',
        'vue/multi-word-component-names': 'off',
        'vue/html-self-closing': 'off',
        'vue/attribute-hyphenation': 'off',
        'vue/v-on-event-hyphenation': 'off',
        'vue/attributes-order': 'off',
        'vue/valid-define-emits': 'warn',
        'no-unused-vars': [
            'warn',
            {
                vars: 'all',
                varsIgnorePattern: '^_',
                argsIgnorePattern: '^_'
            }
        ],
        'no-case-declarations': 'warn',
        'no-control-regex': 'off',
        'no-undef': 'error',
        'no-dupe-keys': 'error',
        eqeqeq: ['error', 'always'],
        'vue/no-mutating-props': 'off'
    },
    overrides: [
        {
            files: ['electron/**/*.js', 'scripts/**/*.js', 'e2e/**/*.cjs'],
            parserOptions: {
                sourceType: 'script',
                ecmaVersion: 2022
            },
            env: {
                node: true,
                browser: false
            },
            rules: {
                'import/no-commonjs': 'off',
                'import/no-nodejs-modules': 'off'
            }
        },
        {
            files: ['e2e/**/*.cjs'],
            rules: {
                'no-empty-pattern': 'off'
            }
        },
        {
            files: ['src/**/*.js', 'src/**/*.vue'],
            parserOptions: {
                sourceType: 'module',
                ecmaVersion: 2022
            },
            env: {
                browser: true,
                node: false
            },
            globals: {
                defineProps: 'readonly',
                defineEmits: 'readonly',
                defineExpose: 'readonly',
                withDefaults: 'readonly'
            },
            rules: {
                'import/no-commonjs': 'error'
            }
        }
    ]
};
