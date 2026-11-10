import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { download, parseArgs, upload } from './media-files.mjs';

const anyScheme = () => true;
let server;
let base;
let received;

before(async () => {
  server = http.createServer(async (req, res) => {
    if (req.method === 'POST' && req.url.startsWith('/mcp/uploads/')) {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      received = { headers: req.headers, body: Buffer.concat(chunks).toString('latin1') };
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        url: 'https://www.jumengai.com/files/a.png',
        id: 'f1',
        bytes: 3,
        filename: 'pic.png',
        expires_at: '2026-11-10T02:00:00Z',
        kind: 'image',
      }));
      return;
    }
    if (req.url === '/redirect-upload') {
      res.writeHead(302, { Location: '/mcp/uploads/other' });
      res.end();
      return;
    }
    if (req.url === '/file') {
      res.end('hello');
      return;
    }
    if (req.url === '/broken') {
      res.writeHead(200, { 'Content-Length': '100' });
      res.write('partial');
      res.destroy();
      return;
    }
    if (req.url.startsWith('/loop')) {
      const n = Number(req.url.slice(5) || 0);
      res.writeHead(302, { Location: `/loop${n + 1}` });
      res.end();
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

async function tempDir() {
  return fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'jumeng-files-')));
}

test('upload rejects a foreign host', async () => {
  await assert.rejects(upload({ url: 'https://evil.example/mcp/uploads/x', file: 'package.json' }), { code: 'host_not_allowed' });
});

test('upload rejects http', async () => {
  await assert.rejects(upload({ url: 'http://www.jumengai.com/mcp/uploads/x', file: 'package.json' }), { code: 'https_required' });
});

test('upload rejects credentials in the URL', async () => {
  await assert.rejects(upload({ url: 'https://sk-secret@www.jumengai.com/mcp/uploads/x', file: 'package.json' }), { code: 'invalid_args' });
});

test('upload sends the file field and returns the site url', async () => {
  const dir = await tempDir();
  const file = path.join(dir, 'pic.png');
  await fs.writeFile(file, 'png');
  const result = await upload({ url: `${base}/mcp/uploads/t1`, file, allowHosts: ['127.0.0.1'], isSecure: anyScheme });
  assert.equal(result.ok, true);
  assert.equal(result.url, 'https://www.jumengai.com/files/a.png');
  assert.equal(result.id, 'f1');
  assert.match(received.headers['content-type'], /^multipart\/form-data; boundary=/);
  assert.match(received.body, /name="file"; filename="pic.png"/);
  assert.equal(received.headers.authorization, undefined);
  await assert.rejects(
    upload({ url: `${base}/mcp/uploads/t1`, file: path.join(dir, 'missing.png'), allowHosts: ['127.0.0.1'], isSecure: anyScheme }),
    { code: 'file_not_found' },
  );
});

test('upload refuses redirects', async () => {
  const dir = await tempDir();
  const file = path.join(dir, 'pic.png');
  await fs.writeFile(file, 'png');
  await assert.rejects(
    upload({ url: `${base}/redirect-upload`, file, allowHosts: ['127.0.0.1'], isSecure: anyScheme }),
    { code: 'upload_failed' },
  );
});

test('upload sends X-Locale only for zh, zh-TW, and en', async () => {
  const dir = await tempDir();
  const file = path.join(dir, 'pic.png');
  await fs.writeFile(file, 'png');
  await upload({ url: `${base}/mcp/uploads/t2`, file, locale: 'zh-TW', allowHosts: ['127.0.0.1'], isSecure: anyScheme });
  assert.equal(received.headers['x-locale'], 'zh-TW');
  await upload({ url: `${base}/mcp/uploads/t3`, file, allowHosts: ['127.0.0.1'], isSecure: anyScheme });
  assert.equal(received.headers['x-locale'], undefined);
  received = undefined;
  await assert.rejects(
    upload({ url: `${base}/mcp/uploads/t4`, file, locale: 'ja', allowHosts: ['127.0.0.1'], isSecure: anyScheme }),
    { code: 'invalid_args' },
  );
  await assert.rejects(
    upload({ url: `${base}/mcp/uploads/t4`, file, locale: 'zh\r\nX-Evil: 1', allowHosts: ['127.0.0.1'], isSecure: anyScheme }),
    { code: 'invalid_args' },
  );
  assert.equal(received, undefined);
});

test('download refuses a path outside root', async () => {
  const root = await tempDir();
  const outside = await tempDir();
  await assert.rejects(download({ url: `${base}/file`, out: path.join(root, '..', 'x.txt'), root, isSecure: anyScheme }), { code: 'path_outside_root' });
  await fs.symlink(outside, path.join(root, 'link'));
  await assert.rejects(download({ url: `${base}/file`, out: path.join(root, 'link', 'x.txt'), root, isSecure: anyScheme }), { code: 'path_outside_root' });
  assert.deepEqual(await fs.readdir(outside), []);
  await assert.rejects(download({ url: `${base}/file`, out: path.join(root, 'y.txt'), root }), { code: 'https_required' });
});

test('download does not overwrite an existing file', async () => {
  const root = await tempDir();
  const out = path.join(root, 'nested', 'a.txt');
  const first = await download({ url: `${base}/file`, out, root, isSecure: anyScheme });
  assert.deepEqual(first, { ok: true, path: out, bytes: 5 });
  await assert.rejects(download({ url: `${base}/file`, out, root, isSecure: anyScheme }), { code: 'file_exists' });
  await fs.writeFile(out, 'old');
  await download({ url: `${base}/file`, out, root, overwrite: true, isSecure: anyScheme });
  assert.equal(await fs.readFile(out, 'utf8'), 'hello');
});

test('download leaves no partial file when the transfer breaks or exceeds the limit', async () => {
  const root = await tempDir();
  await assert.rejects(download({ url: `${base}/broken`, out: path.join(root, 'b.bin'), root, isSecure: anyScheme }), { code: 'download_failed' });
  assert.deepEqual(await fs.readdir(root), []);
  await assert.rejects(download({ url: `${base}/file`, out: path.join(root, 'c.bin'), root, maxBytes: 3, isSecure: anyScheme }), { code: 'too_large' });
  assert.deepEqual(await fs.readdir(root), []);
});

test('download stops after five redirects', async () => {
  const root = await tempDir();
  await assert.rejects(download({ url: `${base}/loop0`, out: path.join(root, 'r.bin'), root, isSecure: anyScheme }), { code: 'too_many_redirects' });
});

test('parseArgs accepts locale and refuses extra flags', () => {
  assert.deepEqual(parseArgs(['upload', '--url', 'u', '--file', 'f', '--locale', 'zh']), {
    command: 'upload',
    options: { url: 'u', file: 'f', locale: 'zh' },
  });
  assert.throws(() => parseArgs(['upload', '--url', 'u', '--allowHosts', 'evil.example']), { code: 'invalid_args' });
});

test('the CLI still answers when started through a symlinked directory', { skip: process.platform === 'win32' && 'symlinks need extra rights on Windows' }, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'jumeng-files-link-'));
  const link = path.join(dir, 'scripts');
  await fs.symlink(path.dirname(fileURLToPath(import.meta.url)), link);
  const result = spawnSync(process.execPath, [path.join(link, 'media-files.mjs'), 'bogus'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).error, 'invalid_args');
});
