import {defineConfig} from 'vitest/config';

// The language servers start on a test's first call, and stop when a file's tests are done: a few
// seconds each on a loaded machine.
export default defineConfig({test: {testTimeout: 20_000, hookTimeout: 20_000}});
