#!/usr/bin/env node

import { runManualKargonomiLocationLookupProbe } from '../dist/modules/shipping/kargonomi-location-lookup-probe.js';

runManualKargonomiLocationLookupProbe().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Kargonomi location lookup probe failed.');
  process.exitCode = 1;
});
