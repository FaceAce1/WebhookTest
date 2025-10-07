// --- 配置区 ---
const DEFAULT_LOG_DAYS = 1;      // 默认日志保留1天
const DEFAULT_ENDPOINT_DAYS = 7; // 默认终结点保留7天


export default {
  /**
   * 主入口点，处理 HTTP 请求
   */
  async fetch(request, env, ctx) {
    // ... (此部分无变化) ...
    const url = new URL(request.url);
    const path = url.pathname;
    if (path === '/') return getHomepage(request, env);
    if (path === '/api/endpoint' && request.method === 'POST') return createEndpoint(request, env);
    if (path.startsWith('/api/requests/')) {
        const endpointId = path.split('/')[3];
        return getRequests(endpointId, env);
    }
    if (path.startsWith('/inspect/')) return handleInspect(request, env);
    return new Response('Not Found', { status: 404 });
  },

  /**
   * Cron 触发器入口点，处理定时任务
   */
  async scheduled(event, env, ctx) {
    console.log("开始执行每日数据清理任务...");
    ctx.waitUntil(cleanupDatabase(env));
  }
};


// --- 自动化清理逻辑 ---
async function cleanupDatabase(env) {
    // ... (此部分无变化) ...
    const logRetentionDays = env.LOG_DAYS || DEFAULT_LOG_DAYS;
    const endpointRetentionDays = env.ENDPOINT_DAYS || DEFAULT_ENDPOINT_DAYS;
    try {
        const logCutoffDate = new Date(Date.now() - logRetentionDays * 24 * 60 * 60 * 1000).toISOString();
        console.log(`正在清理 ${logRetentionDays} 天前的日志 (即 ${logCutoffDate} 之前)`);
        const { success, meta } = await env.DB.prepare(`DELETE FROM received_requests WHERE timestamp < ?`).bind(logCutoffDate).run();
        if (success) console.log(`日志清理成功！删除了 ${meta.changes} 条旧日志。`);
    } catch (e) { console.error("清理日志时出错:", e.message); }
    try {
        const endpointCutoffDate = new Date(Date.now() - endpointRetentionDays * 24 * 60 * 60 * 1000).toISOString();
        console.log(`正在清理 ${endpointRetentionDays} 天前的终结点 (即 ${endpointCutoffDate} 之前)`);
        const { success, meta } = await env.DB.prepare(`DELETE FROM endpoints WHERE created_at < ?`).bind(endpointCutoffDate).run();
        if (success) console.log(`终结点清理成功！删除了 ${meta.changes} 个旧终结点及其关联的所有日志。`);
    } catch(e) { console.error("清理终结点时出错:", e.message); }
}


// --- API 后端逻辑 ---
// ... (createEndpoint, getRequests, handleInspect, sha256, generateSecretToken 等函数均无变化) ...
async function createEndpoint(request, env) { if (!env.DB) { return new Response("D1 Database not bound. Please check your Worker's settings.", { status: 500 }); } const endpointId = crypto.randomUUID(); const rawToken = generateSecretToken(); const tokenHash = await sha256(rawToken); try { await env.DB.prepare( 'INSERT INTO endpoints (id, token_hash, created_at) VALUES (?, ?, ?)' ) .bind(endpointId, tokenHash, new Date().toISOString()) .run(); const response = { id: endpointId, token: rawToken, }; return new Response(JSON.stringify(response), { headers: { 'Content-Type': 'application/json' }, }); } catch (e) { console.error(e); return new Response("Database error: " + e.message, { status: 500 }); } }
async function getRequests(endpointId, env) { if (!endpointId) { return new Response('Endpoint ID is required', { status: 400 }); } const { results } = await env.DB.prepare( 'SELECT * FROM received_requests WHERE endpoint_id = ? ORDER BY timestamp DESC LIMIT 50' ) .bind(endpointId) .all(); return new Response(JSON.stringify(results || []), { headers: { 'Content-Type': 'application/json' }, }); }
async function handleInspect(request, env) { const url = new URL(request.url); const endpointId = url.pathname.split('/')[2]; const endpoint = await env.DB.prepare('SELECT token_hash FROM endpoints WHERE id = ?') .bind(endpointId) .first(); if (!endpoint) { return new Response(JSON.stringify({ success: false, message: 'Endpoint not found.' }), { status: 404, headers: { 'Content-Type': 'application/json' }, }); } const authHeader = request.headers.get('Authorization') || ''; const receivedToken = authHeader.replace(/^Bearer\s/, ''); const receivedTokenHash = await sha256(receivedToken); const isTokenValid = receivedTokenHash === endpoint.token_hash; const requestBody = await request.text(); const headers = {}; for(let [key, value] of request.headers.entries()) { headers[key] = value; } await env.DB.prepare( `INSERT INTO received_requests (endpoint_id, timestamp, method, headers, body, ip_address, is_token_valid) VALUES (?, ?, ?, ?, ?, ?, ?)` ) .bind( endpointId, new Date().toISOString(), request.method, JSON.stringify(headers, null, 2), requestBody, request.headers.get('cf-connecting-ip') || 'N/A', isTokenValid ? 1 : 0 ) .run(); if (!isTokenValid) { return new Response(JSON.stringify({ success: false, message: 'Invalid token.' }), { status: 401, headers: { 'Content-Type': 'application/json' }, }); } return new Response(JSON.stringify({ success: true, message: 'Request logged successfully.' }), { headers: { 'Content-Type': 'application/json' }, }); }
async function sha256(string) { const utf8 = new TextEncoder().encode(string); const hashBuffer = await crypto.subtle.digest('SHA-256', utf8); const hashArray = Array.from(new Uint8Array(hashBuffer)); const hashHex = hashArray.map((bytes) => bytes.toString(16).padStart(2, '0')).join(''); return hashHex; }
function generateSecretToken() { const array = new Uint8Array(24); crypto.getRandomValues(array); return Array.from(array, byte => ('0' + byte.toString(16)).slice(-2)).join(''); }


