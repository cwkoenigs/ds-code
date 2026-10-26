// `npm run index`: build or refresh the code graph for this repo with codebase-memory-mcp, the same
// way rule agent does when a session starts. Run it after pulling or after large changes.
import {index} from '../dist/ds/codetools.js';

const summary = await index(process.cwd());
console.log(summary);
if (/not installed|failed|took longer|not a git/.test(summary)) process.exitCode = 1;
