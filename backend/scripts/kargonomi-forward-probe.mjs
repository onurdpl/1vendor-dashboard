#!/usr/bin/env node

import { runManualKargonomiForwardProbe } from '../dist/modules/shipping/kargonomi-forward-probe.js';

runManualKargonomiForwardProbe().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Kargonomi manual probe failed.');
  process.exitCode = 1;
});
