#!/usr/bin/env node

import { runManualNavlungoCreatePostProbe } from '../dist/modules/shipping/navlungo-create-post-probe.js';

runManualNavlungoCreatePostProbe().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Navlungo Create Post probe failed.');
  process.exitCode = 1;
});
