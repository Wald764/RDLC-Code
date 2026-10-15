import js from '@eslint/js';
import ts from 'typescript-eslint';
import { builtinModules } from 'node:module';

export default ts.config(
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      'coverage/**',
      'vendor/**',
      '.specify/**',
      '.opencode/**',
      '**/node_modules/**',
      '**/.angular/**',
      '.vscode-test/**',
    ],
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    files: ['packages/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            'node:*',
            ...builtinModules,
            'vscode',
            '@angular/*',
            '../../*',
            '../../../*',
          ],
        },
      ],
    },
  },
  ...Object.entries({
    'report-model': ['@rdlc/*'],
    'xml-parser': [
      '@rdlc/validation',
      '@rdlc/expressions',
      '@rdlc/xml-serializer',
      '@rdlc/renderer',
    ],
    expressions: [
      '@rdlc/validation',
      '@rdlc/xml-parser',
      '@rdlc/xml-serializer',
      '@rdlc/renderer',
    ],
    validation: ['@rdlc/xml-parser', '@rdlc/xml-serializer', '@rdlc/renderer'],
    'xml-serializer': [
      '@rdlc/xml-parser',
      '@rdlc/validation',
      '@rdlc/expressions',
      '@rdlc/renderer',
    ],
    renderer: [
      '@rdlc/xml-parser',
      '@rdlc/validation',
      '@rdlc/expressions',
      '@rdlc/xml-serializer',
    ],
  }).map(([name, forbidden]) => ({
    files: [`packages/${name}/src/**/*.ts`],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            'node:*',
            ...builtinModules,
            'vscode',
            '@angular/*',
            '../../*',
            ...forbidden.flatMap((name) => [name, `${name}/**`]),
          ],
        },
      ],
    },
  })),
  { files: ['**/*.test.ts'], rules: { 'no-restricted-imports': 'off' } },
);
