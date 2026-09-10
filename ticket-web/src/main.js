import './style.css';

const API = '/api';
const PAGE_SIZE = 8;

const STATUS_FLOW = ['received', 'repairing', 'ready', 'picked_up'];
const STATUS_LABELS = {
  received: '已收',
  repairing: '修补中',
  ready: '可取',
  picked_up: '已取走',
};

const state = {
  items: [],
  page: 1,
  pageSize: PAGE_SIZE,
  total: 0,
  totalPages: 1,
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
  search: document.querySelector('#search'),
  filters: document.querySelector('#filters'),
  pager: document.querySelector('#pager'),
  pageInfo: document.querySelector('#page-info'),
  prevBtn: document.querySelector('#page-prev'),
  nextBtn: document.querySelector('#page-next'),
};

// 预估取件日不能早于今天
els.expectedPickup.min = new Date().toLocaleDateString('en-CA');

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
  const next = STATUS_FLOW[idx + 1];
  // 只允许推进到紧挨着的下一个状态，与后端校验保持一致
  const nextAction = next
    ? `
      <button class="btn small ${next === 'ready' ? 'warn' : ''}" data-action="${next}" data-code="${ticket.code}">
        改为${STATUS_LABELS[next]}
      </button>`
    : '';

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
        <div class="actions">${nextAction}</div>
      </div>
    </article>`;
}

function renderPager() {
  els.pageInfo.textContent = `第 ${state.page} / ${state.totalPages} 页 · 共 ${state.total} 单`;
  els.prevBtn.disabled = state.page <= 1;
  els.nextBtn.disabled = state.page >= state.totalPages;
}

function render() {
  if (state.total === 0) {
    els.list.innerHTML = state.search || state.filter
      ? '<p class="hint">没有符合条件的工单。</p>'
      : '<p class="hint">还没有工单，先在左边登记一双吧。</p>';
  } else {
    els.list.innerHTML = state.items.map(renderTicket).join('');
  }
  renderPager();
}

// 过滤/搜索/翻页都走后端
async function loadTickets() {
  els.list.innerHTML = '<p class="hint">加载中…</p>';
  try {
    const params = new URLSearchParams({
      page: String(state.page),
      pageSize: String(state.pageSize),
    });
    if (state.filter) params.set('status', state.filter);
    if (state.search) params.set('q', state.search);

    const data = await api(`/tickets?${params}`);
    state.items = data.items;
    state.total = data.total;
    state.page = data.page;
    state.totalPages = data.totalPages;
    render();
  } catch (err) {
    els.list.innerHTML = `<p class="error">${escapeHtml(err.message)}，请确认接口已启动。</p>`;
  }
}

let searchTimer;
els.search.addEventListener('input', () => {
  els.search.value = els.search.value.replace(/\D/g, '').slice(0, 4);
  state.search = els.search.value;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.page = 1;
    loadTickets();
  }, 250);
});

els.filters.addEventListener('click', (e) => {
  const btn = e.target.closest('.chip');
  if (!btn) return;
  els.filters.querySelectorAll('.chip').forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
  state.filter = btn.dataset.status;
  state.page = 1;
  loadTickets();
});

els.prevBtn.addEventListener('click', () => {
  if (state.page > 1) {
    state.page -= 1;
    loadTickets();
  }
});

els.nextBtn.addEventListener('click', () => {
  if (state.page < state.totalPages) {
    state.page += 1;
    loadTickets();
  }
});

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
    els.expectedPickup.min = new Date().toLocaleDateString('en-CA');
    // 回到第一页看新单
    state.page = 1;
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
    // 重新拉取：过滤/排序/分页都由后端决定
    await loadTickets();
  } catch (err) {
    alert(err.message);
    btn.disabled = false;
  }
});

loadTickets();
