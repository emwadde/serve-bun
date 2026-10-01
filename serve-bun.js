#!/usr/bin/env bun
/**
 * fserve — a single-file static file server for Bun with a tidy listing UI.
 *
 * Run:      bun fserve.ts [dir] --port 8080 --username me --password secret
 * Compile:  bun build --compile ./fserve.ts --outfile fserve
 */
import { Glob } from "bun";
import { parseArgs } from "node:util";
import { stat } from "node:fs/promises";
import { resolve, sep, basename } from "node:path";
import { createHash, timingSafeEqual } from "node:crypto";

// ───────────────────────── CLI ─────────────────────────
const HELP = `Usage: fserve [dir] [options]

  dir                 Directory to serve (default: current directory)
  --port <n>          Port to listen on (default: 8080)
  --host <addr>       Address to bind (default: 0.0.0.0)
  --username <user>   Enable Basic auth (requires --password)
  --password <pass>   Basic auth password (requires --username)
  --all               Show dotfiles
  -h, --help          Show this help
`;

let parsed;
try {
  parsed = parseArgs({
    args: Bun.argv.slice(2),
    allowPositionals: true,
    options: {
      port: { type: "string", default: "8080" },
      host: { type: "string", default: "0.0.0.0" },
      username: { type: "string" },
      password: { type: "string" },
      all: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
} catch (e) {
  console.error(`${(e as Error).message}\n\n${HELP}`);
  process.exit(1);
}

const { values, positionals } = parsed;
if (values.help) {
  console.log(HELP);
  process.exit(0);
}

const PORT = Number(values.port);
if (!Number.isInteger(PORT) || PORT < 0 || PORT > 65535) {
  console.error(`Invalid --port: ${values.port}`);
  process.exit(1);
}
if (!!values.username !== !!values.password) {
  console.error("--username and --password must be provided together.");
  process.exit(1);
}

const ROOT = resolve(positionals[0] ?? ".");
const SHOW_ALL = values.all!;
const AUTH = values.username
  ? { user: sha(values.username), pass: sha(values.password!) }
  : null;

try {
  if (!(await stat(ROOT)).isDirectory()) throw new Error("not a directory");
} catch {
  console.error(`Cannot serve "${ROOT}": not a readable directory.`);
  process.exit(1);
}

// ───────────────────────── Helpers ─────────────────────────
function sha(s: string) {
  return createHash("sha256").update(s).digest();
}

function authorized(req: Request): boolean {
  if (!AUTH) return true;
  const h = req.headers.get("authorization") ?? "";
  if (!h.startsWith("Basic ")) return false;
  let decoded: string;
  try {
    const bytes = Uint8Array.from(atob(h.slice(6).trim()), (c) => c.charCodeAt(0));
    decoded = new TextDecoder().decode(bytes);
  } catch {
    return false;
  }
  const i = decoded.indexOf(":");
  if (i < 0) return false;
  const okUser = timingSafeEqual(sha(decoded.slice(0, i)), AUTH.user);
  const okPass = timingSafeEqual(sha(decoded.slice(i + 1)), AUTH.pass);
  return okUser && okPass;
}

function humanSize(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB", "PB"];
  let i = -1;
  do {
    n /= 1024;
    i++;
  } while (n >= 1024 && i < units.length - 1);
  return `${n.toFixed(n >= 10 ? 0 : 1)} ${units[i]}`;
}

const encodePath = (p: string) => p.split("/").map(encodeURIComponent).join("/");

type Entry = {
  name: string;
  isDir: boolean;
  size: number;
  created: number | null;
  modified: number;
  href: string;
};

async function listDir(abs: string, urlPath: string): Promise<Entry[]> {
  const entries: Entry[] = [];
  const glob = new Glob("*");
  for await (const name of glob.scan({ cwd: abs, onlyFiles: false, dot: SHOW_ALL })) {
    try {
      const st = await stat(resolve(abs, name));
      const isDir = st.isDirectory();
      entries.push({
        name,
        isDir,
        size: isDir ? 0 : st.size,
        created: st.birthtimeMs > 0 ? st.birthtimeMs : null,
        modified: st.mtimeMs,
        href: encodePath(urlPath) + encodeURIComponent(name) + (isDir ? "/" : ""),
      });
    } catch {
      // broken symlink / permission error: skip
    }
  }
  return entries;
}

// ───────────────────────── Page ─────────────────────────
function renderPage(urlPath: string, entries: Entry[]): Response {
  const data = {
    path: urlPath,
    entries: entries.map((e) => ({ ...e, sizeText: e.isDir ? "—" : humanSize(e.size) })),
  };
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  const title = `Index of ${urlPath}`;
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title.replace(/[<>&]/g, "")}</title>
<style>
  :root {
    --bg: #f6f7f9; --panel: #fff; --text: #1c1f24; --muted: #6b7280;
    --line: #e5e7eb; --hover: #f1f5ff; --accent: #3b5bdb; --dir: #b7791f;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0f1115; --panel: #171a21; --text: #e6e8ec; --muted: #8b93a1;
      --line: #262b36; --hover: #1d2330; --accent: #7c97ff; --dir: #e0a847;
    }
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; }
  body {
    background: var(--bg); color: var(--text);
    font: 14px/1.4 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    display: flex; flex-direction: column; align-items: center; padding: 24px 16px;
  }
  .card {
    width: 100%; max-width: 1100px; flex: 1; min-height: 0;
    background: var(--panel); border: 1px solid var(--line); border-radius: 12px;
    display: flex; flex-direction: column; overflow: hidden;
    box-shadow: 0 1px 2px rgba(0,0,0,.04), 0 8px 24px rgba(0,0,0,.05);
  }
  header { padding: 16px 20px; border-bottom: 1px solid var(--line); display: flex; gap: 16px; align-items: center; flex-wrap: wrap; }
  .crumbs { font-size: 16px; font-weight: 600; flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .crumbs a { color: var(--accent); text-decoration: none; }
  .crumbs a:hover { text-decoration: underline; }
  .crumbs span { color: var(--muted); margin: 0 4px; font-weight: 400; }
  input[type=search] {
    background: var(--bg); color: var(--text); border: 1px solid var(--line);
    border-radius: 8px; padding: 7px 12px; width: 220px; font: inherit; outline: none;
  }
  input[type=search]:focus { border-color: var(--accent); }
  .scroll { flex: 1; overflow: auto; }
  table { width: 100%; border-collapse: collapse; }
  thead th {
    position: sticky; top: 0; background: var(--panel); z-index: 1;
    text-align: left; padding: 10px 20px; font-size: 12px; text-transform: uppercase;
    letter-spacing: .04em; color: var(--muted); border-bottom: 1px solid var(--line);
    cursor: pointer; user-select: none; white-space: nowrap;
  }
  thead th:hover { color: var(--text); }
  thead th .arrow { margin-left: 4px; opacity: .8; }
  th.num, td.num { text-align: right; }
  tbody tr { border-bottom: 1px solid var(--line); }
  tbody tr:hover { background: var(--hover); }
  td { padding: 0; white-space: nowrap; color: var(--muted); font-variant-numeric: tabular-nums; }
  td > a, td > div { display: block; padding: 11px 20px; color: inherit; text-decoration: none; }
  td.name { width: 100%; max-width: 0; color: var(--text); }
  td.name a { display: flex; gap: 10px; align-items: center; overflow: hidden; }
  td.name .label { overflow: hidden; text-overflow: ellipsis; }
  .ico { width: 18px; text-align: center; flex: none; }
  .dir .label { font-weight: 600; }
  .dir .ico { color: var(--dir); }
  .dl { color: var(--muted); padding: 11px 16px !important; text-align: center; }
  .dl:hover { color: var(--accent); }
  .empty { padding: 48px; text-align: center; color: var(--muted); }
  footer { padding: 10px 20px; border-top: 1px solid var(--line); color: var(--muted); font-size: 12px; }
  @media (max-width: 720px) { .hide-sm { display: none; } input[type=search] { width: 100%; } }
</style>
</head>
<body>
<div class="card">
  <header>
    <div class="crumbs" id="crumbs"></div>
    <input type="search" id="filter" placeholder="Filter…" autofocus>
  </header>
  <div class="scroll">
    <table>
      <thead>
        <tr>
          <th data-k="name">Name<span class="arrow"></span></th>
          <th data-k="size" class="num">Size<span class="arrow"></span></th>
          <th data-k="created" class="hide-sm">Created<span class="arrow"></span></th>
          <th data-k="modified" class="hide-sm">Modified<span class="arrow"></span></th>
          <th style="cursor:default"></th>
        </tr>
      </thead>
      <tbody id="rows"></tbody>
    </table>
    <div class="empty" id="empty" hidden>Nothing here.</div>
  </div>
  <footer id="foot"></footer>
</div>
<script>
const DATA = ${json};
const $ = (id) => document.getElementById(id);
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const pad = (n) => String(n).padStart(2, "0");
const fmtDate = (ms) => {
  if (ms == null) return "—";
  const d = new Date(ms);
  return d.getFullYear() + "-" + pad(d.getMonth()+1) + "-" + pad(d.getDate()) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
};

// breadcrumbs
(function () {
  const parts = DATA.path.split("/").filter(Boolean);
  let acc = "/", html = '<a href="/">/</a>';
  parts.forEach((p) => {
    acc += encodeURIComponent(decodeURIComponent(p)) + "/";
    html += '<span>/</span><a href="' + acc + '">' + esc(decodeURIComponent(p)) + "</a>";
  });
  $("crumbs").innerHTML = html;
})();

let sortKey = "name", sortDir = 1, query = "";
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function render() {
  let list = DATA.entries.filter((e) => e.name.toLowerCase().includes(query));
  list.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;           // folders first
    let r;
    if (sortKey === "name") r = collator.compare(a.name, b.name);
    else r = (a[sortKey] ?? -1) - (b[sortKey] ?? -1);
    return r * sortDir || collator.compare(a.name, b.name);
  });

  let html = "";
  if (DATA.path !== "/") {
    const up = DATA.path.replace(/[^/]+\\/$/, "");
    html += '<tr class="dir"><td class="name"><a href="' + up + '"><span class="ico">↰</span><span class="label">..</span></a></td><td></td><td class="hide-sm"></td><td class="hide-sm"></td><td></td></tr>';
  }
  for (const e of list) {
    const icon = e.isDir ? "📁" : "📄";
    html += '<tr class="' + (e.isDir ? "dir" : "file") + '">' +
      '<td class="name"><a href="' + e.href + '" title="' + esc(e.name) + '"><span class="ico">' + icon + '</span><span class="label">' + esc(e.name) + '</span></a></td>' +
      '<td class="num"><div>' + e.sizeText + '</div></td>' +
      '<td class="hide-sm"><div>' + fmtDate(e.created) + '</div></td>' +
      '<td class="hide-sm"><div>' + fmtDate(e.modified) + '</div></td>' +
      '<td>' + (e.isDir ? "" : '<a class="dl" href="' + e.href + '?download=1" title="Download">⬇</a>') + '</td></tr>';
  }
  $("rows").innerHTML = html;
  $("empty").hidden = list.length > 0 || DATA.path !== "/";

  document.querySelectorAll("thead th[data-k]").forEach((th) => {
    th.querySelector(".arrow").textContent = th.dataset.k === sortKey ? (sortDir > 0 ? "▲" : "▼") : "";
  });
  const files = DATA.entries.filter((e) => !e.isDir);
  const total = files.reduce((s, e) => s + e.size, 0);
  const units = ["B","KB","MB","GB","TB"]; let n = total, i = 0;
  while (n >= 1024 && i < 4) { n /= 1024; i++; }
  $("foot").textContent = (DATA.entries.length - files.length) + " folders, " + files.length + " files · " + (i ? n.toFixed(n >= 10 ? 0 : 1) : n) + " " + units[i];
}

document.querySelectorAll("thead th[data-k]").forEach((th) =>
  th.addEventListener("click", () => {
    const k = th.dataset.k;
    if (sortKey === k) sortDir *= -1; else { sortKey = k; sortDir = k === "name" ? 1 : -1; }
    render();
  })
);
$("filter").addEventListener("input", (e) => { query = e.target.value.toLowerCase(); render(); });
render();
</script>
</body>
</html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

// ───────────────────────── Request handling ─────────────────────────
const text = (status: number, body: string, headers: HeadersInit = {}) =>
  new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", ...headers } });

async function handle(req: Request): Promise<Response> {
  if (!authorized(req)) {
    return text(401, "Authentication required", {
      "WWW-Authenticate": 'Basic realm="fserve", charset="UTF-8"',
    });
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    return text(405, "Method Not Allowed", { Allow: "GET, HEAD" });
  }

  const url = new URL(req.url);
  let urlPath: string;
  try {
    urlPath = decodeURIComponent(url.pathname);
  } catch {
    return text(400, "Bad Request");
  }
  if (urlPath.includes("\0")) return text(400, "Bad Request");

  // Resolve and make sure we never leave ROOT (blocks ../ traversal)
  const abs = resolve(ROOT, "." + urlPath);
  if (abs !== ROOT && !abs.startsWith(ROOT + sep)) return text(403, "Forbidden");

  // Hide dotfiles unless --all
  if (!SHOW_ALL && urlPath.split("/").some((seg) => seg.startsWith(".") && seg.length > 1)) {
    return text(404, "Not Found");
  }

  let st;
  try {
    st = await stat(abs);
  } catch {
    return text(404, "Not Found");
  }

  if (st.isDirectory()) {
    if (!urlPath.endsWith("/")) {
      return new Response(null, { status: 301, headers: { Location: encodePath(urlPath) + "/" + url.search } });
    }
    return renderPage(urlPath, await listDir(abs, urlPath));
  }

  const file = Bun.file(abs);
  const size = file.size;
  const headers: Record<string, string> = {
    "Content-Type": file.type || "application/octet-stream",
    "Accept-Ranges": "bytes",
    "Last-Modified": new Date(st.mtimeMs).toUTCString(),
    "Content-Disposition": `${url.searchParams.has("download") ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(basename(abs))}`,
  };

  // Range support (video/audio seeking, resumable downloads)
  const range = req.headers.get("range");
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (m && (m[1] || m[2])) {
      let start: number, end: number;
      if (m[1] === "") {
        start = Math.max(size - parseInt(m[2]!, 10), 0);
        end = size - 1;
      } else {
        start = parseInt(m[1]!, 10);
        end = m[2] ? Math.min(parseInt(m[2], 10), size - 1) : size - 1;
      }
      if (start > end || start >= size) {
        return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
      }
      return new Response(req.method === "HEAD" ? null : file.slice(start, end + 1), {
        status: 206,
        headers: {
          ...headers,
          "Content-Range": `bytes ${start}-${end}/${size}`,
          "Content-Length": String(end - start + 1),
        },
      });
    }
  }

  headers["Content-Length"] = String(size);
  return new Response(req.method === "HEAD" ? null : file, { headers });
}

