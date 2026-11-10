#!/usr/bin/env node
// 把本地文件送到本站一次性上传地址，或把生成结果下载到允许的目录。
// 无第三方依赖，Node 20 及以上。不读环境变量，不接受密钥。
//
//   node media-files.mjs upload --url <upload_url> --file <path> [--locale zh|zh-TW|en]
//   node media-files.mjs download --url <url> --out <path> [--overwrite] [--root <dir>]
//
// 成功或失败都向 stdout 打一行 JSON。

import { randomBytes } from 'node:crypto';
import { createWriteStream, openAsBlob, realpathSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const UPLOAD_HOSTS = ['www.jumengai.com', 'jumengai.com', 'www.jumai.ai'];
const LOCALES = new Set(['zh', 'zh-TW', 'en']);
const MAX_REDIRECTS = 5;
const MAX_DOWNLOAD_BYTES = 2 * 1024 ** 3;

export class FilesError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const httpsOnly = (url) => url.protocol === 'https:';

function parseURL(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new FilesError('invalid_args', `invalid URL: ${raw}`);
  }
  if (url.username || url.password) throw new FilesError('invalid_args', 'URL must not contain credentials');
  return url;
}

/**
 * 以 multipart 字段 file 上传。只接受指定主机的 https。
 * locale 原样作为 X-Locale。allowHosts 与 isSecure 只给测试注入。
 */
export async function upload({ url, file, locale, allowHosts = UPLOAD_HOSTS, isSecure = httpsOnly }) {
  if (locale !== undefined && !LOCALES.has(locale)) throw new FilesError('invalid_args', `invalid locale: ${locale}`);
  const target = parseURL(url);
  if (!isSecure(target)) throw new FilesError('https_required', 'upload URL must use https');
  if (!allowHosts.includes(target.hostname)) throw new FilesError('host_not_allowed', `upload host ${target.hostname} is not allowed`);
  let blob;
  try {
    blob = await openAsBlob(file);
  } catch {
    throw new FilesError('file_not_found', `cannot read file: ${file}`);
  }
  const form = new FormData();
  form.append('file', blob, path.basename(file));
  let response;
  let body;
  try {
    const headers = locale ? { 'X-Locale': locale } : {};
    response = await fetch(target, { method: 'POST', body: form, headers, redirect: 'error' });
    body = await response.json();
  } catch (error) {
    throw new FilesError('upload_failed', error instanceof Error ? error.message : String(error));
  }
  const fileURL = typeof body?.url === 'string' ? body.url : '';
  if (!response.ok || !fileURL) {
    const message = body?.error?.message || body?.message || `upload failed with HTTP ${response.status}`;
    throw new FilesError('upload_failed', message);
  }
  return {
    ok: true,
    url: fileURL,
    id: body.id,
    bytes: body.bytes,
    filename: body.filename,
    expires_at: body.expires_at,
    kind: body.kind,
  };
}

