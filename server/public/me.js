// 관리 페이지 — 내 공유 목록을 이 브라우저에서 풀어 보여 주고, 링크 복사·끄기를 한다.
// 올리기 열쇠는 주소의 # 뒤에만 있다(서버로 안 간다). 서버로는 «인증값»만 간다(lib/shared.js 머리 주석).
(function () {
  const $ = (id) => document.getElementById(id);
  const enc = new TextEncoder();
  let token = decodeURIComponent(location.hash.slice(1));
  let auth = "", ikey = null, etag = null, links = [];

  const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const sha = (s) => crypto.subtle.digest("SHA-256", enc.encode(s));

  async function derive(t) {
    auth = b64url(await sha("sealshare/auth/v1:" + t));
    ikey = await crypto.subtle.importKey("raw", await sha("sealshare/index/v1:" + t), "AES-GCM", false, ["encrypt", "decrypt"]);
  }
  async function seal(obj) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, ikey, enc.encode(JSON.stringify(obj))));
    const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12); return out;
  }
  async function open(bytes) {
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12) }, ikey, bytes.slice(12));
    return JSON.parse(new TextDecoder().decode(pt));
  }

  async function load() {
    const r = await fetch("/api/me/list", { headers: { authorization: "Bearer " + auth }, cache: "no-store" });
    if (r.status === 401) throw new Error("등록되지 않은 열쇠입니다 — 운영자에게 받은 열쇠를 확인하세요.");
    const name = decodeURIComponent(r.headers.get("x-name") || "");
    if (r.status === 404) { etag = null; links = []; return name; }
    if (!r.ok) throw new Error(`목록을 못 불러왔습니다 (${r.status})`);
    etag = r.headers.get("etag");
    links = (await open(new Uint8Array(await r.arrayBuffer()))).links || [];
    return name;
  }
  // 목록 고치기 — 그사이 CLI 가 고쳤으면(412) 다시 읽고 다시 적용한다
  async function update(fn) {
    for (let i = 0; i < 4; i++) {
      const next = fn(links.slice());
      const headers = { authorization: "Bearer " + auth, "content-type": "application/octet-stream" };
      if (etag) headers["x-if-match"] = etag;
      const r = await fetch("/api/me/list", { method: "PUT", headers, body: await seal({ v: 1, links: next }) });
      if (r.status === 412) { await load(); continue; }
      if (!r.ok) throw new Error(`목록을 못 고쳤습니다 (${r.status})`);
      etag = (await r.json()).etag; links = next; return;
    }
    throw new Error("목록이 계속 바뀌고 있습니다 — 잠시 뒤 다시");
  }

  const fmtBytes = (n) => n > 1e6 ? (n / 1e6).toFixed(1) + "MB" : Math.max(1, Math.round(n / 1024)) + "KB";
  const fmtDate = (s) => new Date(s).toLocaleString("ko-KR", { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });

  function el(tag, props = {}, kids = []) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) (k === "text" ? (e.textContent = v) : k === "class" ? (e.className = v) : e.setAttribute(k, v));
    for (const k of kids) e.appendChild(k);
    return e;
  }

  function render(name) {
    $("sub").textContent = `${name ? name + " 님 · " : ""}${links.length}건 · 새 공유는 클로드 코드에서 「이거 링크로 공유해줘」`;
    const box = $("list"); box.textContent = "";
    if (!links.length) {
      box.appendChild(el("p", { class: "empty", text: "아직 공유한 문서가 없습니다. 클로드 코드에서 「이 파일 링크로 공유해줘」라고 해 보세요." }));
      return;
    }
    for (const l of links.slice().sort((a, b) => b.created.localeCompare(a.created))) {
      const copy = el("button", { text: "링크 복사" });
      copy.onclick = async () => {
        try { await navigator.clipboard.writeText(l.url); copy.textContent = "복사했어요 ✓"; copy.classList.add("done"); }
        catch { copy.textContent = "복사 실패 — 열기로 연 뒤 주소를 복사하세요"; }
        setTimeout(() => { copy.textContent = "링크 복사"; copy.classList.remove("done"); }, 2500);
      };
      const openA = el("a", { class: "btn", href: l.url, target: "_blank", rel: "noopener noreferrer", text: "열기" });
      const off = el("button", { class: "danger", text: "끄기" });
      let armed = null;
      off.onclick = async () => {
        if (!armed) { off.textContent = "정말 끌까요? 한 번 더"; off.classList.add("armed"); armed = setTimeout(() => { armed = null; off.textContent = "끄기"; off.classList.remove("armed"); }, 3000); return; }
        clearTimeout(armed); off.disabled = true; off.textContent = "끄는 중…";
        try {
          const r = await fetch(`/api/s/${l.id}`, { method: "DELETE", headers: { authorization: "Bearer " + auth } });
          if (!r.ok) throw new Error(`서버가 거절했습니다 (${r.status})`);
          await update((list) => list.filter((x) => x.id !== l.id));
          render(name);
        } catch (e) { off.disabled = false; off.textContent = "끄기"; off.classList.remove("armed"); armed = null; alertBox(e.message); }
      };
      box.appendChild(el("div", { class: "card" }, [
        el("div", { class: "title", text: l.title || l.name || l.id }),
        el("div", { class: "meta", text: `${fmtDate(l.created)} · ${l.kind === "html" ? "HTML" : "마크다운"} · ${fmtBytes(l.bytes || 0)}` }),
        el("div", { class: "row" }, [copy, openA, off]),
      ]));
    }
  }
  function alertBox(m) { const p = el("p", { class: "err", text: m }); $("list").prepend(p); setTimeout(() => p.remove(), 6000); }

  async function start() {
    if (!window.crypto || !crypto.subtle) { $("sub").textContent = "이 브라우저로는 열 수 없습니다 — 최신 사파리·크롬으로 여세요."; return; }
    if (!/^ss_[A-Za-z0-9_-]{20,}$/.test(token)) {
      $("sub").textContent = "올리기 열쇠가 필요합니다";
      $("login").hidden = false;
      $("go").onclick = () => { const t = $("tok").value.trim(); if (t) { location.hash = t; location.reload(); } };
      return;
    }
    try {
      await derive(token);
      const name = await load();
      render(name);
    } catch (e) {
      $("sub").textContent = ""; $("sub").appendChild(el("span", { class: "err", text: e.message }));
    }
  }
  start();
})();
