// Builds vendor/anthropic-sdk.js: the official Anthropic TypeScript SDK (@anthropic-ai/sdk)
// bundled by esbuild into one classic script for the service worker (src/background.js loads it
// with importScripts; MV3 service workers here are not modules). It exposes self.AnthropicSDK =
// { Anthropic, betaJSONSchemaOutputFormat, VERSION }. Only the service worker loads it
// (src/x-llm-bg.js, the optional "bring your own key" X writing tools); the rest of the
// extension stays build-free.
//
//   npm install            (once: installs the pinned devDependencies)
//   npm run build:vendor   (re-run after changing the SDK version in package.json)
//
// The SDK's package.json "browser" field swaps its Node-only internals (fs, the `ant auth`
// profile files) for the browser versions, so platform: 'browser' produces no Node imports.
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sdkVersion = JSON.parse(readFileSync(join(root, 'node_modules', '@anthropic-ai', 'sdk', 'package.json'), 'utf8')).version;
const out = join(root, 'vendor', 'anthropic-sdk.js');

await build({
  stdin: {
    contents: [
      "import Anthropic from '@anthropic-ai/sdk';",
      "import { betaJSONSchemaOutputFormat } from '@anthropic-ai/sdk/helpers/beta/json-schema';",
      "import { VERSION } from '@anthropic-ai/sdk/version';",
      'export { Anthropic, betaJSONSchemaOutputFormat, VERSION };'
    ].join('\n'),
    resolveDir: root,
    sourcefile: 'anthropic-sdk-entry.mjs'
  },
  bundle: true,
  format: 'iife',
  globalName: 'AnthropicSDK',
  platform: 'browser',
  target: ['chrome111'],
  minify: true,
  legalComments: 'eof',
  outfile: out,
  logLevel: 'warning'
});

const body = readFileSync(out, 'utf8');
writeFileSync(out, '/* @anthropic-ai/sdk ' + sdkVersion + ' (MIT), bundled by dev/build-vendor.mjs; do not edit. */\n' + body);
console.log('vendor/anthropic-sdk.js: @anthropic-ai/sdk ' + sdkVersion + ', ' + Math.round(body.length / 1024) + ' KB');