// ───────────────────────── Server + logging ─────────────────────────
const color = (code: number, s: string) => {
  if (!process.stdout.isTTY) return s;
  const c = code >= 500 ? 31 : code >= 400 ? 33 : code >= 300 ? 36 : 32;
  return `\x1b[${c}m${s}\x1b[0m`;
};

const server = Bun.serve({
  port: PORT,
  hostname: values.host,
  async fetch(req, srv) {
    const t0 = performance.now();
    let res: Response;
    try {
      res = await handle(req);
    } catch (err) {
      console.error(err);
      res = text(500, "Internal Server Error");
    }
    const ms = (performance.now() - t0).toFixed(1);
    const ip = srv.requestIP(req)?.address ?? "-";
    const len = res.headers.get("content-length");
    const path = (() => {
      const u = new URL(req.url);
      return u.pathname + u.search;
    })();
    console.log(
      `${new Date().toISOString()} ${ip} ${req.method} ${path} ${color(res.status, String(res.status))} ${ms}ms ${len ? humanSize(Number(len)) : "-"}`,
    );
    return res;
  },
  error(err) {
    console.error(err);
    return text(500, "Internal Server Error");
  },
});

console.log(`Serving ${ROOT}`);
console.log(`Listening on http://${server.hostname === "0.0.0.0" ? "localhost" : server.hostname}:${server.port}${AUTH ? "  (Basic auth enabled)" : ""}`);