function inside(root, target) {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

async function prepareOutput(out, root) {
  const realRoot = await fs.realpath(root);
  const target = path.resolve(out);
  let existing = path.dirname(target);
  const missing = [];
  for (;;) {
    try {
      existing = await fs.realpath(existing);
      break;
    } catch {
      missing.unshift(path.basename(existing));
      const parent = path.dirname(existing);
      if (parent === existing) throw new FilesError('path_outside_root', 'output directory cannot be resolved');
      existing = parent;
    }
  }
  const dir = path.join(existing, ...missing);
  const finalPath = path.join(dir, path.basename(target));
  if (!inside(realRoot, finalPath)) throw new FilesError('path_outside_root', `output must be inside ${realRoot}`);
  await fs.mkdir(dir, { recursive: true });
  return finalPath;
}

/**
 * 下载 https 地址。最多跟随 5 次重定向，重定向后仍须是 https。
 * 输出必须在 root 内。默认不覆盖。失败时删除临时文件。
 * isSecure 与 maxBytes 只给测试注入。
 */
export async function download({ url, out, overwrite = false, root = process.cwd(), isSecure = httpsOnly, maxBytes = MAX_DOWNLOAD_BYTES }) {
  let target = parseURL(url);
  if (!isSecure(target)) throw new FilesError('https_required', 'download URL must use https');
  const finalPath = await prepareOutput(out, root);
  if (!overwrite) {
    try {
      await fs.lstat(finalPath);
      throw new FilesError('file_exists', `${finalPath} already exists; pass --overwrite to replace it`);
    } catch (error) {
      if (error instanceof FilesError) throw error;
    }
  }
  let response;
  for (let hops = 0; ; hops++) {
    try {
      response = await fetch(target, { redirect: 'manual' });
    } catch (error) {
      throw new FilesError('download_failed', error instanceof Error ? error.message : String(error));
    }
    if (response.status < 300 || response.status > 399) break;
    const location = response.headers.get('location');
    if (!location) throw new FilesError('download_failed', `redirect without location (HTTP ${response.status})`);
    if (hops >= MAX_REDIRECTS) throw new FilesError('too_many_redirects', `more than ${MAX_REDIRECTS} redirects`);
    target = new URL(location, target);
    if (!isSecure(target)) throw new FilesError('https_required', 'redirect target must use https');
  }
  if (!response.ok || !response.body) throw new FilesError('download_failed', `download failed with HTTP ${response.status}`);
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new FilesError('too_large', `file is larger than ${maxBytes} bytes`);

  const temp = path.join(path.dirname(finalPath), `.${path.basename(finalPath)}.${randomBytes(6).toString('hex')}.part`);
  let bytes = 0;
  const counter = async function* (source) {
    for await (const chunk of source) {
      bytes += chunk.length;
      if (bytes > maxBytes) throw new FilesError('too_large', `file is larger than ${maxBytes} bytes`);
      yield chunk;
    }
  };
  try {
    await pipeline(Readable.fromWeb(response.body), counter, createWriteStream(temp, { flags: 'wx' }));
    await fs.rename(temp, finalPath);
  } catch (error) {
    await fs.rm(temp, { force: true });
    if (error instanceof FilesError) throw error;
    throw new FilesError('download_failed', error instanceof Error ? error.message : String(error));
  }
  return { ok: true, path: finalPath, bytes };
}

export function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let i = 0; i < rest.length; i++) {
    const name = rest[i];
    if (name === '--overwrite') {
      options.overwrite = true;
    } else if (['--url', '--file', '--out', '--root', '--locale'].includes(name) && i + 1 < rest.length) {
      options[name.slice(2)] = rest[++i];
    } else {
      throw new FilesError('invalid_args', `unknown or incomplete argument: ${name}`);
    }
  }
  return { command, options };
}

async function main(argv) {
  if (Number(process.versions.node.split('.')[0]) < 20) {
    throw new FilesError('node_too_old', `Node 20 or newer is required, found ${process.versions.node}`);
  }
  const { command, options } = parseArgs(argv);
  if (command === 'upload' && options.url && options.file) {
    return upload({ url: options.url, file: options.file, locale: options.locale });
  }
  if (command === 'download' && options.url && options.out) {
    return download({ url: options.url, out: options.out, overwrite: options.overwrite, root: options.root });
  }
  throw new FilesError('invalid_args', 'usage: upload --url <url> --file <path> [--locale zh|zh-TW|en] | download --url <url> --out <path> [--overwrite] [--root <dir>]');
}

function startedAsScript() {
  try {
    return realpathSync.native(process.argv[1]) === realpathSync.native(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (startedAsScript()) {
  main(process.argv.slice(2)).then(
    (result) => process.stdout.write(`${JSON.stringify(result)}\n`),
    (error) => {
      const code = error instanceof FilesError ? error.code : 'unexpected_error';
      const message = error instanceof Error ? error.message : String(error);
      process.stdout.write(`${JSON.stringify({ ok: false, error: code, message })}\n`);
      process.exitCode = 1;
    },
  );
}
