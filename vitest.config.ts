import {defineConfig} from 'vitest/config';

// The language servers start on a test's first call: a few seconds on a loaded machine.
export default defineConfig({test: {testTimeout: 20_000}});
