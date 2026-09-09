// @ts-check
const tseslint = require('typescript-eslint');
const prettier = require('eslint-config-prettier');

module.exports = tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', '*.config.js'] },
  {
    files: ['**/*.ts'],
    extends: [...tseslint.configs.recommended, prettier],
    languageOptions: {
      parserOptions: { project: './tsconfig.json', tsconfigRootDir: __dirname },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
);
