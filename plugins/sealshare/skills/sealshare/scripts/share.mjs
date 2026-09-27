#!/usr/bin/env node
// sealshare — 로컬 HTML·마크다운을 «서버가 못 읽는» 링크로 공유한다.
//
//   node share.mjs share <파일> [--title "제목"]   → 링크 (클립보드에도 복사)
//   node share.mjs list                          → 내가 만든 링크
//   node share.mjs off <링크|id>                 → 링크 끄기
//   node share.mjs me                            → 내 공유 목록 관리 페이지 주소
//   node share.mjs login [열쇠 | --file <열쇠 파일>]   (아무것도 안 주면 «다운로드»의 sealshare-key*.txt 를 찾는다)
//   node share.mjs whoami · help
//
// 암호화는 이 컴퓨터에서 한다: 내용 → gzip → AES-256-GCM(무작위 열쇠) → 서버에는 암호문만.
// 열쇠는 링크의 # 뒤에만 있고, 브라우저는 # 뒤를 서버로 보내지 않는다.
// 올리기 열쇠에서 두 값을 뽑는다 — 서버에 보내는 «인증값»과, 서버로 안 가는 «목록 열쇠»(server/lib/shared.js 머리 주석).
// 필요한 것: Node 18 이상. 다른 설치는 없다.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { gzipSync } from "node:zlib";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const DEFAULT_SERVER = "https://sealshare.pages.dev";
const MAX_BYTES = 25 * 1024 * 1024;
const HOME = join(homedir(), ".sealshare");
const CONFIG = join(HOME, "config.json");
const LINKS = join(HOME, "links.json"); // 서버 목록의 로컬 사본(서버가 정본)

const MIME = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp",
  ".svg": "image/svg+xml", ".avif": "image/avif", ".ico": "image/x-icon", ".bmp": "image/bmp",
  ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4", ".ogg": "audio/ogg",
  ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".otf": "font/otf",
  ".css": "text/css", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".pdf": "application/pdf",
};

const HELP = `sealshare — 파일을 «서버가 못 읽는» 링크로 공유합니다

클로드 코드에 이렇게 말하면 됩니다:
  「이 파일 링크로 공유해줘: 스토리보드.html」   → 링크를 만들어 클립보드에 복사
  「내 공유 목록 보여줘」                          → 만든 링크들
  「그 링크 꺼줘」                                 → 더는 안 열리게
  「공유 목록 관리 페이지 열어줘」                 → 폰·PC 브라우저에서 목록 보기·복사·끄기

처음 한 번: 운영자에게 받은 열쇠 파일(sealshare-key-….txt)을 «다운로드» 폴더에 두고 → 「sealshare 열쇠 등록해줘」
공유할 수 있는 것: .html .htm(스크립트까지 돈다) · .md .markdown .txt(깔끔한 문서로)
알아 둘 것: 링크를 가진 사람은 누구나 봅니다(로그인 없음). 링크 없이는 서버도 못 엽니다.`;

// ── 설정 ────────────────────────────────────────────────────────────────────
function readJson(p, fallback) {
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return fallback; }
}
function writeJson(p, v) {
  mkdirSync(HOME, { recursive: true });
  writeFileSync(p, JSON.stringify(v, null, 2), "utf8");
}
function config() {
  const c = readJson(CONFIG, {});
  return {
    server: (process.env.SEALSHARE_SERVER || c.server || DEFAULT_SERVER).replace(/\/+$/, ""),
    token: process.env.SEALSHARE_TOKEN || c.token || "",
  };
}
const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const sha = (s) => createHash("sha256").update(s, "utf8").digest();
const authOf = (token) => b64url(sha("sealshare/auth/v1:" + token));   // 서버로 간다
const indexKeyOf = (token) => sha("sealshare/index/v1:" + token);      // 서버로 안 간다

function needToken() {
  const c = config();
  if (!c.token) die("아직 올리기 열쇠가 없습니다.\n운영자에게 받은 열쇠 파일(sealshare-key-….txt)을 «다운로드» 폴더에 두고: 「sealshare 열쇠 등록해줘」");
  return c;
}

