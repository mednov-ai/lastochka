'use strict';

// A test-only CONNECT tunnel: the application retains end-to-end TLS verification.
const http = require('node:http');
const net = require('node:net');
const BANK_AUTHORITY = 'alfa.rbsuat.com:443';
const server = http.createServer((_request, response) => {
  response.writeHead(403, { Connection: 'close' });
  response.end();
});
server.maxHeadersCount = 16;
server.maxConnections = 32;
server.requestTimeout = 10000;
server.headersTimeout = 10000;
server.on('connect', (request, client, head) => {
  if (request.url !== BANK_AUTHORITY || request.headers.host !== BANK_AUTHORITY) {
    client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    return;
  }
  client.setTimeout(35000, () => client.destroy());
  const bank = net.connect({ host: 'alfa.rbsuat.com', port: 443 });
  bank.setTimeout(35000, () => bank.destroy());
  bank.once('connect', () => {
    client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head.length) bank.write(head);
    client.pipe(bank);
    bank.pipe(client);
  });
  bank.on('error', () => client.destroy());
  client.on('error', () => bank.destroy());
  client.on('close', () => bank.destroy());
  bank.on('close', () => client.destroy());
});
server.listen(3128, '0.0.0.0');
