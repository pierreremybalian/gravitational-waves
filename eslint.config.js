import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import astro from 'eslint-plugin-astro';
import globals from 'globals';

export default [
  { ignores: ['dist/', '.astro/', 'node_modules/', 'scripts/.venv/', 'scripts/cache/', 'public/', 'scratch/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...astro.configs.recommended,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    // The rhythm core runs in the AudioWorklet and in tests: no DOM, no Web Audio, no wall clock.
    files: ['src/rhythm/**/*.ts'],
    rules: {
      'no-restricted-globals': ['error', 'window', 'document', 'performance', 'navigator', 'localStorage', 'AudioContext', 'requestAnimationFrame', 'setTimeout'],
    },
  },
];
