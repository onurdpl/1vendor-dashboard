// Test-runtime only. Load with node --import; never load from production startup.
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { syncBuiltinESMExports } from 'node:module';

const localHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function reject(destination) {
  throw new Error(`EXTERNAL EGRESS BLOCKED: ${destination}`);
}

function allowHost(host, destination) {
  if (!localHosts.has(String(host).toLowerCase())) reject(destination);
}

function checkUrl(input) {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (!['http:', 'https:'].includes(url.protocol)) reject(url.href);
  allowHost(url.hostname, url.href);
}

function requestDestination(protocol, args) {
  const first = args[0];
  const second = args[1];
  if (typeof first === 'string' || first instanceof URL) {
    const url = new URL(first);
    const options = second && typeof second === 'object' ? second : {};
    const host = options.hostname ?? options.host ?? url.hostname;
    return { host, display: `${protocol}//${host}:${options.port ?? url.port ?? (protocol === 'https:' ? 443 : 80)}${url.pathname}` };
  }
  const options = first && typeof first === 'object' ? first : {};
  const host = options.hostname ?? options.host ?? 'localhost';
  return { host, display: `${protocol}//${host}:${options.port ?? (protocol === 'https:' ? 443 : 80)}${options.path ?? '/'}` };
}

const originalFetch = globalThis.fetch;
globalThis.fetch = function guardedFetch(input, init) {
  checkUrl(input);
  return originalFetch.call(this, input, init);
};

for (const [client, protocol] of [[http, 'http:'], [https, 'https:']]) {
  for (const method of ['request', 'get']) {
    const original = client[method];
    client[method] = function guardedRequest(...args) {
      const { host, display } = requestDestination(protocol, args);
      allowHost(host, display);
      return original.apply(this, args);
    };
  }
}

const originalSocketConnect = net.Socket.prototype.connect;
function checkSocketDestination(args) {
  const first = args[0];
  if (typeof first === 'string' || (first && typeof first === 'object' && (first.path || first.fd !== undefined))) {
    return; // Local Unix socket or existing descriptor.
  }
  const host = typeof first === 'number'
    ? (typeof args[1] === 'string' ? args[1] : 'localhost')
    : (first?.host ?? first?.hostname ?? 'localhost');
  const port = typeof first === 'number' ? first : first?.port;
  allowHost(host, `tcp://${host}:${port ?? 'unknown'}`);
}
net.Socket.prototype.connect = function guardedSocketConnect(...args) {
  checkSocketDestination(args);
  return originalSocketConnect.apply(this, args);
};
for (const method of ['connect', 'createConnection']) {
  const original = net[method];
  net[method] = function guardedNetConnect(...args) {
    checkSocketDestination(args);
    return original.apply(this, args);
  };
}

const originalTlsConnect = tls.connect;
tls.connect = function guardedTlsConnect(...args) {
  const first = args[0];
  const options = typeof first === 'number'
    ? { port: first, host: typeof args[1] === 'string' ? args[1] : 'localhost' }
    : typeof first === 'object' && first !== null ? first : {};
  if (!options.socket) {
    const host = options.host ?? options.hostname ?? 'localhost';
    allowHost(host, `tls://${host}:${options.port ?? 'unknown'}`);
  }
  return originalTlsConnect.apply(this, args);
};

syncBuiltinESMExports();
