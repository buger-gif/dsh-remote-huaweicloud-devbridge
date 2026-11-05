/* panel.js — 华为云 DevBridge 远控控制台（原生 DOM，零依赖，无构建）
 *
 * 事实源：DSH 同源 API /plugins/devbridge-remote，宿主注入
 * window.DEVBRIDGE_REMOTE_API / window.DEVBRIDGE_REMOTE_TOKEN。
 * 同一份代码既挂在 DSH 侧边栏，也用于独立控制页（mount standalone）。
 */
(function () {
  "use strict";

  var API = (typeof window !== "undefined" && window.DEVBRIDGE_REMOTE_API) || "/plugins/devbridge-remote";
  var TOKEN = (typeof window !== "undefined" && window.DEVBRIDGE_REMOTE_TOKEN) || "";

  var CSS = [
    ".dbr-root{--bg:var(--dsw-alias-bg-base,#fff);--panel:var(--dsw-alias-bg-layer-1,#fff);",
    "--fg:var(--dsw-alias-label-primary,#1a1d21);--fg2:var(--dsw-alias-label-secondary,#59616e);",
    "--fg3:var(--dsw-alias-label-tertiary,#8b909a);--line:var(--dsw-alias-border-l2,#e5e7eb);",
    "--line2:var(--dsw-alias-border-l3,#eef0f3);--hover:var(--dsw-alias-interactive-bg-hover,#f3f4f6);",
    "--accent:var(--dsw-alias-brand-primary,#2563eb);--ok:var(--dsw-alias-state-success-primary,#16a34a);",
    "--warn:var(--dsw-alias-state-warn-primary,#d97706);--err:var(--dsw-alias-state-error-primary,#dc2626);",
    "--sunk:var(--dsw-specific-sidebar-nav-item-hover,#f8f9fb);",
    "--r:var(--dsw-radius-md,10px);--r-sm:var(--dsw-radius-sm,7px);",
    "--mono:var(--dsh-font-family-code-default,ui-monospace,SFMono-Regular,Menlo,monospace);",
    "--font:var(--dsw-font-family,-apple-system,BlinkMacSystemFont,'PingFang SC',system-ui,sans-serif);",
    "font:13px/1.55 var(--font);color:var(--fg);background:var(--panel);height:100%;min-height:0;",
    "display:flex;flex-direction:column;-webkit-font-smoothing:antialiased}",
    ".dbr-root *{box-sizing:border-box}",
    ".dbr-head{display:flex;align-items:center;gap:9px;padding:13px 15px;border-bottom:1px solid var(--line);flex:none}",
    ".dbr-title{font-size:13.5px;font-weight:650;letter-spacing:.01em}",
    ".dbr-grow{flex:1;min-width:0}",
    ".dbr-badge{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;padding:3px 9px;",
    "border-radius:999px;border:1px solid var(--line);color:var(--fg2);white-space:nowrap}",
    ".dbr-badge i{width:7px;height:7px;border-radius:50%;background:var(--fg3);display:block}",
    ".dbr-badge.on i{background:var(--ok)}.dbr-badge.on{color:var(--ok);border-color:color-mix(in srgb,var(--ok) 35%,transparent)}",
    ".dbr-badge.busy i{background:var(--warn)}.dbr-badge.busy{color:var(--warn)}",
    ".dbr-badge.bad i{background:var(--err)}.dbr-badge.bad{color:var(--err)}",
    ".dbr-body{flex:1;min-height:0;overflow:auto;padding:14px 15px 20px;display:flex;flex-direction:column;gap:14px}",
    ".dbr-sec{min-width:0}",
    ".dbr-sec-t{font-size:11px;font-weight:650;color:var(--fg3);text-transform:uppercase;",
    "letter-spacing:.06em;margin:0 0 8px;display:flex;align-items:center;gap:7px}",
    ".dbr-sec-t span{flex:1;height:1px;background:var(--line2)}",
    ".dbr-actions{display:flex;flex-wrap:wrap;gap:7px}",
    ".dbr-btn{appearance:none;border:1px solid var(--line);background:transparent;color:var(--fg2);",
    "font:inherit;font-size:12px;padding:6px 11px;border-radius:var(--r-sm);cursor:pointer;",
    "display:inline-flex;align-items:center;gap:6px;white-space:nowrap}",
    ".dbr-btn:hover:not(:disabled){background:var(--hover);color:var(--fg)}",
    ".dbr-btn:disabled{opacity:.5;cursor:default}",
    ".dbr-btn.primary{background:var(--accent);border-color:var(--accent);color:#fff;font-weight:600}",
    ".dbr-btn.primary:hover:not(:disabled){filter:brightness(1.08);color:#fff}",
    ".dbr-btn.danger{color:var(--err)}",
    ".dbr-hint{background:var(--sunk);border:1px solid var(--line);border-left:3px solid var(--warn);",
    "border-radius:var(--r-sm);padding:10px 12px;font-size:12px;color:var(--fg2);word-break:break-word}",
    ".dbr-hint code{font-family:var(--mono);font-size:11px;background:var(--hover);padding:1px 4px;border-radius:4px}",
    ".dbr-kv{display:grid;grid-template-columns:88px minmax(0,1fr);gap:6px 10px;font-size:12px;align-items:start}",
    ".dbr-kv dt{color:var(--fg3);margin:0}",
    ".dbr-kv dd{margin:0;min-width:0;word-break:break-all}",
    ".dbr-field{display:flex;align-items:center;gap:6px;min-width:0}",
    ".dbr-val{flex:1;min-width:0;font-family:var(--mono);font-size:11.5px;padding:6px 8px;",
    "border:1px solid var(--line);border-radius:var(--r-sm);background:var(--sunk);",
    "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;user-select:all}",
    ".dbr-mini{border:1px solid var(--line);background:transparent;color:var(--fg2);border-radius:var(--r-sm);",
    "padding:5px 8px;font:inherit;font-size:11px;cursor:pointer;white-space:nowrap}",
    ".dbr-mini:hover{background:var(--hover)}",
    ".dbr-field input{flex:1;min-width:0;font:inherit;font-size:11.5px;font-family:var(--mono);",
    "padding:6px 8px;border:1px solid var(--line);border-radius:var(--r-sm);background:var(--bg);color:var(--fg)}",
    ".dbr-qr{display:flex;gap:14px;align-items:flex-start;flex-wrap:wrap}",
    ".dbr-qr-box{width:172px;height:172px;flex:none;border:1px solid var(--line);border-radius:var(--r);",
    "background:#fff;padding:8px;display:grid;place-items:center;overflow:hidden}",
    ".dbr-qr-box svg{width:100%;height:100%;display:block;max-width:100%;max-height:100%}",
    ".dbr-guide{border:1px solid var(--line);border-radius:var(--r-sm);background:var(--sunk);padding:9px 11px;font-size:12px;color:var(--fg2)}",
    ".dbr-guide summary{cursor:pointer;color:var(--fg);font-weight:600;list-style:none}",
    ".dbr-guide summary::-webkit-details-marker{display:none}",
    ".dbr-guide summary:before{content:'▸ ';color:var(--fg3)}",
    ".dbr-guide[open] summary:before{content:'▾ '}",
    ".dbr-guide ol{margin:10px 0 0;padding-left:18px;line-height:1.75}",
    ".dbr-guide li{margin-bottom:5px}",
    ".dbr-guide a{color:var(--accent);text-decoration:none;word-break:break-all}",
    ".dbr-guide a:hover{text-decoration:underline}",
    ".dbr-guide code{font-family:var(--mono);font-size:11px;background:var(--hover);padding:1px 5px;border-radius:4px;color:var(--fg)}",
    ".dbr-qr-empty{font-size:11.5px;color:var(--fg3);text-align:center;line-height:1.5}",
    ".dbr-qr-info{flex:1;min-width:180px;font-size:11.5px;color:var(--fg2);display:flex;flex-direction:column;gap:8px}",
    ".dbr-logs{font-family:var(--mono);font-size:10.5px;line-height:1.6;background:var(--sunk);",
    "border:1px solid var(--line);border-radius:var(--r-sm);padding:9px 10px;max-height:150px;overflow:auto}",
    ".dbr-log{white-space:pre-wrap;word-break:break-all;color:var(--fg2)}",
    ".dbr-log.warn{color:var(--warn)}.dbr-log.error{color:var(--err)}",
    ".dbr-log time{color:var(--fg3);margin-right:6px}",
    ".dbr-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:9px 12px}",
    ".dbr-form label{font-size:11.5px;color:var(--fg2);display:flex;flex-direction:column;gap:4px;min-width:0}",
    ".dbr-form input{font:inherit;font-size:12px;padding:6px 8px;border:1px solid var(--line);",
    "border-radius:var(--r-sm);background:var(--bg);color:var(--fg);min-width:0}",
    ".dbr-form label.chk{flex-direction:row;align-items:center;gap:7px}",
    ".dbr-note{font-size:11px;color:var(--fg3);border-top:1px solid var(--line2);padding-top:10px;line-height:1.6}",
    ".dbr-seat{display:flex;align-items:center;gap:9px;width:100%;height:38px;padding:0 10px;border:0;",
    "border-radius:var(--r-sm);background:transparent;color:var(--fg2);font:inherit;cursor:pointer;text-align:left}",
    ".dbr-seat:hover{background:var(--hover);color:var(--fg)}",
    ".dbr-seat-dot{width:7px;height:7px;border-radius:50%;background:var(--fg3);flex:none}",
    ".dbr-seat-dot.on{background:var(--ok)}.dbr-seat-dot.bad{background:var(--err)}",
    ".dbr-seat-label{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
    ".dbr-modal{position:fixed;inset:0;z-index:9998;background:rgba(15,18,24,.42);display:grid;place-items:center;padding:18px}",
    ".dbr-modal-card{width:min(680px,96vw);height:min(760px,92vh);background:var(--panel);",
    "border-radius:14px;box-shadow:0 18px 60px rgba(0,0,0,.22);overflow:hidden;display:flex;flex-direction:column}",
    ".dbr-modal-card .dbr-root{height:100%}",
    ".dbr-toast{position:fixed;left:50%;bottom:26px;transform:translateX(-50%);z-index:9999;",
    "background:#1f2430;color:#fff;font:12px/1.5 var(--font);padding:8px 14px;border-radius:8px;",
    "opacity:0;pointer-events:none;transition:opacity .18s;max-width:88vw;text-align:center}",
    ".dbr-toast.show{opacity:1}",
    "@media (max-width:520px){.dbr-qr-box{width:148px;height:148px}.dbr-kv{grid-template-columns:72px minmax(0,1fr)}}"
  ].join("");

  function injectCss() {
    if (document.getElementById("dbr-style")) return;
    var s = document.createElement("style");
    s.id = "dbr-style";
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function h(tag, attrs) {
    var el = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else if (k === "html") el.innerHTML = v;
      else if (k.slice(0, 2) === "on" && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
      else el.setAttribute(k, v === true ? "" : String(v));
    });
    for (var i = 2; i < arguments.length; i += 1) {
      var c = arguments[i];
      if (c === null || c === undefined || c === false) continue;
      if (Array.isArray(c)) c.forEach(function (x) { if (x) el.appendChild(typeof x === "string" ? document.createTextNode(x) : x); });
      else el.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    }
    return el;
  }

  function api(path, opts) {
    opts = opts || {};
    var init = {
      method: opts.method || "GET",
      headers: { "content-type": "application/json", "x-devbridge-api": TOKEN },
    };
    if (opts.body) init.body = JSON.stringify(opts.body);
    return fetch(API + path, init).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) throw new Error(d.error || ("HTTP " + r.status));
        return d;
      });
    });
  }

  var toastTimer = null;
  function toast(msg) {
    var t = document.getElementById("dbr-toast");
    if (!t) {
      t = h("div", { class: "dbr-toast", id: "dbr-toast" });
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("show"); }, 2600);
  }

  function copy(text, label) {
    if (!text) return toast("暂无内容可复制");
    var done = function () { toast((label || "内容") + "已复制"); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallback(); });
    } else fallback();
    function fallback() {
      var ta = h("textarea", {});
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); done(); } catch (e) { toast("复制失败，请手动选中"); }
      document.body.removeChild(ta);
    }
  }

  var MASK = "••••••••••••••••••••";
  function field(label, value, opts) {
    opts = opts || {};
    var masked = !!opts.mask;
    var row = h("div", { class: "dbr-field" });
    row.dataset.value = value || "";
    row.dataset.shown = "0";
    var val = h("div", { class: "dbr-val", title: value || "", text: value ? (masked ? MASK : value) : "—" });
    row.appendChild(val);
    if (opts.copy) {
      row.appendChild(h("button", { class: "dbr-mini", type: "button", text: "复制", onclick: function () {
        copy(row.dataset.value, label);
      } }));
    }
    if (opts.toggle) {
      var btn = h("button", { class: "dbr-mini", type: "button", text: "显示", onclick: function () {
        var shown = row.dataset.shown !== "1";
        row.dataset.shown = shown ? "1" : "0";
        val.textContent = shown ? (row.dataset.value || "") : (masked ? MASK : (row.dataset.value || "—"));
        btn.textContent = shown ? "隐藏" : "显示";
      } });
      row.appendChild(btn);
    }
    return h("div", { class: "dbr-sec" }, h("div", { class: "dbr-sec-t" }, label, h("span")), row);
  }

  function section(title, content) {
    return h("div", { class: "dbr-sec" }, h("div", { class: "dbr-sec-t" }, title, h("span")), content);
  }

  function phaseInfo(s) {
    var t = s.tunnel || {};
    if (t.phase === "hosting" && t.tunnelUrl) return { cls: "on", text: "远控在线", dot: "on" };
    if (t.phase === "blocked") return { cls: "bad", text: "已受阻", dot: "bad" };
    if (t.phase === "checking" || t.phase === "hosting" || t.phase === "reconnecting") return { cls: "busy", text: "连接中", dot: "" };
    if (!s.enabled) return { cls: "", text: "已禁用", dot: "" };
    return { cls: "", text: "未开启", dot: "" };
  }

  /** 主面板。返回 unmount。 */
  function mount(host, opts) {
    injectCss();
    opts = opts || {};
    var S = { dead: false, busy: false, last: null, lastLog: 0, timer: null, qrFor: "" };
    var formFields = null;
    var badge = h("span", { class: "dbr-badge" }, h("i"), h("span", { text: "加载中" }));
    var refresh = h("button", { class: "dbr-mini", type: "button", text: "刷新", onclick: function () { load(); } });
    var head = h("div", { class: "dbr-head" },
      h("div", { class: "dbr-title", text: "华为云远控" }),
      h("div", { class: "dbr-grow" }), badge, refresh);

    var btnStart = h("button", { class: "dbr-btn primary", type: "button", text: "开启远控", onclick: function () { act("/api/start", "正在开启远控…"); } });
    var btnStop = h("button", { class: "dbr-btn", type: "button", text: "停止", onclick: function () { act("/api/stop", "正在停止…"); } });
    var btnRestart = h("button", { class: "dbr-btn", type: "button", text: "重启隧道", onclick: function () { act("/api/restart", "正在重启…"); } });
    var btnRotate = h("button", { class: "dbr-btn danger", type: "button", text: "重签令牌", onclick: function () {
      if (!window.confirm("重签后，旧的扫码链接和已登录的远端会话会立即失效。继续？")) return;
      act("/api/token/rotate", "正在重签…");
    } });
    var actions = h("div", { class: "dbr-actions" }, btnStart, btnStop, btnRestart, btnRotate);

    var hint = h("div", { class: "dbr-hint" });
    hint.style.display = "none";

    // 只给一个「完整 URL」：默认已带一次性令牌，复制即可用，不暴露裸公网地址。
    var urlField = field("远控 URL（含令牌）", "", { copy: true });
    var tokenField = field("访问令牌", "", { copy: true, toggle: true, mask: true });

    var qrBox = h("div", { class: "dbr-qr-box" }, h("div", { class: "dbr-qr-empty", text: "隧道开启后显示配对二维码" }));
    var qrInfo = h("div", { class: "dbr-qr-info" });
    var qrRow = h("div", { class: "dbr-qr" }, qrBox, qrInfo);

    var GUIDE_HTML = [
      "<summary>首次使用：注册华为云账号 · 开通 DevBridge · 两种登录方式</summary>",
      "<div><ol>",
      "<li>注册华为云账号并完成实名认证：<a href=\"https://www.huaweicloud.com/\" target=\"_blank\" rel=\"noopener\">huaweicloud.com</a>。",
      "DevBridge 是开发者空间提供的免费开发隧道，无需买服务器或公网 IP。</li>",
      "<li>打开<a href=\"https://devstation.connect.huaweicloud.com/space/devbridge\" target=\"_blank\" rel=\"noopener\">开发者隧道 DevBridge</a>页面，用刚注册的账号登录，即可开通。</li>",
      "<li>在本机安装 CLI（v0.2.x）：<code>sh scripts/install-cli.sh</code>。旧版 v0.1.x 的域名已停用，必须升级后重建隧道。</li>",
      "<li><b>方式 A · 浏览器登录（最省事）：</b><code>devbridge auth login</code>，会自动打开浏览器用华为云账号登录，适合日常手动使用。</li>",
      "<li><b>方式 B · API Key（适合无人值守 / 自动重连）：</b>在<a href=\"https://devstation.connect.huaweicloud.com/space/devbridge/apikey\" target=\"_blank\" rel=\"noopener\">API Key 管理页</a>创建密钥（<b>只完整显示一次，当场保存</b>），然后 <code>export HW_API_KEY='粘贴你的密钥'</code> 并执行 <code>devbridge auth login --api-key \"$HW_API_KEY\"</code>。</li>",
      "<li>跑 <code>npm run doctor</code> 体检；面板若显示 <code>auth-required</code>，就是还没登录。v0.2.x 已移除 AK/SK 登录，只能用上面两种方式。</li>",
      "</ol></div>",
    ].join("");
    var guideSec = section("开通指引", h("details", { class: "dbr-guide", html: GUIDE_HTML }));

    var launchHint = h("div", { class: "dbr-hint" });
    launchHint.style.display = "none";
    var launchInput = h("input", { type: "text", placeholder: "http://127.0.0.1:3080/?token=..." });
    var launchRow = h("div", { class: "dbr-field" }, launchInput);
    launchRow.appendChild(h("button", { class: "dbr-mini", type: "button", text: "保存并重新兑换", onclick: function () { saveLaunch(); } }));
    var launchSec = section("DSH 会话兑换", launchHint, launchRow,
      h("div", { class: "dbr-note", text: "DSH 桌面端常把启动令牌只放在内存里。若扫码后主界面仍提示 authentication required，把终端里 dsh web 打印的完整链接粘到这里保存一次即可（只存本机）。" }));

    var kv = h("dl", { class: "dbr-kv" });
    var logs = h("div", { class: "dbr-logs" });
    var form = buildForm();

    var body = h("div", { class: "dbr-body" },
      section("控制", actions),
      hint,
      guideSec,
      section("连接", urlField, tokenField),
      section("扫码配对", qrRow),
      launchSec,
      section("运行状态", kv),
      section("配置", form),
      section("最近日志", logs),
      h("div", { class: "dbr-note", text: "安全提示：扫码链接内含访问令牌，等同远控权限，勿转发给他人。DevBridge 隧道侧默认允许匿名，真正的门禁由插件内置网关承担；停止远控会立即断开公网入口。" })
    );
    var root = h("div", { class: "dbr-root" }, head, body);
    host.appendChild(root);

    function setField(container, value, masked) {
      var row = container.querySelector(".dbr-field");
      var v = container.querySelector(".dbr-val");
      if (!row || !v) return;
      row.dataset.value = value || "";
      var revealed = row.dataset.shown === "1";
      v.textContent = value ? (masked && !revealed ? MASK : value) : "—";
      v.title = value || "";
      var toggle = container.querySelectorAll("button");
      if (toggle.length > 1 && revealed) toggle[1].textContent = "隐藏";
    }

    function act(path, label) {
      if (S.busy) return;
      S.busy = true;
      toast(label);
      setBusy(true);
      api(path, { method: "POST" })
        .then(function () { toast("完成"); return load(); })
        .catch(function (e) { toast("失败：" + e.message); return load(); })
        .then(function () { S.busy = false; setBusy(false); });
    }

    function setBusy(on) {
      [btnStart, btnStop, btnRestart, btnRotate].forEach(function (b) { b.disabled = on; });
    }

    function saveLaunch() {
      var value = launchInput.value.trim();
      if (!value) return toast("请先粘贴完整的 DSH 启动链接");
      api("/api/launch-url", { method: "POST", body: { url: value } })
        .then(function (d) { toast(d.note || "已保存"); launchInput.value = ""; return load(); })
        .catch(function (e) { toast("保存失败：" + e.message); });
    }

    function paint(s) {
      S.last = s;
      var p = phaseInfo(s);
      badge.className = "dbr-badge " + p.cls;
      badge.lastChild.textContent = p.text;
      var t = s.tunnel || {};
      btnStart.disabled = S.busy || (t.phase === "hosting" && !!t.tunnelUrl);
      btnStop.disabled = S.busy || (!t.pid && t.phase !== "blocked");

      setField(urlField, s.pairingUrl, false);
      setField(tokenField, s.accessToken, true);

      if (s.blockerHelp) {
        hint.style.display = "";
        hint.textContent = s.blockerHelp;
        if (t.blocker === "auth-required" || t.blocker === "cli-missing") {
          var cmd = h("div", { style: "margin-top:7px" },
            h("code", { text: t.blocker === "auth-required" ? "devbridge auth login" : "node scripts/doctor.mjs" }),
            h("button", { class: "dbr-mini", type: "button", style: "margin-left:8px", text: "复制命令", onclick: function () {
              copy(t.blocker === "auth-required" ? "devbridge auth login" : "node scripts/doctor.mjs", "命令");
            } })
          );
          hint.appendChild(cmd);
        }
      } else hint.style.display = "none";

      if (s.launchHelp && s.tunnelUrl) {
        launchHint.style.display = "";
        launchHint.textContent = s.launchHelp;
      } else launchHint.style.display = "none";

      var rows = [
        ["状态", p.text + (t.blocker ? " · " + t.blocker : "")],
        ["隧道 ID", t.tunnelId || "—"],
        ["隧道名", t.tunnelName || "—"],
        ["CLI", (t.cliVersion || "未检测") + (t.authenticated ? " · 已登录" : "")],
        ["网关", s.gate && s.gate.running ? s.gate.host + ":" + s.gate.port : "未运行"],
        ["上游 DSH", (s.gate && s.gate.upstream) || "—"],
        ["host PID", t.pid || "—"],
        ["请求数", s.gate && s.gate.stats ? String(s.gate.stats.requests) : "0"],
        ["DSH 会话", s.launchExchange && s.launchExchange.ok ? "已兑换" : "未兑换（" + ((s.launchExchange && s.launchExchange.error) || "未知") + "）"],
        ["令牌来源", s.launchTokenSource || "—"],
        ["有效期", (s.config && s.config.tunnelExpirationHours) + " 小时"],
        ["匿名访问", s.config && s.config.allowAnonymous ? "允许（由网关鉴权）" : "拒绝"],
      ];
      kv.textContent = "";
      rows.forEach(function (r) {
        kv.appendChild(h("dt", { text: r[0] }));
        kv.appendChild(h("dd", { text: r[1] }));
      });

      qrInfo.textContent = "";
      if (s.pairingUrl) {
        qrInfo.appendChild(h("div", { text: "用手机相机或微信扫一扫，即可打开本机 DSH。二维码与上方 URL 都已带一次性令牌，无需再输密码。" }));
        qrInfo.appendChild(h("button", { class: "dbr-mini", type: "button", text: "复制 URL", onclick: function () { copy(s.pairingUrl, "远控 URL"); } }));
        qrInfo.appendChild(h("div", { class: "dbr-note", text: "若页面能打开但接口 403，说明浏览器未换到 DSH 会话，点面板里的「重启隧道」或重新扫码。" }));
        if (S.qrFor !== s.pairingUrl) {
          S.qrFor = s.pairingUrl;
          api("/api/qr").then(function (d) {
            if (S.dead || S.qrFor !== s.pairingUrl || !d.svg) return;
            // 直接放 SVG：外层再套 div 会让 CSS 的 100% 尺寸解析失准。
            qrBox.innerHTML = d.svg;
          }).catch(function () { /* 状态轮询会重试 */ });
        }
      } else {
        S.qrFor = "";
        qrBox.textContent = "";
        qrBox.appendChild(h("div", { class: "dbr-qr-empty", text: "隧道开启并拿到公网地址后显示二维码" }));
        qrInfo.appendChild(h("div", { text: "点上方「开启远控」，插件会自动创建华为云 DevBridge 隧道、绑定网关端口并启动 host 进程。" }));
      }
      fillForm(s.config || {});
    }

    function loadLogs() {
      return api("/api/logs?since=" + S.lastLog).then(function (d) {
        if (S.dead || !d.entries) return;
        d.entries.forEach(function (e) {
          S.lastLog = Math.max(S.lastLog, e.at);
          var time = new Date(e.at).toLocaleTimeString("zh-CN", { hour12: false });
          logs.appendChild(h("div", { class: "dbr-log " + e.level },
            h("time", { text: time }), e.text));
        });
        while (logs.childNodes.length > 120) logs.removeChild(logs.firstChild);
        logs.scrollTop = logs.scrollHeight;
      }).catch(function () { /* noop */ });
    }

    function load() {
      return api("/api/status").then(function (s) {
        if (S.dead) return;
        paint(s);
        return loadLogs();
      }).catch(function (e) {
        if (S.dead) return;
        badge.className = "dbr-badge bad";
        badge.lastChild.textContent = "控制面不可达";
        hint.style.display = "";
        hint.textContent = "无法读取插件状态：" + e.message + "。请确认插件已安装并重启过 DSH。";
      });
    }

    function buildForm() {
      var f = {
        autoStart: h("input", { type: "checkbox" }),
        allowAnonymous: h("input", { type: "checkbox" }),
        reconnect: h("input", { type: "checkbox" }),
        gatePort: h("input", { type: "number", min: "1", max: "65535" }),
        tunnelName: h("input", { type: "text" }),
        tunnelExpirationHours: h("input", { type: "number", min: "1", max: "720" }),
        devbridgeBin: h("input", { type: "text", placeholder: "留空自动查找" }),
      };
      var wrap = h("div", { class: "dbr-form" },
        h("label", { class: "chk" }, f.autoStart, "DSH 启动后自动开启远控"),
        h("label", { class: "chk" }, f.allowAnonymous, "隧道允许匿名（网关仍鉴权）"),
        h("label", { class: "chk" }, f.reconnect, "断线自动重连"),
        h("label", {}, "网关端口", f.gatePort),
        h("label", {}, "隧道名", f.tunnelName),
        h("label", {}, "有效期（小时）", f.tunnelExpirationHours),
        h("label", {}, "devbridge 路径", f.devbridgeBin)
      );
      var save = h("button", { class: "dbr-btn", type: "button", text: "保存配置", style: "margin-top:9px", onclick: function () {
        var patch = {
          autoStart: f.autoStart.checked,
          allowAnonymous: f.allowAnonymous.checked,
          reconnect: f.reconnect.checked,
          gatePort: Number(f.gatePort.value),
          tunnelName: f.tunnelName.value.trim(),
          tunnelExpirationHours: Number(f.tunnelExpirationHours.value),
          devbridgeBin: f.devbridgeBin.value.trim(),
        };
        api("/api/config", { method: "POST", body: patch })
          .then(function (d) { toast(d.note || "已保存"); })
          .catch(function (e) { toast("保存失败：" + e.message); });
      } });
      formFields = f;
      return h("div", {}, wrap, save);
    }

    function fillForm(c) {
      if (!formFields || !form) return;
      var f = formFields;
      if (document.activeElement && form.contains(document.activeElement)) return;
      f.autoStart.checked = !!c.autoStart;
      f.allowAnonymous.checked = c.allowAnonymous !== false;
      f.reconnect.checked = c.reconnect !== false;
      f.gatePort.value = c.gatePort || 3081;
      f.tunnelName.value = c.tunnelName || "";
      f.tunnelExpirationHours.value = c.tunnelExpirationHours || 72;
      f.devbridgeBin.value = c.devbridgeBin || "";
    }

    load();
    S.timer = setInterval(load, 5000);
    return function unmount() {
      S.dead = true;
      clearInterval(S.timer);
      if (root.parentNode) root.parentNode.removeChild(root);
    };
  }

  /** 侧边栏席位：点开一个自包含的浮层，不依赖右侧栏服务。 */
  function mountSeat(host, opts) {
    injectCss();
    opts = opts || {};
    var S = { dead: false, timer: null, modal: null };
    var dot = h("span", { class: "dbr-seat-dot" });
    var label = h("span", { class: "dbr-seat-label", text: "华为云远控" });
    var seat = h("button", { class: "dbr-seat", type: "button", title: "华为云 DevBridge 远控" }, dot, label);
    var root = h("div", { class: "dbr-root", style: "height:auto;background:transparent" }, seat);
    host.appendChild(root);

    function open() {
      if (S.modal) return;
      var card = h("div", { class: "dbr-modal-card" });
      var modal = h("div", { class: "dbr-modal", onclick: function (e) { if (e.target === modal) close(); } }, card);
      var closeBtn = h("button", { class: "dbr-mini", type: "button", text: "关闭", onclick: close });
      function close() {
        if (S.modal) { S.modal.remove(); S.modal = null; }
        document.removeEventListener("keydown", onKey);
      }
      function onKey(e) { if (e.key === "Escape") close(); }
      mount(card, {});
      // 把关闭按钮塞进面板头部
      var head = card.querySelector(".dbr-head");
      if (head) head.appendChild(closeBtn);
      document.addEventListener("keydown", onKey);
      document.body.appendChild(modal);
      S.modal = modal;
    }

    seat.addEventListener("click", open);

    function load() {
      return api("/api/status").then(function (s) {
        if (S.dead) return;
        var t = s.tunnel || {};
        dot.className = "dbr-seat-dot" + (t.phase === "hosting" && t.tunnelUrl ? " on" : t.phase === "blocked" ? " bad" : "");
        label.textContent = t.phase === "hosting" && t.tunnelUrl ? "华为云远控 · 在线" : "华为云远控";
      }).catch(function () { if (!S.dead) label.textContent = "华为云远控（未就绪）"; });
    }
    load();
    S.timer = setInterval(load, 20000);
    return function unmount() {
      S.dead = true;
      clearInterval(S.timer);
      if (S.modal) S.modal.remove();
      if (root.parentNode) root.parentNode.removeChild(root);
    };
  }

  window.DevBridgePanel = {
    mount: mount,
    mountDock: mount,
    mountSeat: mountSeat,
    apiBase: API,
  };
})();
