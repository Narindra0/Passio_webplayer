export default [
  {
    files: ['src/**/*.{js,jsx,ts,tsx}'],
    ignores: ['dist/*', 'node_modules/*'],
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-undef': 'error',
    },
  },
];
