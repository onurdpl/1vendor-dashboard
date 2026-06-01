import { createVendorIntegrationClientToken } from './vendor-integration.tokens.js';

function readArg(name: string) {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length)?.trim() ?? '';
}

function readRequiredArg(name: string) {
  const value = readArg(name);
  if (!value) {
    throw new Error(`Missing required argument --${name}=...`);
  }

  return value;
}

export async function runVendorIntegrationTokenCli() {
  const vendorIdentifier = readRequiredArg('vendorIdentifier');
  const providerName = readRequiredArg('providerName');
  const scopes = readRequiredArg('scopes')
    .split(',')
    .map((scope) => scope.trim())
    .filter(Boolean);

  const created = await createVendorIntegrationClientToken({
    vendorIdentifier,
    providerName,
    scopes,
  });

  console.log('Vendor integration client created.');
  console.log(`clientId=${created.clientId}`);
  console.log(`vendorIdentifier=${created.vendorIdentifier}`);
  console.log(`providerName=${created.providerName}`);
  console.log(`scopes=${created.scopes.join(',')}`);
  console.log('Store this plaintext token securely. Sporgym stores only its hash.');
  console.log(`token=${created.token}`);
}
