import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { build } from 'esbuild';

// Render the actual entry point and its components to catch startup errors
// that a successful bundle cannot detect.
const result = await build({
  entryPoints: ['src/admin.jsx'],
  bundle: true, write: false, jsx: 'automatic',
  platform: 'node', format: 'cjs', packages: 'external',
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [{
    name: 'admin-render-check',
    setup(builder) {
      builder.onResolve({ filter: /^react-dom\/server$/ }, () => ({ path: 'react-dom/server', external: true }));
      builder.onResolve({ filter: /^react-dom\/client$/ }, () => ({ path: 'root', namespace: 'check' }));
      builder.onLoad({ filter: /.*/, namespace: 'check' }, () => ({
        contents: `import { renderToString } from 'react-dom/server';
          export const createRoot = () => ({
            render(tree) { globalThis.adminMarkup = renderToString(tree); }
          });`,
      }));
    },
  }],
});

for (const section of ['home', 'projects', 'articles', 'social']) {
  const context = {
    require: createRequire(import.meta.url),
    document: { querySelector: () => ({}), getElementById: () => ({}) },
    location: { search: '?section=' + section },
    URLSearchParams, console,
  };
  vm.runInNewContext(result.outputFiles[0].text, context);
  assert.match(context.adminMarkup, /ARCHI-CREATE/);
  assert.match(context.adminMarkup, new RegExp('href="/admin\\?section=' + section + '" aria-current="page"'));
  assert.doesNotMatch(context.adminMarkup, /section=media/);
  console.log('Admin render OK: ' + section);
}
