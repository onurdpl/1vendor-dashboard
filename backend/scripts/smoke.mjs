import { spawn } from 'node:child_process';

const port = 4010;
const baseUrl = `http://127.0.0.1:${port}`;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForReady(url, timeoutMs = 15000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Keep waiting for server startup.
    }

    await sleep(200);
  }

  throw new Error(`Timed out waiting for backend readiness at ${url}.`);
}

async function runSmoke() {
  const child = spawn(process.execPath, ['dist/server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';

  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });

  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  try {
    await waitForReady(`${baseUrl}/health`);

    const healthResponse = await fetch(`${baseUrl}/health`);
    if (!healthResponse.ok) {
      throw new Error(`/health returned ${healthResponse.status}`);
    }

    const healthJson = await healthResponse.json();
    if (!healthJson || healthJson.ok !== true) {
      throw new Error(`/health payload invalid: ${JSON.stringify(healthJson)}`);
    }

    const versionResponse = await fetch(`${baseUrl}/version`);
    if (!versionResponse.ok) {
      throw new Error(`/version returned ${versionResponse.status}`);
    }

    const versionJson = await versionResponse.json();
    if (
      !versionJson ||
      versionJson.service !== 'vendor-dashboard-backend' ||
      typeof versionJson.version !== 'string'
    ) {
      throw new Error(`/version payload invalid: ${JSON.stringify(versionJson)}`);
    }

    const dbHealthResponse = await fetch(`${baseUrl}/health/db`);
    if (!dbHealthResponse.ok) {
      throw new Error(`/health/db returned ${dbHealthResponse.status}`);
    }

    const dbHealthJson = await dbHealthResponse.json();
    const validDbStatuses = new Set(['connected', 'not_configured', 'unavailable']);
    if (!dbHealthJson || !validDbStatuses.has(dbHealthJson.status)) {
      throw new Error(`/health/db payload invalid: ${JSON.stringify(dbHealthJson)}`);
    }

    const adminLoginResponse = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@demo.com',
        password: 'demo123',
      }),
    });

    if (!adminLoginResponse.ok) {
      throw new Error(`/auth/login admin failed with ${adminLoginResponse.status}`);
    }

    const adminLoginJson = await adminLoginResponse.json();
    const adminToken = adminLoginJson?.token;
    if (!adminToken) {
      throw new Error('Admin login token missing in /auth/login response.');
    }

    const adminVendorContextResponse = await fetch(`${baseUrl}/debug/vendor-context`, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'X-Vendor-Id': 'yalispor',
      },
    });

    if (!adminVendorContextResponse.ok) {
      throw new Error(`/debug/vendor-context admin check failed with ${adminVendorContextResponse.status}`);
    }

    const vendorLoginResponse = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'yalispor@demo.com',
        password: 'demo123',
      }),
    });

    if (!vendorLoginResponse.ok) {
      throw new Error(`/auth/login vendor failed with ${vendorLoginResponse.status}`);
    }

    const vendorLoginJson = await vendorLoginResponse.json();
    const vendorToken = vendorLoginJson?.token;
    if (!vendorToken) {
      throw new Error('Vendor login token missing in /auth/login response.');
    }

    const allowedVendorContextResponse = await fetch(`${baseUrl}/debug/vendor-context`, {
      headers: {
        Authorization: `Bearer ${vendorToken}`,
        'X-Vendor-Id': 'yalispor',
      },
    });

    if (!allowedVendorContextResponse.ok) {
      throw new Error(
        `/debug/vendor-context allowed vendor check failed with ${allowedVendorContextResponse.status}`,
      );
    }

    const forbiddenVendorContextResponse = await fetch(`${baseUrl}/debug/vendor-context`, {
      headers: {
        Authorization: `Bearer ${vendorToken}`,
        'X-Vendor-Id': 'sporjinal',
      },
    });

    if (forbiddenVendorContextResponse.status !== 403) {
      throw new Error(
        `/debug/vendor-context forbidden vendor expected 403, got ${forbiddenVendorContextResponse.status}`,
      );
    }

    const adminOrdersYaliResponse = await fetch(`${baseUrl}/orders`, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'X-Vendor-Id': 'yalispor',
      },
    });
    if (!adminOrdersYaliResponse.ok) {
      throw new Error(`/orders admin yalispor failed with ${adminOrdersYaliResponse.status}`);
    }
    const adminOrdersYali = await adminOrdersYaliResponse.json();
    if (!Array.isArray(adminOrdersYali) || adminOrdersYali.length === 0) {
      throw new Error('/orders admin yalispor returned empty or invalid payload.');
    }

    const adminOrdersSporjinalResponse = await fetch(`${baseUrl}/orders`, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'X-Vendor-Id': 'sporjinal',
      },
    });
    if (!adminOrdersSporjinalResponse.ok) {
      throw new Error(`/orders admin sporjinal failed with ${adminOrdersSporjinalResponse.status}`);
    }
    const adminOrdersSporjinal = await adminOrdersSporjinalResponse.json();
    if (!Array.isArray(adminOrdersSporjinal) || adminOrdersSporjinal.length === 0) {
      throw new Error('/orders admin sporjinal returned empty or invalid payload.');
    }

    const vendorOrdersYaliResponse = await fetch(`${baseUrl}/orders`, {
      headers: {
        Authorization: `Bearer ${vendorToken}`,
        'X-Vendor-Id': 'yalispor',
      },
    });
    if (!vendorOrdersYaliResponse.ok) {
      throw new Error(`/orders vendor yalispor failed with ${vendorOrdersYaliResponse.status}`);
    }
    const vendorOrdersYali = await vendorOrdersYaliResponse.json();
    if (!Array.isArray(vendorOrdersYali) || vendorOrdersYali.length === 0) {
      throw new Error('/orders vendor yalispor returned empty or invalid payload.');
    }

    const vendorOrdersForbiddenResponse = await fetch(`${baseUrl}/orders`, {
      headers: {
        Authorization: `Bearer ${vendorToken}`,
        'X-Vendor-Id': 'sporjinal',
      },
    });
    if (vendorOrdersForbiddenResponse.status !== 403) {
      throw new Error(`/orders vendor forbidden expected 403, got ${vendorOrdersForbiddenResponse.status}`);
    }

    const ownOrderId = vendorOrdersYali[0]?.id;
    if (!ownOrderId) {
      throw new Error('Unable to resolve vendor-owning orderId from /orders payload.');
    }
    const ownOrderResponse = await fetch(`${baseUrl}/orders/${ownOrderId}`, {
      headers: {
        Authorization: `Bearer ${vendorToken}`,
        'X-Vendor-Id': 'yalispor',
      },
    });
    if (!ownOrderResponse.ok) {
      throw new Error(`/orders/:orderId vendor own access failed with ${ownOrderResponse.status}`);
    }

    const nonOwnedOrderId = adminOrdersSporjinal[0]?.id;
    if (!nonOwnedOrderId) {
      throw new Error('Unable to resolve cross-vendor orderId from admin /orders payload.');
    }
    const nonOwnedOrderResponse = await fetch(`${baseUrl}/orders/${nonOwnedOrderId}`, {
      headers: {
        Authorization: `Bearer ${vendorToken}`,
        'X-Vendor-Id': 'yalispor',
      },
    });
    if (nonOwnedOrderResponse.status !== 404) {
      throw new Error(`/orders/:orderId cross-vendor expected 404, got ${nonOwnedOrderResponse.status}`);
    }

    const adminReturnsYaliResponse = await fetch(`${baseUrl}/returns`, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'X-Vendor-Id': 'yalispor',
      },
    });
    if (!adminReturnsYaliResponse.ok) {
      throw new Error(`/returns admin yalispor failed with ${adminReturnsYaliResponse.status}`);
    }
    const adminReturnsYali = await adminReturnsYaliResponse.json();
    if (!Array.isArray(adminReturnsYali) || adminReturnsYali.length === 0) {
      throw new Error('/returns admin yalispor returned empty or invalid payload.');
    }

    const adminReturnsSporjinalResponse = await fetch(`${baseUrl}/returns`, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'X-Vendor-Id': 'sporjinal',
      },
    });
    if (!adminReturnsSporjinalResponse.ok) {
      throw new Error(`/returns admin sporjinal failed with ${adminReturnsSporjinalResponse.status}`);
    }
    const adminReturnsSporjinal = await adminReturnsSporjinalResponse.json();
    if (!Array.isArray(adminReturnsSporjinal) || adminReturnsSporjinal.length === 0) {
      throw new Error('/returns admin sporjinal returned empty or invalid payload.');
    }

    const vendorReturnsYaliResponse = await fetch(`${baseUrl}/returns`, {
      headers: {
        Authorization: `Bearer ${vendorToken}`,
        'X-Vendor-Id': 'yalispor',
      },
    });
    if (!vendorReturnsYaliResponse.ok) {
      throw new Error(`/returns vendor yalispor failed with ${vendorReturnsYaliResponse.status}`);
    }
    const vendorReturnsYali = await vendorReturnsYaliResponse.json();
    if (!Array.isArray(vendorReturnsYali) || vendorReturnsYali.length === 0) {
      throw new Error('/returns vendor yalispor returned empty or invalid payload.');
    }

    const vendorReturnsForbiddenResponse = await fetch(`${baseUrl}/returns`, {
      headers: {
        Authorization: `Bearer ${vendorToken}`,
        'X-Vendor-Id': 'sporjinal',
      },
    });
    if (vendorReturnsForbiddenResponse.status !== 403) {
      throw new Error(`/returns vendor forbidden expected 403, got ${vendorReturnsForbiddenResponse.status}`);
    }

    const ownReturnId = vendorReturnsYali[0]?.id;
    if (!ownReturnId) {
      throw new Error('Unable to resolve vendor-owning returnId from /returns payload.');
    }
    const ownReturnResponse = await fetch(`${baseUrl}/returns/${ownReturnId}`, {
      headers: {
        Authorization: `Bearer ${vendorToken}`,
        'X-Vendor-Id': 'yalispor',
      },
    });
    if (!ownReturnResponse.ok) {
      throw new Error(`/returns/:returnId vendor own access failed with ${ownReturnResponse.status}`);
    }

    const nonOwnedReturnId = adminReturnsSporjinal[0]?.id;
    if (!nonOwnedReturnId) {
      throw new Error('Unable to resolve cross-vendor returnId from admin /returns payload.');
    }
    const nonOwnedReturnResponse = await fetch(`${baseUrl}/returns/${nonOwnedReturnId}`, {
      headers: {
        Authorization: `Bearer ${vendorToken}`,
        'X-Vendor-Id': 'yalispor',
      },
    });
    if (nonOwnedReturnResponse.status !== 404) {
      throw new Error(`/returns/:returnId cross-vendor expected 404, got ${nonOwnedReturnResponse.status}`);
    }

    const adminFinanceYaliResponse = await fetch(`${baseUrl}/finance`, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'X-Vendor-Id': 'yalispor',
      },
    });
    if (!adminFinanceYaliResponse.ok) {
      throw new Error(`/finance admin yalispor failed with ${adminFinanceYaliResponse.status}`);
    }
    const adminFinanceYali = await adminFinanceYaliResponse.json();
    if (!adminFinanceYali?.summary || !Array.isArray(adminFinanceYali?.records)) {
      throw new Error('/finance admin yalispor returned invalid shape.');
    }

    const adminFinanceSporjinalResponse = await fetch(`${baseUrl}/finance`, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'X-Vendor-Id': 'sporjinal',
      },
    });
    if (!adminFinanceSporjinalResponse.ok) {
      throw new Error(`/finance admin sporjinal failed with ${adminFinanceSporjinalResponse.status}`);
    }
    const adminFinanceSporjinal = await adminFinanceSporjinalResponse.json();
    if (!adminFinanceSporjinal?.summary || !Array.isArray(adminFinanceSporjinal?.records)) {
      throw new Error('/finance admin sporjinal returned invalid shape.');
    }

    const vendorFinanceYaliResponse = await fetch(`${baseUrl}/finance`, {
      headers: {
        Authorization: `Bearer ${vendorToken}`,
        'X-Vendor-Id': 'yalispor',
      },
    });
    if (!vendorFinanceYaliResponse.ok) {
      throw new Error(`/finance vendor yalispor failed with ${vendorFinanceYaliResponse.status}`);
    }
    const vendorFinanceYali = await vendorFinanceYaliResponse.json();
    if (!vendorFinanceYali?.summary || !Array.isArray(vendorFinanceYali?.records)) {
      throw new Error('/finance vendor yalispor returned invalid shape.');
    }

    const vendorFinanceForbiddenResponse = await fetch(`${baseUrl}/finance`, {
      headers: {
        Authorization: `Bearer ${vendorToken}`,
        'X-Vendor-Id': 'sporjinal',
      },
    });
    if (vendorFinanceForbiddenResponse.status !== 403) {
      throw new Error(`/finance vendor forbidden expected 403, got ${vendorFinanceForbiddenResponse.status}`);
    }

    const adminOperationsResponse = await fetch(`${baseUrl}/admin/operations`, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });
    if (!adminOperationsResponse.ok) {
      throw new Error(`/admin/operations admin failed with ${adminOperationsResponse.status}`);
    }
    const adminOperations = await adminOperationsResponse.json();
    if (!adminOperations?.summary || !Array.isArray(adminOperations?.items)) {
      throw new Error('/admin/operations returned invalid shape.');
    }
    const hasBlockedOrPending = adminOperations.items.some(
      (item) => item?.type === 'pending_reassignment' || item?.type === 'vendor_blocked',
    );
    if (!hasBlockedOrPending) {
      throw new Error('/admin/operations missing pending_reassignment/vendor_blocked item.');
    }

    const vendorOperationsResponse = await fetch(`${baseUrl}/admin/operations`, {
      headers: {
        Authorization: `Bearer ${vendorToken}`,
      },
    });
    if (vendorOperationsResponse.status !== 403) {
      throw new Error(`/admin/operations vendor forbidden expected 403, got ${vendorOperationsResponse.status}`);
    }
  } finally {
    child.kill('SIGTERM');
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      sleep(5000),
    ]);
  }

  if (child.exitCode && child.exitCode !== 0) {
    throw new Error(
      `Backend process exited with code ${child.exitCode}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
    );
  }

  console.log('Backend smoke check passed.');
}

runSmoke().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
