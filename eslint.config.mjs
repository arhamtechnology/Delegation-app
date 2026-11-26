import { FlatCompat } from '@eslint/eslintrc';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const configDirectory = path.dirname(fileURLToPath(import.meta.url));
const compat = new FlatCompat({ baseDirectory: configDirectory });

const moduleDependencies = {
  identity: [],
  notifications: [],
  'work-model': [],
  tasks: ['identity', 'work-model'],
  checklists: ['identity', 'notifications', 'work-model'],
  work: ['identity', 'tasks', 'checklists', 'work-model'],
  whatsapp: ['identity', 'tasks', 'checklists', 'work-model', 'work'],
  fms: ['identity', 'checklists', 'whatsapp', 'work-model'],
};

const modulePaths = (names) => names.map((name) => `./modules/${name}`);
const presentation = ['./app', './components', './hooks'];
const moduleZones = Object.entries(moduleDependencies).map(([name, dependencies]) => ({
  target: `./modules/${name}`,
  from: [...presentation, ...modulePaths(Object.keys(moduleDependencies).filter((other) => other !== name && !dependencies.includes(other)))],
  message: `This import is outside the ${name} module's dependency boundary.`,
}));

const eslintConfig = [
  ...compat.extends('next/core-web-vitals'),
  {
    ignores: ['.next/**', 'node_modules/**'],
  },
  {
    files: ['{app,components,lib,modules}/**/*.{js,jsx,mjs}'],
    settings: {
      'import/extensions': ['.js', '.jsx', '.mjs'],
      'import/resolver': {
        typescript: { project: path.join(configDirectory, 'jsconfig.json') },
      },
    },
    rules: {
      'import/no-cycle': ['error', { ignoreExternal: true }],
      'import/no-restricted-paths': ['error', {
        basePath: configDirectory,
        zones: [
          { target: './lib', from: ['./modules', ...presentation] },
          ...moduleZones,
        ],
      }],
    },
  },
];

export default eslintConfig;
