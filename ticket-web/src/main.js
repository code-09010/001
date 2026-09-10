import './style.css';

const API = '/api';

const STATUS_FLOW = ['received', 'repairing', 'ready', 'picked_up'];
const STATUS_LABELS = {
  received: '已收',
  repairing: '修补中',
  ready: '可取',
  picked_up: '已取走',
};

const state = {
  tickets: [],
  filter: '',
  search: '',
};

const els = {
  form: document.querySelector('#create-form'),
  description: document.querySelector('#description'),
  problem: document.querySelector('#problem'),
  expectedPickup: document.querySelector('#expected-pickup'),
  createError: document.querySelector('#create-error'),
  slip: document.querySelector('#slip'),
  slipCode: document.querySelector('#slip-code'),
  slipMeta: document.querySelector('#slip-meta'),
  slipClose: document.querySelector('#slip-close'),
  list: document.querySelector('#ticket-list'),
  listHint: document.querySelector('#list-hint'),
  search: document.querySelector('#search'),
  filters: document.querySelector('#filters'),
};

async function api(path, options) {
  const res = await fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `请求失败（${res.status}）`);
  return data;
}

function formatDate(value) {
  if (!value) return '取件日未定';
  const [y, m, d] = String(value).slice(0, 10).split('-');
  return `预计 ${y}年${Number(m)}月${Number(d)}日 取`;
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[ch]);
}

function renderTicket(ticket) {
  const idx = STATUS_FLOW.indexOf(ticket.status);
  const nextActions = STATUS_FLOW.slice(idx + 1)
    .map(
      (s) => `
        <button class="btn small ${s === 'ready' ? 'warn' : ''}" data-action="${s}" data-code="${ticket.code}">
          改为${STATUS_LABELS[s]}
        </button>`,
    )
    .join('');

  const readyClass = ticket.status === 'ready' ? ' ready' : '';
  const doneClass = ticket.status === 'picked_up' ? ' done' : '';

  return `
    <article class="ticket${readyClass}${doneClass}" data-code="${ticket.code}">
      <div class="ticket-main">
        <span class="code">${ticket.code}</span>
        <div class="ticket-info">
          <p class="desc">${escapeHtml(ticket.description)}</p>
          ${ticket.problem ? `<p class="problem">毛病：${escapeHtml(ticket.problem)}</p>` : ''}
          <p class="meta">${formatDate(ticket.expectedPickup)}</p>
        </div>
      </div>
      <div class="ticket-side">
        <span class="badge ${ticket.status}">${STATUS_LABELS[ticket.status]}</span>
        ${ticket.status === 'ready' ? '<span class="ready-tag">可以给客人了</span>' : ''}
        <div class="actions">${nextActions}</div>
      </div>
    </article>`;
}

function render() {
  const keyword = state.search.trim();
  const shown = state.tickets.filter((t) => {
    if (state.filter && t.status !== state.filter) return false;
    if (keyword && !t.code.includes(keyword)) return false;
    return true;
  });

  if (state.tickets.length === 0) {
    els.list.innerHTML = '<p class="hint">还没有工单，先在左边登记一双吧。</p>';
    return;
  }
  if (shown.length === 0) {
    els.list.innerHTML = '<p class="hint">没有符合条件的工单。</p>';
    return;
  }
  els.list.innerHTML = shown.map(renderTicket).join('');
}

async function loadTickets() {
  els.listHint.textContent = '加载中…';
  try {
    state.tickets = await api('/tickets');
    render();
  } catch (err) {
    els.list.innerHTML = `<p class="error">${escapeHtml(err.message)}，请确认接口已启动。</p>`;
  }
}

// 登记新单
els.form.addEventListener('submit', async (e) => {
  e.preventDefault();
  els.createError.hidden = true;
  try {
    const ticket = await api('/tickets', {
      method: 'POST',
      body: JSON.stringify({
        description: els.description.value,
        problem: els.problem.value,
        expectedPickup: els.expectedPickup.value || null,
      }),
    });
    els.slipCode.textContent = ticket.code;
    els.slipMeta.textContent = formatDate(ticket.expectedPickup);
    els.slip.hidden = false;
    els.form.hidden = true;
    els.form.reset();
    loadTickets();
  } catch (err) {
    els.createError.textContent = err.message;
    els.createError.hidden = false;
  }
});

els.slipClose.addEventListener('click', () => {
  els.slip.hidden = true;
  els.form.hidden = false;
  els.description.focus();
});

// 状态过滤
els.filters.addEventListener('click', (e) => {
  const btn = e.target.closest('.chip');
  if (!btn) return;
  els.filters.querySelectorAll('.chip').forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
  state.filter = btn.dataset.status;
  render();
});

// 按码搜索
els.search.addEventListener('input', () => {
  els.search.value = els.search.value.replace(/\D/g, '').slice(0, 4);
  state.search = els.search.value;
  render();
});

// 推进状态（事件委托）
els.list.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const { code, action } = btn.dataset;
  btn.disabled = true;
  try {
    await api(`/tickets/${code}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: action }),
    });
    // 重新拉取：可取的单会被服务端排到最前
    await loadTickets();
  } catch (err) {
    alert(err.message);
    btn.disabled = false;
  }
});

loadTickets();
