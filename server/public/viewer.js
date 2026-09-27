// 보기 화면 — 링크의 # 뒤 열쇠로 «이 브라우저 안에서» 푼다. 열쇠는 서버로 가지 않는다.
//
// 내용은 «다른 주소»의 틀(frame.…, sandbox iframe)에 띄운다 — 틀 안 스크립트는 이 페이지(와 주소창의 열쇠)에 닿지 못한다
//   · HTML  — 그대로
//   · 마크다운 — 우리 양식으로 그리고, 스크립트는 문서 안 CSP 로 끈다
(function () {
  const msg = document.getElementById("msg");
  const frame = document.getElementById("frame");

  function fail(title, detail) {
    msg.innerHTML = "";
    const box = document.createElement("div");
    const b = document.createElement("b");
    b.textContent = title;
    const s = document.createElement("span");
    s.textContent = detail || "";
    box.append(b, s);
    msg.appendChild(box);
    msg.style.display = "grid";
  }

  function b64urlToBytes(s) {
    s = s.replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function gunzip(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    return await new Response(stream).text();
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  // 제목에 id 를 붙인다 — [아래로](#끝) 같은 문서 안 링크가 가게(marked 는 이제 안 붙인다)
  function headingIds(html) {
    const used = {};
    return html.replace(/<h([1-6])>([\s\S]*?)<\/h\1>/g, (m, n, inner) => {
      let id = inner.replace(/<[^>]+>/g, "").replace(/&[#a-z0-9]+;/gi, "").trim().toLowerCase()
        .replace(/[^\p{L}\p{N}\s-]/gu, "").replace(/\s+/g, "-") || "section";
      if (used[id] != null) id += "-" + (++used[id]); else used[id] = 0;
      return `<h${n} id="${id}">${inner}</h${n}>`;
    });
  }

  // saved — 「저장」으로 내려받는 판이면 꼬리말을 «받은 문서»로 바꾼다(파일은 이제 링크 밖에 있으니까)
  function mdDocument(p, saved = false) {
    const html = headingIds(window.marked.parse(p.body || "", { gfm: true, breaks: false }));
    const when = p.created ? new Date(p.created).toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" }) : "";
    return `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="script-src 'none'">
<style>
  :root { color-scheme: light dark; --bg:#FFFEFB; --ink:#262521; --ink2:#57544D; --muted:#8a867f; --line:#ECE9E2; --code:#F4F2EC; --link:#8A4B2A; }
  @media (prefers-color-scheme: dark) { :root { --bg:#1F1E1C; --ink:#F2F0EA; --ink2:#C9C5BC; --muted:#9A968D; --line:#34322E; --code:#2A2926; --link:#EDA67F; } }
  html { background: var(--bg); }
  body { margin: 0 auto; max-width: 760px; padding: 48px 24px 64px; color: var(--ink); background: var(--bg);
    font: 17px/1.75 -apple-system, "Apple SD Gothic Neo", "Pretendard", "Malgun Gothic", sans-serif; word-break: keep-all; overflow-wrap: anywhere; }
  h1, h2, h3, h4 { line-height: 1.35; letter-spacing: -.01em; margin: 1.8em 0 .6em; }
  h1 { font-size: 30px; margin-top: 0; } h2 { font-size: 23px; } h3 { font-size: 19px; }
  p, ul, ol, blockquote, pre, table { margin: 0 0 1.05em; }
  a { color: var(--link); }
  img { max-width: 100%; height: auto; border-radius: 10px; }
  blockquote { margin-left: 0; padding: 2px 16px; border-left: 3px solid var(--line); color: var(--ink2); }
  code { background: var(--code); padding: .1em .35em; border-radius: 5px; font-size: .92em; }
  pre { background: var(--code); padding: 14px 16px; border-radius: 10px; overflow-x: auto; }
  pre code { background: none; padding: 0; }
  table { border-collapse: collapse; width: 100%; display: block; overflow-x: auto; }
  th, td { border: 1px solid var(--line); padding: 6px 10px; text-align: left; }
  hr { border: 0; border-top: 1px solid var(--line); margin: 2em 0; }
  footer { margin-top: 48px; padding-top: 16px; border-top: 1px solid var(--line); color: var(--muted); font-size: 13px; line-height: 1.6; }
</style><title>${esc(p.title || "공유 문서")}</title></head><body><article>${html}</article>
<footer>${saved ? "sealshare 로 받은 문서" : "🔒 링크가 있는 사람만 볼 수 있습니다 · 서버는 이 내용을 읽을 수 없습니다"}${when ? " · " + esc(when) + " 공유" : ""}</footer></body></html>`;
  }

  // 저장 — 이미 이 브라우저에서 풀어 둔 원문을 그대로 파일로 내준다(서버에 다시 묻지 않는다).
  //   HTML → .html (로컬 그림·스크립트까지 한 파일로 묶여 있어 그대로 열린다)
  //   마크다운 → .md 원문 또는 읽기 좋은 .html
  function setupSave(p) {
    const box = document.getElementById("save"), btn = document.getElementById("saveBtn"), menu = document.getElementById("saveMenu");
    const base = (p.title || "공유 문서").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim().slice(0, 80) || "공유 문서";
    const download = (text, name, type) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([text], { type }));
      a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    };
    const save = (fmt) => {
      if (fmt === "md") download(p.body || "", base + ".md", "text/markdown;charset=utf-8");
      else {
        let html = p.kind === "html" ? p.body : mdDocument(p, true);
        if (!/<meta[^>]+charset/i.test(html.slice(0, 4096))) html = "﻿" + html; // 문자셋을 안 밝힌 파일은 로컬에서 열 때 한글이 깨진다 — BOM 으로 UTF-8 을 알린다
        download(html, base + ".html", "text/html;charset=utf-8");
      }
      menu.hidden = true; box.classList.remove("open");
    };
    btn.onclick = () => {
      if (p.kind === "html") return save("html");
      menu.hidden = !menu.hidden; box.classList.toggle("open", !menu.hidden);
    };
    menu.querySelectorAll("button").forEach((b) => (b.onclick = () => save(b.dataset.fmt)));
    box.hidden = false;
  }

  async function main() {
    const id = location.pathname.split("/")[2] || "";
    const key = location.hash.slice(1);
    if (!/^[A-Za-z0-9_-]{22}$/.test(id)) return fail("링크 주소가 올바르지 않습니다", "받은 링크를 처음부터 끝까지 그대로 여세요.");
    if (!/^[A-Za-z0-9_-]{43}$/.test(key)) return fail("링크가 잘렸습니다", "# 뒤에 붙은 열쇠까지 전부 있어야 열립니다. 받은 링크를 다시 복사해 여세요.");
    if (!window.crypto || !crypto.subtle || typeof DecompressionStream === "undefined") {
      return fail("이 브라우저로는 열 수 없습니다", "최신 사파리·크롬·엣지로 여세요.");
    }

    const res = await fetch(`/api/s/${id}`, { cache: "no-store", referrerPolicy: "no-referrer" });
    if (res.status === 404) return fail("없거나 꺼진 링크입니다", "공유한 사람이 링크를 껐을 수 있습니다.");
    if (!res.ok) return fail("불러오지 못했습니다", `잠시 뒤 다시 여세요. (${res.status})`);
    const data = new Uint8Array(await res.arrayBuffer());

    let text;
    try {
      const k = await crypto.subtle.importKey("raw", b64urlToBytes(key), "AES-GCM", false, ["decrypt"]);
      const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: data.slice(0, 12) }, k, data.slice(12));
      text = await gunzip(new Uint8Array(plain));
    } catch {
      return fail("열쇠가 맞지 않습니다", "링크의 # 뒤가 바뀌었거나 잘렸습니다. 받은 링크를 그대로 여세요.");
    }

    const p = JSON.parse(text);
    document.title = p.title || "공유 문서";
    // 🔑 HTML·마크다운 모두 «다른 주소»의 틀(frame.<이 주소>)에 띄운다.
    //   불투명 출처(sandbox, same-origin 없음)로 띄우면 주소 조작·저장소를 쓰는 페이지가 멈춘다(발표 슬라이드가 그랬다).
    //   마크다운도 예전엔 이 페이지의 srcdoc 로 띄웠는데, 이 페이지의 엄격한 CSP 를 물려받아 웹 그림·영상·유튜브가 전부 막혔다.
    //   다른 주소면 그 안에서는 평범하게 돌고, 이 페이지(주소창의 열쇠)에는 여전히 못 닿는다.
    const frameOrigin = `${location.protocol}//frame.${location.host}`;
    const html = p.kind === "html" ? p.body : mdDocument(p);
    // 바탕 — 페이지가 색을 안 정했으면 «브라우저로 직접 연 것처럼» 흰 바탕. 이 페이지의 다크 바탕이 비쳐 들면 검은 글씨가 안 보인다.
    //   틀이 페이지의 color-scheme 을 알려 오면(sealshare:scheme) 그대로 맞춘다(다크 모드를 지원하는 페이지는 다크로)
    if (p.kind === "html") { frame.style.colorScheme = "only light"; frame.style.backgroundColor = "Canvas"; }
    frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms allow-modals allow-downloads");
    frame.setAttribute("allow", "fullscreen; clipboard-write; autoplay; encrypted-media; picture-in-picture"); // 유튜브 등 임베드가 쓰는 권한까지 넘긴다
    frame.setAttribute("allowfullscreen", "");
    window.addEventListener("message", (e) => {
      if (e.origin !== frameOrigin || !e.data) return;
      if (e.data.type === "sealshare:ready") frame.contentWindow.postMessage({ type: "sealshare:render", html }, frameOrigin);
      if (e.data.type === "sealshare:scheme" && typeof e.data.scheme === "string" && /^[a-z ]{1,40}$/.test(e.data.scheme)) {
        frame.style.colorScheme = e.data.scheme;
        frame.style.backgroundColor = "Canvas";
      }
    });
    frame.src = `${frameOrigin}/frame`;
    setupSave(p);
    frame.addEventListener("load", () => { try { frame.focus(); } catch {} }, { once: true });
    frame.style.display = "block";
    msg.style.display = "none";
  }

  main().catch((e) => fail("열지 못했습니다", String(e && e.message || e)));
})();