// ── 한 파일로 묶기 ───────────────────────────────────────────────────────────
const isLocal = (u) => u && !/^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(u.trim());
const stats = { inlined: 0, missing: [] };

function fileFor(ref, baseDir) {
  const clean = decodeURIComponent(ref.trim().split(/[?#]/)[0]);
  const p = resolve(baseDir, clean);
  if (!existsSync(p) || !statSync(p).isFile()) { stats.missing.push(ref); return null; }
  return p;
}
function dataUri(ref, baseDir) {
  if (!isLocal(ref)) return null;
  const p = fileFor(ref, baseDir);
  if (!p) return null;
  const type = MIME[extname(p).toLowerCase()] || "application/octet-stream";
  stats.inlined++;
  return `data:${type};base64,${readFileSync(p).toString("base64")}`;
}
function inlineCssUrls(css, baseDir) {
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (m, q, ref) => {
    const d = dataUri(ref, baseDir);
    return d ? `url("${d}")` : m;
  });
}
function bundleHtml(html, baseDir) {
  html = html.replace(/<link\b[^>]*>/gi, (tag) => {
    if (!/rel\s*=\s*["']?stylesheet/i.test(tag)) return tag;
    const href = (tag.match(/href\s*=\s*"([^"]*)"|href\s*=\s*'([^']*)'/i) || []).slice(1).find(Boolean);
    if (!isLocal(href)) return tag;
    const p = fileFor(href, baseDir);
    if (!p) return tag;
    stats.inlined++;
    return `<style>\n${inlineCssUrls(readFileSync(p, "utf8"), dirname(p))}\n</style>`;
  });
  html = html.replace(/<script\b([^>]*)\bsrc\s*=\s*("([^"]*)"|'([^']*)')([^>]*)>\s*<\/script>/gi, (m, pre, _q, a, b, post) => {
    const src = a ?? b;
    if (!isLocal(src)) return m;
    const p = fileFor(src, baseDir);
    if (!p) return m;
    stats.inlined++;
    const code = readFileSync(p, "utf8").replace(/<\/script/gi, "<\\/script");
    return `<script${pre}${post}>\n${code}\n</script>`;
  });
  html = html.replace(/\b(src|poster)\s*=\s*("([^"]*)"|'([^']*)')/gi, (m, attr, _q, a, b) => {
    const d = dataUri(a ?? b, baseDir);
    return d ? `${attr}="${d}"` : m;
  });
  html = html.replace(/<link\b[^>]*rel\s*=\s*["']?(icon|apple-touch-icon)[^>]*>/gi, (tag) =>
    tag.replace(/href\s*=\s*("([^"]*)"|'([^']*)')/i, (m, _q, a, b) => { const d = dataUri(a ?? b, baseDir); return d ? `href="${d}"` : m; }));
  html = html.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, (m, o, css, c) => o + inlineCssUrls(css, baseDir) + c);
  html = html.replace(/\bstyle\s*=\s*"([^"]*)"/gi, (m, css) => `style="${inlineCssUrls(css, baseDir).replace(/"/g, "'")}"`);
  return html;
}
function bundleMarkdown(md, baseDir) {
  md = md.replace(/!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(\s+"[^"]*")?\s*\)/g, (m, alt, ref, title) => {
    const d = dataUri(ref, baseDir);
    return d ? `![${alt}](${d}${title || ""})` : m;
  });
  return md.replace(/\bsrc\s*=\s*("([^"]*)"|'([^']*)')/gi, (m, _q, a, b) => { const d = dataUri(a ?? b, baseDir); return d ? `src="${d}"` : m; });
}

// ── 암호 ────────────────────────────────────────────────────────────────────
function aesSeal(key, plain) { // → iv(12) · 암호문 · 태그(16)  — WebCrypto 가 기대하는 순서
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  return Buffer.concat([iv, c.update(plain), c.final(), c.getAuthTag()]);
}
function aesOpen(key, blob) {
  const d = createDecipheriv("aes-256-gcm", key, blob.subarray(0, 12));
  d.setAuthTag(blob.subarray(blob.length - 16));
  return Buffer.concat([d.update(blob.subarray(12, blob.length - 16)), d.final()]);
}

// ── 서버 목록(내 공유 목록 — 암호문. 서버는 못 연다) ─────────────────────────
async function readIndex({ server, token }) {
  const r = await fetch(`${server}/api/me/list`, { headers: { authorization: `Bearer ${authOf(token)}` } });
  if (r.status === 401) die("등록되지 않은 올리기 열쇠입니다 — 운영자에게 받은 열쇠를 다시 등록하세요.");
  const name = decodeURIComponent(r.headers.get("x-name") || "");
  if (r.status === 404) return { links: [], etag: null, name };
  if (!r.ok) die(`목록을 못 읽었습니다 (${r.status})`);
  const obj = JSON.parse(aesOpen(indexKeyOf(token), Buffer.from(await r.arrayBuffer())).toString("utf8"));
  return { links: obj.links || [], etag: r.headers.get("etag"), name };
}
async function updateIndex(cfg, fn) { // 그사이 관리 페이지가 고쳤으면(412) 다시 읽고 다시 적용
  for (let i = 0; i < 4; i++) {
    const cur = await readIndex(cfg);
    const next = fn(cur.links.slice());
    const headers = { authorization: `Bearer ${authOf(cfg.token)}`, "content-type": "application/octet-stream" };
    if (cur.etag) headers["x-if-match"] = cur.etag;
    const body = aesSeal(indexKeyOf(cfg.token), Buffer.from(JSON.stringify({ v: 1, links: next }), "utf8"));
    const r = await fetch(`${cfg.server}/api/me/list`, { method: "PUT", headers, body });
    if (r.status === 412) continue;
    if (!r.ok) die(`목록을 못 고쳤습니다 (${r.status})`);
    writeJson(LINKS, next);
    return next;
  }
  die("목록이 계속 바뀌고 있습니다 — 잠시 뒤 다시 하세요");
}

function copyToClipboard(text) {
  const tries = process.platform === "win32" ? [["clip", []]]
    : process.platform === "darwin" ? [["pbcopy", []]]
    : [["wl-copy", []], ["xclip", ["-selection", "clipboard"]], ["xsel", ["--clipboard", "--input"]]];
  for (const [cmd, args] of tries) {
    const r = spawnSync(cmd, args, { input: text, shell: process.platform === "win32" });
    if (r.status === 0) return true;
  }
  return false;
}

// ── 명령 ────────────────────────────────────────────────────────────────────
async function share(file, title) {
  const cfg = needToken();
  if (!file) die("공유할 파일을 주세요: node share.mjs share <파일>");
  const path = resolve(file);
  if (!existsSync(path)) die(`파일이 없습니다: ${path}`);
  const ext = extname(path).toLowerCase();
  const raw = readFileSync(path, "utf8");
  let kind, body;
  if ([".html", ".htm"].includes(ext)) { kind = "html"; body = bundleHtml(raw, dirname(path)); }
  else if ([".md", ".markdown", ".mdx", ".txt"].includes(ext)) { kind = "md"; body = bundleMarkdown(raw, dirname(path)); }
  else die(`HTML(.html)이나 마크다운(.md)만 공유합니다: ${basename(path)}`);

  const guessed = kind === "html"
    ? (body.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]
    : (body.match(/^#\s+(.+)$/m) || [])[1];
  const t = (title || (guessed || "").trim() || basename(path, ext)).replace(/\s+/g, " ").slice(0, 200);
  const created = new Date().toISOString();
  const key = randomBytes(32);
  const blob = aesSeal(key, gzipSync(Buffer.from(JSON.stringify({ v: 1, kind, title: t, body, created, name: basename(path) }), "utf8"), { level: 9 }));
  if (blob.length > MAX_BYTES) die(`너무 큽니다: 암호문 ${(blob.length / 1e6).toFixed(1)}MB (상한 25MB). 그림·영상을 줄여 주세요.`);

  const res = await fetch(`${cfg.server}/api/s`, {
    method: "POST",
    headers: { authorization: `Bearer ${authOf(cfg.token)}`, "content-type": "application/octet-stream" },
    body: blob,
  });
  const out = await res.json().catch(() => ({}));
  if (res.status === 401) die("등록되지 않은 올리기 열쇠입니다 — 운영자에게 받은 열쇠를 다시 등록하세요.");
  if (!res.ok) die(`올리지 못했습니다 (${res.status}): ${out.error || res.statusText}`);

  const url = `${cfg.server}/s/${out.id}#${b64url(key)}`;
  const entry = { id: out.id, url, title: t, kind, created, bytes: blob.length, name: basename(path), deleteToken: out.deleteToken };
  await updateIndex(cfg, (links) => [...links.filter((l) => l.id !== out.id), entry]);
  const copied = copyToClipboard(url);

  console.log(url);
  console.log(`\n제목   ${t}`);
  console.log(`형식   ${kind === "html" ? "HTML(스크립트 포함, 격리해서 띄움)" : "마크다운"} · 암호문 ${(blob.length / 1024).toFixed(0)}KB`);
  if (stats.inlined) console.log(`묶음   로컬 파일 ${stats.inlined}개를 안에 넣었습니다`);
  if (stats.missing.length) console.log(`⚠ 못 찾은 로컬 파일 ${stats.missing.length}개 — 받는 쪽에서 비어 보입니다: ${[...new Set(stats.missing)].slice(0, 5).join(", ")}${stats.missing.length > 5 ? " …" : ""}`);
  console.log(`복사   ${copied ? "클립보드에 복사했습니다" : "클립보드 복사 실패 — 위 링크를 직접 복사하세요"}`);
  console.log(`\n링크를 가진 사람은 누구나 봅니다. 끄려면: 「그 링크 꺼줘」 (node share.mjs off ${out.id})`);
}

async function list() {
  const cfg = needToken();
  let { links, name } = await readIndex(cfg);
  // 옛 판(목록이 로컬에만 있던 때)에서 만든 링크를 서버 목록으로 «한 번만» 옮긴다.
  // 🔴 매번 옮기면 관리 페이지에서 끈 항목이 로컬 사본에서 되살아난다(2026-09-27 실측) — 그 뒤로 서버가 정본이다
  const c = readJson(CONFIG, {});
  if (!c.migrated) {
    const local = readJson(LINKS, []).filter((l) => !l.off && !links.some((x) => x.id === l.id));
    if (local.length) links = await updateIndex(cfg, (cur) => [...cur, ...local.filter((l) => !cur.some((x) => x.id === l.id))]);
    c.migrated = true;
    writeJson(CONFIG, c);
  }
  writeJson(LINKS, links);
  if (!links.length) return console.log(`${name ? name + " 님 · " : ""}아직 공유한 링크가 없습니다.`);
  console.log(`${name ? name + " 님 · " : ""}${links.length}건 (관리 페이지: node share.mjs me)\n`);
  for (const l of links.slice().sort((a, b) => b.created.localeCompare(a.created))) {
    console.log(`${l.created.slice(0, 16).replace("T", " ")}  ${l.id}  ${l.title}\n   ${l.url}`);
  }
}

async function off(target) {
  if (!target) die("끌 링크나 id 를 주세요: node share.mjs off <링크|id>");
  const cfg = needToken();
  const id = (target.match(/\/s\/([A-Za-z0-9_-]{22})/) || [])[1] || target.trim();
  const { links } = await readIndex(cfg);
  const rec = links.find((l) => l.id === id) || readJson(LINKS, []).find((l) => l.id === id);
  const headers = { authorization: `Bearer ${authOf(cfg.token)}` };
  if (rec?.deleteToken) headers["x-delete-token"] = rec.deleteToken;
  const res = await fetch(`${cfg.server}/api/s/${id}`, { method: "DELETE", headers });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) die(`끄지 못했습니다 (${res.status}): ${out.error || res.statusText}`);
  await updateIndex(cfg, (cur) => cur.filter((l) => l.id !== id));
  console.log(`껐습니다: ${id}${rec ? ` (${rec.title})` : ""} — 이 링크는 이제 열리지 않습니다.`);
}

function me() {
  const cfg = needToken();
  const url = `${cfg.server}/me#${cfg.token}`;
  const copied = copyToClipboard(url);
  console.log(url);
  console.log(`\n내 공유 목록 관리 페이지입니다 — 폰·PC 브라우저에서 즐겨찾기해 두면 언제든 목록 보기·링크 복사·끄기를 할 수 있습니다.`);
  console.log(`${copied ? "클립보드에 복사했습니다. " : ""}⚠ 이 주소에는 올리기 열쇠가 들어 있습니다 — 남에게 보내지 마세요.`);
}

// 열쇠 찾기 — ① 직접 준 열쇠 ② --file 로 준 파일 ③ 아무것도 안 주면 «다운로드» 폴더의 sealshare-key*.txt(가장 최근)
// 🔑 파일에서 읽으면 열쇠가 대화·화면에 한 번도 안 나온다
function findKey(arg, file) {
  const KEY_RE = /ss_[A-Za-z0-9_-]{40,}/;
  if (arg && KEY_RE.test(arg)) return { token: arg.match(KEY_RE)[0], from: "직접 입력" };
  let path = file || (arg && existsSync(arg) ? arg : null);
  if (!path) {
    const dl = join(homedir(), "Downloads");
    const names = existsSync(dl) ? readdirSync(dl).filter((n) => /^sealshare-key.*\.txt$/i.test(n)) : [];
    const newest = names.map((n) => ({ n, t: statSync(join(dl, n)).mtimeMs })).sort((a, b) => b.t - a.t)[0];
    if (!newest) die(`열쇠 파일을 못 찾았습니다.\n운영자에게 받은 sealshare-key-….txt 를 «다운로드» 폴더(${dl})에 두고 다시 「sealshare 열쇠 등록해줘」 하세요.`);
    path = join(dl, newest.n);
  }
  if (!existsSync(path)) die(`파일이 없습니다: ${path}`);
  const m = readFileSync(path, "utf8").match(KEY_RE);
  if (!m) die(`이 파일에서 열쇠를 못 찾았습니다: ${path}`);
  return { token: m[0], from: path };
}

async function login(arg, server, file) {
  const { token, from } = findKey(arg, file);
  const c = readJson(CONFIG, {});
  c.token = token.trim();
  if (server) c.server = server.replace(/\/+$/, "");
  const srv = (c.server || DEFAULT_SERVER).replace(/\/+$/, "");
  const r = await fetch(`${srv}/api/me/whoami`, { headers: { authorization: `Bearer ${authOf(c.token)}` } });
  if (r.status === 401) die("서버에 등록되지 않은 열쇠입니다 — 운영자에게 받은 열쇠를 그대로 넣었는지 확인하세요. (저장하지 않았습니다)");
  if (!r.ok) die(`서버 확인에 실패했습니다 (${r.status})`);
  const { name } = await r.json();
  writeJson(CONFIG, c);
  const fromFile = from !== "직접 입력" ? `\n열쇠 파일(${from})은 이제 지워도 됩니다.` : "";
  console.log(`등록했습니다 — ${name} 님으로 확인됐습니다.${fromFile}\n설정 파일: ${CONFIG}\n\n${HELP}`);
}

function die(m) { console.error(m); process.exit(1); }

const argv = process.argv.slice(2);
const flag = (name) => { const i = argv.indexOf(name); if (i < 0) return undefined; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const titleArg = flag("--title");
const serverArg = flag("--server");
const fileArg = flag("--file");
const [cmd, arg] = argv;

try {
  if (cmd === "share") await share(arg, titleArg);
  else if (cmd === "list") await list();
  else if (cmd === "off") await off(arg);
  else if (cmd === "me") me();
  else if (cmd === "login") await login(arg, serverArg, fileArg);
  else if (cmd === "whoami") { const c = config(); console.log(`서버 ${c.server}\n열쇠 ${c.token ? "있음" : "없음"}\n설정 ${CONFIG}`); }
  else console.log(HELP);
} catch (e) {
  die(`실패: ${e?.message || e}`);
}