// --- 前端 HTML, CSS, JS ---
// --- 唯一有修改的地方在 getHomepage 函数内部 ---
function getHomepage(request, env) {
  const html = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Webhook 请求接收与验证工具</title>
    <style>
        :root { --accent-color: #007bff; --bg-color: #f8f9fa; --text-color: #212529; --border-color: #dee2e6; --card-bg: #fff; --invalid-bg: #fff3f3; }
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; margin: 0; background-color: var(--bg-color); color: var(--text-color); line-height: 1.6; }
        .container { max-width: 900px; margin: 2rem auto; padding: 1rem; }
        header h1 { font-size: 2rem; color: var(--accent-color); text-align: center; margin-bottom: 0.5rem; }
        header p { text-align: center; margin-top: 0; color: #6c757d; }
        .card { background-color: var(--card-bg); border: 1px solid var(--border-color); border-radius: 8px; padding: 1.5rem; margin-bottom: 2rem; box-shadow: 0 2px 4px rgba(0,0,0,0.05); }
        .endpoint-info { display: flex; flex-direction: column; gap: 1rem; }
        .endpoint-info .url-group, .endpoint-info .token-group { display: flex; align-items: center; border: 1px solid var(--border-color); border-radius: 6px; }
        .endpoint-info input { flex-grow: 1; padding: 0.75rem; border: none; background: transparent; font-family: monospace; font-size: 1rem; }
        .endpoint-info button { padding: 0.75rem 1rem; border: none; background-color: var(--accent-color); color: white; cursor: pointer; border-radius: 0 5px 5px 0; white-space: nowrap; }
        .endpoint-info button:hover { opacity: 0.9; }
        .endpoint-info .label { padding: 0.75rem; background: #f1f3f5; border-right: 1px solid var(--border-color); white-space: nowrap; font-weight: 500;}
        .instruction { font-size: 0.9rem; color: #495057; background-color: #e9ecef; padding: 1rem; border-radius: 6px; }
        
        /* --- 新增/修改样式 --- */
        .log-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; }
        .log-header h2 { margin: 0; }
        .log-controls { display: flex; align-items: center; gap: 1rem; }
        .log-controls #manualRefreshBtn { padding: 0.4rem 0.8rem; background-color: #6c757d; color: white; border: none; border-radius: 5px; cursor: pointer; }
        .log-controls #manualRefreshBtn:hover { background-color: #5a6268; }
        .log-controls .hidden { display: none; }
        .switch { position: relative; display: inline-block; width: 50px; height: 28px; }
        .switch input { opacity: 0; width: 0; height: 0; }
        .slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: #ccc; transition: .4s; border-radius: 28px; }
        .slider:before { position: absolute; content: ""; height: 20px; width: 20px; left: 4px; bottom: 4px; background-color: white; transition: .4s; border-radius: 50%; }
        input:checked + .slider { background-color: var(--accent-color); }
        input:checked + .slider:before { transform: translateX(22px); }
        .switch-label { user-select: none; }
        /* --- 结束 --- */

        #requests-log { min-height: 100px; display: flex; flex-direction: column; align-items: stretch; justify-content: center; color: #6c757d; }
        #requests-log .placeholder { text-align: center; padding: 1rem; }
        .request-item { border: 1px solid var(--border-color); border-radius: 6px; margin-bottom: 1rem; background: var(--card-bg); transition: box-shadow 0.2s; }
        .request-item.invalid { background-color: var(--invalid-bg); border-color: #f5c6cb;}
        .request-header { padding: 1rem; cursor: pointer; display: flex; justify-content: space-between; align-items: center; }
        .request-header:hover { background-color: #f1f3f5; }
        .request-details { padding: 0 1rem; max-height: 0; overflow: hidden; transition: max-height 0.3s ease-out, padding 0.3s ease-out; }
        .request-details.open { max-height: 1000px; padding-bottom: 1rem; }
        pre { background: #212529; color: #f8f9fa; padding: 1rem; border-radius: 4px; white-space: pre-wrap; word-break: break-all; font-family: monospace; }
        .method { font-weight: bold; padding: 0.2rem 0.5rem; border-radius: 4px; color: white; }
        .method-POST { background-color: #28a745; }
        .method-GET { background-color: #007bff; }
        .method-PUT { background-color: #ffc107; color: #212529; }
        .method-DELETE { background-color: #dc3545; }
        .status { padding: 0.2rem 0.5rem; border-radius: 4px; font-weight: bold; }
        .status-valid { background-color: #d4edda; color: #155724; border: 1px solid #c3e6cb; }
        .status-invalid { background-color: #f8d7da; color: #721c24; border: 1px solid #f5c6cb; }
        footer { text-align: center; margin-top: 2rem; padding: 1rem; color: #6c757d; font-size: 0.9rem; }
    </style>
</head>
<body>
    <div class="container">
        <header><h1>Webhook 测试工具</h1><p>生成一个临时终结点来捕获和检查 HTTP 请求。</p></header>
        <section class="card">
            <h2>你的专属测试终结点</h2>
            <div class="endpoint-info">
                <div class="url-group"><span class="label">URL</span><input type="text" id="endpointUrl" readonly value="正在生成..."><button onclick="copyToClipboard('endpointUrl', this)">复制</button></div>
                <div class="token-group"><span class="label">Token</span><input type="text" id="endpointToken" readonly value="正在生成..."><button onclick="copyToClipboard('endpointToken', this)">复制</button></div>
            </div><br>
            <div class="instruction"><strong>使用方法：</strong>向以上 URL 发送任意类型的 HTTP 请求。请在请求头 (Header) 中包含以下认证信息：<br><code>Authorization: Bearer &lt;你的Token&gt;</code></div>
        </section>
        <section>
            <div class="log-header">
                <h2>接收到的请求日志 (<span id="request-count">0</span>)</h2>
                <div class="log-controls">
                    <button id="manualRefreshBtn">手动刷新</button>
                    <label class="switch" title="切换自动刷新">
                        <input type="checkbox" id="autoRefreshToggle">
                        <span class="slider"></span>
                    </label>
                    <span class="switch-label">自动刷新</span>
                </div>
            </div>
            <div id="requests-log"><p class="placeholder">等待接收请求...</p></div>
        </section>
        <footer><p>由 Cloudflare Worker & D1 强力驱动</p></footer>
    </div>
    <script>
        let endpointId = null;
        let pollingInterval = null;
        // --- 新增状态变量 ---
        let isAutoRefreshEnabled = false;

        document.addEventListener('DOMContentLoaded', async () => {
            try {
                // ... (此部分代码无变化) ...
                const response = await fetch('/api/endpoint', { method: 'POST' });
                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error('生成终结点失败: ' + errorText);
                }
                const data = await response.json();
                endpointId = data.id;
                const urlInput = document.getElementById('endpointUrl');
                const tokenInput = document.getElementById('endpointToken');
                const baseUrl = window.location.origin;
                urlInput.value = \`\${baseUrl}/inspect/\${endpointId}\`;
                tokenInput.value = data.token;
                
                // --- 逻辑修改 ---
                // 页面加载时，不再自动开启任何轮询，只获取一次初始数据
                fetchRequests();
                
                // 设置新控件的事件监听
                setupControls();

            } catch (error) {
                console.error(error);
                document.getElementById('endpointUrl').value = '生成失败，请检查配置。';
                document.getElementById('endpointToken').value = error.message;
            }
        });
        
        // 可见性事件监听保持不变
        document.addEventListener('visibilitychange', handleVisibilityChange);

        function handleVisibilityChange() {
          // 只有在自动刷新开启时，才响应页面可见性变化
          if (!isAutoRefreshEnabled) return;

          if (document.hidden) {
            stopPolling();
          } else {
            startPolling();
          }
        }

        // --- 新增：控件初始化函数 ---
        function setupControls() {
            const autoRefreshToggle = document.getElementById('autoRefreshToggle');
            const manualRefreshBtn = document.getElementById('manualRefreshBtn');

            // 手动刷新按钮的点击事件
            manualRefreshBtn.addEventListener('click', () => {
                // 添加一个简单的加载中效果
                const originalText = manualRefreshBtn.textContent;
                manualRefreshBtn.textContent = '正在获取...';
                manualRefreshBtn.disabled = true;
                fetchRequests().finally(() => {
                    manualRefreshBtn.textContent = originalText;
                    manualRefreshBtn.disabled = false;
                });
            });

            // 自动刷新开关的 change 事件
            autoRefreshToggle.addEventListener('change', (event) => {
                isAutoRefreshEnabled = event.target.checked;
                manualRefreshBtn.classList.toggle('hidden', isAutoRefreshEnabled);

                if (isAutoRefreshEnabled) {
                    // 如果开启自动刷新，则触发一次可见性检查，如果页面可见就会立即开始轮询
                    handleVisibilityChange();
                } else {
                    // 如果关闭，则立即停止轮询
                    stopPolling();
                }
            });
        }

        function startPolling() {
            // 只有在自动刷新开启时才执行
            if (!isAutoRefreshEnabled) return;
            if (pollingInterval) clearInterval(pollingInterval);
            
            fetchRequests();
            pollingInterval = setInterval(fetchRequests, 3000);
        }

        function stopPolling() {
            clearInterval(pollingInterval);
            pollingInterval = null;
        }
        
        // --- fetchRequests 函数及之后的所有代码均无变化 ---
        async function fetchRequests() {
            if (!endpointId) return;
            const response = await fetch(\`/api/requests/\${endpointId}\`);
            const requests = await response.json();
            const logContainer = document.getElementById('requests-log');
            const placeholder = logContainer.querySelector('.placeholder');
            document.getElementById('request-count').textContent = requests.length;
            if (requests.length === 0 && !placeholder) {
                 logContainer.innerHTML = '<p class="placeholder">等待接收请求...</p>';
                 return;
            }
            if (requests.length > 0 && placeholder) {
                placeholder.remove();
            }
            const newRequestIds = new Set(requests.map(req => req.id));
            const existingItems = logContainer.querySelectorAll('.request-item');
            existingItems.forEach(item => {
                const itemId = parseInt(item.dataset.id, 10);
                if (!newRequestIds.has(itemId)) {
                    item.remove();
                }
            });
            requests.reverse().forEach(req => {
                if (!document.querySelector(\`.request-item[data-id="\${req.id}"]\`)) {
                    const requestEl = createRequestElement(req);
                    logContainer.prepend(requestEl);
                }
            });
        }
        function createRequestElement(req) {
            const requestEl = document.createElement('div');
            requestEl.className = 'request-item';
            requestEl.dataset.id = req.id;
            if (!req.is_token_valid) {
                requestEl.classList.add('invalid');
            }
            const methodClass = \`method-\${req.method.toUpperCase()}\`;
            const validityStatus = req.is_token_valid
                ? '<span class="status status-valid">Token 有效</span>'
                : '<span class="status status-invalid">Token 无效</span>';
            let bodyContent = '无请求体';
            if (req.body) {
                try {
                    const jsonObj = JSON.parse(req.body);
                    bodyContent = JSON.stringify(jsonObj, null, 2);
                } catch (e) {
                    bodyContent = req.body;
                }
            }
            requestEl.innerHTML = \`
                <div class="request-header">
                    <div><span class="method \${methodClass}">\${req.method}</span><span>来自 IP: \${req.ip_address}</span></div>
                    <div>\${validityStatus}<span style="font-size: 0.9em; color: #6c757d;">\${new Date(req.timestamp).toLocaleString()}</span></div>
                </div>
                <div class="request-details">
                    <h4>请求头 (Headers)</h4><pre><code>\${escapeHtml(req.headers)}</code></pre>
                    <h4>请求体 (Body)</h4><pre><code>\${escapeHtml(bodyContent)}</code></pre>
                </div>
            \`;
            const header = requestEl.querySelector('.request-header');
            const details = requestEl.querySelector('.request-details');
            header.addEventListener('click', () => { details.classList.toggle('open'); });
            return requestEl;
        }
        function copyToClipboard(elementId, button) { navigator.clipboard.writeText(document.getElementById(elementId).value).then(() => { const originalText = button.textContent; button.textContent = '已复制!'; setTimeout(() => { button.textContent = originalText; }, 2000); }); }
        function escapeHtml(unsafe) { return unsafe.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;"); }
    </script>
</body>
</html>
  `;
  return new Response(html, { headers: { 'Content-Type': 'text/html;charset=utf-8' } });
}
