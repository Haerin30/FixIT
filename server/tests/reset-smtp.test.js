const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { mailConfig, sendResetMail } = require('../src/lib/reset-mail');

test('Nodemailer delivers only into an isolated loopback SMTP sandbox', async t => {
  let received = '', recipient = '';
  const server = net.createServer(socket => {
    socket.setEncoding('utf8'); socket.write('220 private FixIT test sandbox\r\n');
    let buffer = '', inData = false;
    socket.on('data', chunk => {
      buffer += chunk;
      while (buffer.includes('\r\n')) {
        const index = buffer.indexOf('\r\n'), line = buffer.slice(0, index); buffer = buffer.slice(index + 2);
        if (inData) {
          if (line === '.') { inData = false; socket.write('250 Captured locally\r\n'); }
          else received += line + '\r\n';
        } else if (/^EHLO/.test(line)) socket.write('250 private-sandbox\r\n');
        else if (/^DATA/.test(line)) { inData = true; socket.write('354 Send message\r\n'); }
        else if (/^QUIT/.test(line)) socket.end('221 Bye\r\n');
        else { if (/^RCPT TO/.test(line)) recipient = line; socket.write('250 OK\r\n'); }
      }
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const config = mailConfig({ CLIENT_URL: 'http://localhost:5173', SMTP_HOST: '127.0.0.1', SMTP_PORT: String(server.address().port), SMTP_FROM: 'FixIT <reset@example.invalid>', SMTP_ALLOW_INSECURE: 'true', NODE_ENV: 'test' });
  await sendResetMail(config, 'controlled@example.invalid', 'a'.repeat(64));
  assert.match(recipient, /controlled@example.invalid/);
  const decoded = received.replace(/=\r\n/g, '').replaceAll('=3D', '=');
  assert.match(decoded, /reset-password#token=aaaaaaaa/);
  assert.match(decoded, /30 minutes/); assert.match(decoded, /ignore this email/);
});
