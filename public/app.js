'use strict';
/* 考试系统 v1.0 前端（单页应用） */
const $app = document.getElementById('app');
const $modal = document.getElementById('modal-root');
const TYPE_NAME = { single: '单选', multi: '多选', judge: '判断', fill: '填空', essay: '简答', code: '编程' };
const LANG_NAME = { javascript: 'JavaScript', python: 'Python' };
function judgeHtml(judge) {
  if (!judge) return '';
  const chip = st => ({ pass: '<span class="tag green">通过</span>', fail: '<span class="tag red">输出不符</span>', error: '<span class="tag red">运行错误</span>', timeout: '<span class="tag red">运行超时</span>', empty: '<span class="tag gray">未作答</span>' }[st] || `<span class="tag gray">${esc(st)}</span>`);
  return `<div class="judge-box"><div class="row spread"><strong>自动判题：通过 ${judge.passed} / ${judge.total} 个测试用例</strong><span class="sub small">每例限时 3 秒</span></div>
  ${(judge.cases || []).map((c, i) => `<div class="case-row"><span style="width:58px;flex-shrink:0">用例 ${i + 1}</span>${chip(c.status)}<span class="case-io">输入 <code>${esc(c.input === '' || c.input === undefined ? '(空)' : c.input)}</code> · 期望 <code>${c.expected === undefined ? '提交后可查看' : esc(c.expected)}</code> · 实际 <code>${esc(c.actual === '' || c.actual === undefined ? '(无输出)' : c.actual)}</code>${c.err ? `<br><span class="mine-bad small">${esc(c.err)}</span>` : ''}</span></div>`).join('')}</div>`;
}
let S = { token: localStorage.getItem('exam_token') || '', user: JSON.parse(localStorage.getItem('exam_user') || 'null'), view: '', questions: [], papers: [], exams: [] };

const esc = s => String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDT = iso => iso ? String(iso).replace('T', ' ').slice(0, 16) : '-';
const toLocal = iso => { const d = new Date(iso || Date.now()); const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
function toast(msg, kind) { const t = document.createElement('div'); t.className = 'toast' + (kind ? ' ' + kind : ''); t.textContent = msg; document.getElementById('toast-root').appendChild(t); setTimeout(() => t.remove(), 2600); }
function openModal(html, wide) { $modal.innerHTML = `<div class="modal-mask"><div class="modal${wide ? ' wide' : ''}">${html}</div></div>`; $modal.querySelector('.modal-mask').addEventListener('mousedown', e => { if (e.target.classList.contains('modal-mask')) closeModal(); }); }
function closeModal() { $modal.innerHTML = ''; }
function confirmBox(text, onYes) {
  openModal(`<h3>请确认</h3><p>${esc(text)}</p><div class="row mt" style="justify-content:flex-end"><button class="btn ghost" onclick="closeModal()">取消</button><button class="btn danger" id="cf-yes">确定</button></div>`);
  document.getElementById('cf-yes').onclick = () => { closeModal(); onYes(); };
}
async function api(method, path, body) {
  const r = await fetch(path, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + S.token }, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 401 && path !== '/api/login') { logout(); throw new Error('登录已失效'); }
  const j = await r.json().catch(() => ({ ok: false, error: '服务器响应异常' }));
  if (!j.ok) throw new Error(j.error || '请求失败');
  return j.data;
}
function ansText(q, ans) {
  if (ans === undefined || ans === null || ans === '' || (Array.isArray(ans) && !ans.length)) return '（未作答）';
  if (q.type === 'single') { const o = (q.options || []).find(x => x.k === ans); return ans + (o ? '、' + o.t : ''); }
  if (q.type === 'multi') return (Array.isArray(ans) ? ans : [ans]).map(k => { const o = (q.options || []).find(x => x.k === k); return k + (o ? '、' + o.t : ''); }).join('；');
  if (q.type === 'judge') return ans === 'true' ? '正确' : '错误';
  if (q.type === 'fill') return (Array.isArray(ans) ? ans : [ans]).join(' / ');
  return String(ans);
}
function parseCSV(text) {
  const rows = []; let row = [], cur = '', inQ = false;
  text = String(text).replace(/^\ufeff/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else inQ = false; } else cur += c; }
    else if (c === '"') inQ = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (c !== '\r') cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.some(c => String(c).trim() !== ''));
}
function csvRowsToQuestions(rows) {
  const typeMap = { '单选': 'single', '多选': 'multi', '判断': 'judge', '填空': 'fill', '简答': 'essay', single: 'single', multi: 'multi', judge: 'judge', fill: 'fill', essay: 'essay' };
  const start = rows.length && String(rows[0][0]).includes('题型') ? 1 : 0;
  const items = [];
  for (let i = start; i < rows.length; i++) {
    const r = rows[i].map(c => String(c === undefined ? '' : c).trim());
    const type = typeMap[r[0]];
    if (!type) { items.push({ __error: `第 ${i + 1} 行题型无法识别：${r[0] || '(空)'}` }); continue; }
    const options = ['A', 'B', 'C', 'D'].map((k, j) => ({ k, t: r[2 + j] || '' })).filter(o => o.t !== '');
    let answer;
    if (type === 'single') answer = (r[6] || '').toUpperCase();
    else if (type === 'multi') answer = (r[6] || '').toUpperCase().split(/[,，、]/).map(s => s.trim()).filter(Boolean);
    else if (type === 'judge') answer = ['对', '正确', 'true', 'TRUE', 'T', '1', '是'].includes(r[6]) ? 'true' : 'false';
    else if (type === 'fill') answer = (r[6] || '').split(/[;；]/).map(s => s.trim()).filter(Boolean);
    else answer = r[6] || '';
    items.push({ type, stem: r[1] || '', options: (type === 'single' || type === 'multi') ? options : [], answer, analysis: r[7] || '', score: Number(r[8]) || 5, difficulty: r[9] || '易', tag: r[10] || '', subject: r[11] || 'Linux基础' });
  }
  return items;
}
function downloadText(filename, text, mime) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: mime || 'text/plain;charset=utf-8' })); a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 3000); }
async function downloadAuthed(path, filename) {
  const r = await fetch(path, { headers: { Authorization: 'Bearer ' + S.token } });
  if (!r.ok) throw new Error('下载失败');
  const blob = await r.blob(); const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}

/* ---------------- 登录 ---------------- */
function renderLogin(err, prefillUser) {
  $app.innerHTML = `<div class="login-wrap"><div class="login-card">
    <h1>考试系统</h1><p class="tip">教师组卷 · 学生考试 · 自动判分 · 成绩统计 · v1.0 正式版</p>
    <div class="err">${esc(err || '')}</div>
    <label>账号<input id="lg-user" autocomplete="username" placeholder="请输入账号" value="${esc(prefillUser || '')}"></label>
    <label>密码<input id="lg-pw" type="password" autocomplete="current-password" placeholder="请输入密码"></label>
    <button class="btn" id="lg-btn">登 录</button>
    <div class="quick">
      <button data-u="teacher">教师演示号</button><button data-u="student">学生演示号</button><button data-u="admin">管理员演示号</button>
    </div>
    <p class="sub small mt">内置演示账号密码均为 123456（对应 PRD 4.1 节）</p>
    <p class="sub small mt">还没有账号？<button class="link" id="go-register" style="color:var(--primary-d)">立即注册</button>（学生注册即生效，教师注册需管理员审核）</p>
  </div></div>`;
  const doLogin = async (u, p) => {
    try {
      const d = await api('POST', '/api/login', { username: u, password: p });
      S.token = d.token; S.user = d.user;
      localStorage.setItem('exam_token', S.token); localStorage.setItem('exam_user', JSON.stringify(S.user));
      enterApp();
    } catch (e) { renderLogin(e.message); }
  };
  document.getElementById('lg-btn').onclick = () => doLogin(document.getElementById('lg-user').value.trim(), document.getElementById('lg-pw').value);
  document.getElementById('lg-pw').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('lg-btn').click(); });
  $app.querySelectorAll('.quick button').forEach(b => b.onclick = () => doLogin(b.dataset.u, '123456'));
  document.getElementById('go-register').onclick = () => renderRegister();
}
async function renderRegister(err) {
  $app.innerHTML = `<div class="login-wrap"><div class="login-card">
    <h1>注册账号</h1><p class="tip">学生注册后可直接登录；教师账号需管理员审核通过</p>
    <div class="err">${esc(err || '')}</div>
    <label>账号<input id="rg-user" autocomplete="username" placeholder="登录用账号，如 stu31"></label>
    <label>姓名<input id="rg-name" placeholder="真实姓名"></label>
    <label>身份<select id="rg-role"><option value="student">学生</option><option value="teacher">教师</option></select></label>
    <label id="rg-class-wrap">班级<input id="rg-class" list="rg-classes" placeholder="如 计算机1班"><datalist id="rg-classes"></datalist></label>
    <label>密码（至少 6 位）<input id="rg-pw" type="password" autocomplete="new-password" placeholder="设置密码"></label>
    <label>确认密码<input id="rg-pw2" type="password" autocomplete="new-password" placeholder="再输一次"></label>
    <button class="btn" id="rg-btn">注 册</button>
    <p class="sub small mt">已有账号？<button class="link" id="go-login" style="color:var(--primary-d)">返回登录</button></p>
  </div></div>`;
  api('GET', '/api/public/classes').then(cls => { const dl = document.getElementById('rg-classes'); if (dl) dl.innerHTML = cls.map(c => `<option value="${esc(c)}">`).join(''); }).catch(() => { /* 班级列表拉取失败不影响注册 */ });
  const roleSel = document.getElementById('rg-role');
  roleSel.onchange = () => { document.getElementById('rg-class-wrap').style.display = roleSel.value === 'student' ? '' : 'none'; };
  document.getElementById('go-login').onclick = () => renderLogin();
  document.getElementById('rg-btn').onclick = async () => {
    const body = { username: document.getElementById('rg-user').value.trim(), name: document.getElementById('rg-name').value.trim(), role: roleSel.value, className: document.getElementById('rg-class').value.trim(), password: document.getElementById('rg-pw').value };
    if (body.password !== document.getElementById('rg-pw2').value) return renderRegisterKeep(body, '两次输入的密码不一致');
    try {
      const r = await api('POST', '/api/register', body);
      if (r.status === 'pending') renderLogin('注册已提交：教师账号需管理员在「用户管理」中审核通过后才能登录。');
      else { renderLogin('', body.username); toast('注册成功，请登录'); }
    } catch (e) { renderRegisterKeep(body, e.message); }
  };
  function renderRegisterKeep(body, msg) {
    renderRegister(msg).then(() => {
      document.getElementById('rg-user').value = body.username; document.getElementById('rg-name').value = body.name;
      document.getElementById('rg-class').value = body.className || ''; document.getElementById('rg-role').value = body.role;
      document.getElementById('rg-role').dispatchEvent(new Event('change'));
    });
  }
}
function logout() { S.token = ''; S.user = null; localStorage.removeItem('exam_token'); localStorage.removeItem('exam_user'); if (window.__examTimer) clearInterval(window.__examTimer); if (window.__monTimer) clearInterval(window.__monTimer); renderLogin(); }

/* ---------------- 主框架 ---------------- */
const NAVS = {
  teacher: [['questions', '题库管理'], ['papers', '试卷管理'], ['exams', '考试管理'], ['stats', '成绩统计']],
  student: [['examlist', '参加考试'], ['myscores', '我的成绩'], ['wrongbook', '错题本'], ['practice', '自主练习']],
  admin: [['overview', '数据概览'], ['users', '用户管理'], ['classes', '班级管理'], ['aisettings', 'AI 接口设置']]
};
function enterApp() {
  const navs = NAVS[S.user.role];
  S.view = navs[0][0];
  $app.innerHTML = `<div class="layout">
    <aside class="sidebar"><div class="logo">考试系统 <span style="font-size:12px;color:#38bdf8;font-weight:400">v1.0</span></div>
      <nav>${navs.map(n => `<button data-v="${n[0]}" class="${n[0] === S.view ? 'active' : ''}">${n[1]}</button>`).join('')}</nav>
      <div class="who" id="who-box">${whoHtml()}</div>
    </aside>
    <main class="main" id="main"></main></div>`;
  $app.querySelectorAll('.sidebar nav button').forEach(b => b.onclick = () => { S.view = b.dataset.v; $app.querySelectorAll('.sidebar nav button').forEach(x => x.classList.toggle('active', x === b)); renderView(); });
  bindWho();
  renderView();
}
function whoHtml() {
  return `${esc(S.user.name)}<br><span class="role">${ { teacher: '教师', student: '学生', admin: '管理员' }[S.user.role] }</span> · ${esc(S.user.username)}${S.user.className ? ' · ' + esc(S.user.className) : ''}<br><button class="link" style="color:#93c5fd;padding-left:0" id="btn-profile">修改信息</button> · <button class="link" style="color:#93c5fd;padding-left:0" id="btn-chpw">修改密码</button> · <button class="link" style="color:#fca5a5;padding-left:0" onclick="logout()">退出登录</button>`;
}
function bindWho() {
  const bp = document.getElementById('btn-profile'); if (bp) bp.onclick = () => profileForm();
  const bc = document.getElementById('btn-chpw'); if (bc) bc.onclick = () => changePasswordForm();
}
function profileForm() {
  openModal(`<h3>修改个人信息</h3><div class="form-grid">
  <label>姓名<input id="pf-name" value="${esc(S.user.name)}"></label>
  ${S.user.role === 'student' ? `<label>班级<input id="pf-class" value="${esc(S.user.className || '')}" placeholder="如 计算机1班"></label>` : ''}</div>
  <p class="sub small">账号与身份不可修改；改班级后，成绩统计按新班级归类。</p>
  <div class="row" style="justify-content:flex-end"><button class="btn ghost" onclick="closeModal()">取消</button><button class="btn" id="pf-save">保存</button></div>`);
  document.getElementById('pf-save').onclick = async () => {
    const body = { name: document.getElementById('pf-name').value.trim() };
    const pc = document.getElementById('pf-class'); if (pc) body.className = pc.value.trim();
    try {
      const u = await api('POST', '/api/me/profile', body);
      S.user = u; localStorage.setItem('exam_user', JSON.stringify(u));
      document.getElementById('who-box').innerHTML = whoHtml(); bindWho();
      closeModal(); toast('个人信息已更新');
    } catch (e) { toast(e.message, 'err'); }
  };
}
function changePasswordForm() {
  openModal(`<h3>修改密码</h3><div class="form-grid">
  <label>原密码<input id="cp-old" type="password"></label>
  <label>新密码（至少 6 位）<input id="cp-new" type="password"></label>
  <label>再输一次新密码<input id="cp-new2" type="password"></label></div>
  <div class="row" style="justify-content:flex-end"><button class="btn ghost" onclick="closeModal()">取消</button><button class="btn" id="cp-save">确认修改</button></div>`);
  document.getElementById('cp-save').onclick = async () => {
    const o = document.getElementById('cp-old').value, n = document.getElementById('cp-new').value, n2 = document.getElementById('cp-new2').value;
    if (n !== n2) return toast('两次输入的新密码不一致', 'err');
    try { await api('POST', '/api/me/password', { oldPassword: o, newPassword: n }); closeModal(); toast('密码已修改，下次登录用新密码'); }
    catch (e) { toast(e.message, 'err'); }
  };
}
function renderView() {
  if (window.__monTimer) clearInterval(window.__monTimer);
  window.scrollTo(0, 0);
  const v = S.view;
  if (S.user.role === 'teacher') { if (v === 'questions') return viewQuestions(); if (v === 'papers') return viewPapers(); if (v === 'exams') return viewExams(); if (v === 'stats') return viewStats(); }
  if (S.user.role === 'student') { if (v === 'examlist') return viewExamList(); if (v === 'myscores') return viewMyScores(); if (v === 'wrongbook') return viewWrongbook(); if (v === 'practice') return viewPractice(); if (v === 'taking') return; if (v === 'review') return; }
  if (S.user.role === 'admin') { if (v === 'overview') return viewOverview(); if (v === 'users') return viewUsers(); if (v === 'classes') return viewClasses(); if (v === 'aisettings') return viewAISettings(); }
}
const main = () => document.getElementById('main');
const statusTag = st => st === '进行中' ? '<span class="tag green">进行中</span>' : st === '未开始' ? '<span class="tag orange">未开始</span>' : st === '已停止' ? '<span class="tag red">已停止</span>' : '<span class="tag gray">已结束</span>';

/* ================= 教师端：题库 ================= */
async function viewQuestions() {
  const f = S.qfilter || {};
  const qs = new URLSearchParams(); if (f.type) qs.set('type', f.type); if (f.difficulty) qs.set('difficulty', f.difficulty); if (f.keyword) qs.set('keyword', f.keyword);
  S.questions = await api('GET', '/api/questions' + (qs.toString() ? '?' + qs : ''));
  main().innerHTML = `<h2>题库管理</h2>
  <div class="card"><div class="row spread"><div class="row">
    <select id="qf-type"><option value="">全部题型</option>${Object.entries(TYPE_NAME).map(([k, v]) => `<option value="${k}" ${f.type === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
    <select id="qf-diff"><option value="">全部难度</option>${['易', '中', '难'].map(d => `<option ${f.difficulty === d ? 'selected' : ''}>${d}</option>`).join('')}</select>
    <input id="qf-kw" placeholder="搜题干 / 知识点" value="${esc(f.keyword || '')}" style="width:180px">
    <button class="btn ghost" id="qf-go">筛选</button></div>
    <div class="row"><button class="btn ghost" id="q-import">批量导入</button><button class="btn ghost" id="q-export">导出题库</button><button class="btn ai" id="q-ai">AI 生成题目</button><button class="btn" id="q-add">＋ 新增题目</button></div></div></div>
  <div class="card">${S.questions.length ? `<table><tr><th style="width:60px">题型</th><th>题干</th><th style="width:56px">分值</th><th style="width:56px">难度</th><th style="width:110px">知识点</th><th style="width:120px">操作</th></tr>
    ${S.questions.map(q => `<tr><td><span class="tag">${TYPE_NAME[q.type]}</span></td><td class="stem-cell">${esc(q.stem)}</td><td>${q.score}</td><td>${q.difficulty}</td><td>${esc(q.tag || '')}</td>
    <td><button class="link" data-edit="${q.id}">编辑</button><button class="link danger" data-del="${q.id}">删除</button></td></tr>`).join('')}</table>`
    : '<div class="empty">暂无题目，点右上角新增。</div>'}</div>`;
  document.getElementById('qf-go').onclick = () => { S.qfilter = { type: document.getElementById('qf-type').value, difficulty: document.getElementById('qf-diff').value, keyword: document.getElementById('qf-kw').value.trim() }; viewQuestions(); };
  document.getElementById('q-add').onclick = () => questionForm(null);
  document.getElementById('q-ai').onclick = () => aiGenerateModal();
  document.getElementById('q-import').onclick = () => importQuestionsModal();
  document.getElementById('q-export').onclick = async () => { try { await downloadAuthed('/api/questions/export', '题库导出.csv'); toast('题库 CSV 已下载'); } catch (e) { toast(e.message, 'err'); } };
  main().querySelectorAll('[data-edit]').forEach(b => b.onclick = () => questionForm(S.questions.find(q => q.id === b.dataset.edit)));
  main().querySelectorAll('[data-del]').forEach(b => b.onclick = () => confirmBox('确定删除这道题目吗？', async () => { try { await api('DELETE', '/api/questions/' + b.dataset.del); toast('已删除'); viewQuestions(); } catch (e) { toast(e.message, 'err'); } }));
}
function questionForm(q) {
  const isNew = !q; q = q || S.pendingDraft || { type: 'single', stem: '', options: [{ k: 'A', t: '' }, { k: 'B', t: '' }, { k: 'C', t: '' }, { k: 'D', t: '' }], answer: 'A', analysis: '', score: 5, difficulty: '易', tag: '', subject: 'Linux基础' };
  S.pendingDraft = null;
  openModal(`<h3>${isNew ? '新增题目' : '编辑题目'}</h3><div class="form-grid">
    <label>题型<select id="fq-type">${Object.entries(TYPE_NAME).map(([k, v]) => `<option value="${k}" ${q.type === k ? 'selected' : ''}>${v}题</option>`).join('')}</select></label>
    <label>题干<textarea id="fq-stem" rows="2">${esc(q.stem)}</textarea></label>
    <div id="fq-extra"></div>
    <div class="row"><label style="flex:1">分值<input id="fq-score" type="number" min="1" step="0.5" value="${q.score}"></label>
    <label style="flex:1">难度<select id="fq-diff">${['易', '中', '难'].map(d => `<option ${q.difficulty === d ? 'selected' : ''}>${d}</option>`).join('')}</select></label>
    <label style="flex:1">知识点标签<input id="fq-tag" value="${esc(q.tag || '')}"></label>
    <label style="flex:1">科目<input id="fq-subject" value="${esc(q.subject || 'Linux基础')}"></label></div>
    <label>解析<textarea id="fq-analysis" rows="2">${esc(q.analysis || '')}</textarea></label>
    </div>
    <div class="row" style="justify-content:flex-end"><button class="btn ghost" onclick="closeModal()">取消</button><button class="btn" id="fq-save">保存</button></div>`);
  const extra = document.getElementById('fq-extra');
  const drawExtra = () => {
    const t = document.getElementById('fq-type').value;
    if (t === 'single' || t === 'multi') {
      const opts = q.options && q.options.length ? q.options : [{ k: 'A', t: '' }, { k: 'B', t: '' }, { k: 'C', t: '' }, { k: 'D', t: '' }];
      extra.innerHTML = `<label>选项与正确答案（${t === 'single' ? '单选：点选一项为正确答案' : '多选：勾选多项为正确答案'}）</label>` + opts.map(o => `
        <div class="opt-row"><span style="width:16px;font-weight:700">${o.k}</span>
        <input type="text" data-opt="${o.k}" value="${esc(o.t)}">
        <label style="margin:0;color:var(--ink)"><input type="${t === 'single' ? 'radio' : 'checkbox'}" name="fq-correct" value="${o.k}" ${t === 'single' ? (q.answer === o.k ? 'checked' : '') : (Array.isArray(q.answer) && q.answer.includes(o.k) ? 'checked' : '')}> 正确答案</label></div>`).join('');
    } else if (t === 'judge') {
      extra.innerHTML = `<label>正确答案<select id="fq-judge"><option value="true" ${q.answer === 'true' ? 'selected' : ''}>正确</option><option value="false" ${q.answer === 'false' ? 'selected' : ''}>错误</option></select></label>`;
    } else if (t === 'essay') {
      extra.innerHTML = `<label>参考答案（学生不可见，作为批改对照）<textarea id="fq-ref" rows="4">${esc(typeof q.answer === 'string' ? q.answer : '')}</textarea></label><p class="sub small">评分要点写在下方“解析”栏，批改时教师可见。简答题交卷后不自动判分，需教师人工批改。</p>`;
    } else if (t === 'code') {
      const cases = Array.isArray(q.cases) && q.cases.length ? q.cases : [{ input: '', expected: '' }];
      extra.innerHTML = `<label>编程语言<select id="fq-lang">${Object.entries(LANG_NAME).map(([k, v]) => `<option value="${k}" ${q.language === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label>代码模板（预置给学生的起始代码）<textarea id="fq-template" rows="5" class="code-ta" spellcheck="false">${esc(q.template || '')}</textarea></label>
      <label>参考代码（学生不可见，回顾时对照讲解）<textarea id="fq-solution" rows="5" class="code-ta" spellcheck="false">${esc(typeof q.answer === 'string' ? q.answer : '')}</textarea></label>
      <label>测试用例（交卷时逐条运行学生代码比对输出，学生看不到期望输出）</label>
      ${cases.map((c, i) => `<div class="opt-row"><span style="width:48px">用例${i + 1}</span><input type="text" data-cin="${i}" placeholder="标准输入，如 3 5" value="${esc(c.input)}"><input type="text" data-cexp="${i}" placeholder="期望输出，如 8" value="${esc(c.expected)}"></div>`).join('')}
      <button class="link" id="fq-addcase" type="button">＋ 增加一个用例</button>
      <p class="sub small">判题口径：每条用例单独运行（限时 3 秒），输出与期望完全一致（忽略行尾空白与首尾空行）算通过，得分 = 通过数 ÷ 总数 × 本题分值。解析栏填写解题思路。</p>`;
      const ac = document.getElementById('fq-addcase');
      if (ac) ac.onclick = () => { collect(); q.cases = [...(Array.isArray(q.cases) ? q.cases : []), { input: '', expected: '' }]; drawExtra(); };
    } else {
      const blanks = Array.isArray(q.answer) ? q.answer : [''];
      extra.innerHTML = `<label>正确答案（每行一个空；同一空的等价答案用 | 分隔，如 su|su -）</label>` + blanks.map((b, i) => `<div class="opt-row"><span style="width:44px">空${i + 1}</span><input type="text" data-blank="${i}" value="${esc(b)}"></div>`).join('') +
        `<button class="link" id="fq-addblank" type="button">＋ 增加一个空</button>`;
      const ab = document.getElementById('fq-addblank');
      if (ab) ab.onclick = () => { collect(); q.answer = [...(Array.isArray(q.answer) ? q.answer : ['']), '']; drawExtra(); };
    }
  };
  const collect = () => {
    // 按当前实际渲染的字段收集（切换题型时先收旧字段再重绘，不能按新题型读尚未渲染的控件）
    q.stem = document.getElementById('fq-stem').value;
    if (extra.querySelector('[data-opt]')) {
      const isMulti = extra.querySelector('[name=fq-correct]').type === 'checkbox';
      q.type = isMulti ? 'multi' : 'single';
      q.options = [...extra.querySelectorAll('[data-opt]')].map(i => ({ k: i.dataset.opt, t: i.value }));
      const checked = [...extra.querySelectorAll('[name=fq-correct]:checked')].map(i => i.value);
      q.answer = isMulti ? checked : (checked[0] || 'A');
    } else if (document.getElementById('fq-judge')) { q.type = 'judge'; q.options = []; q.answer = document.getElementById('fq-judge').value; }
    else if (document.getElementById('fq-ref')) { q.type = 'essay'; q.options = []; q.answer = document.getElementById('fq-ref').value; }
    else if (document.getElementById('fq-lang')) { q.type = 'code'; q.options = []; q.language = document.getElementById('fq-lang').value; q.template = document.getElementById('fq-template').value; q.answer = document.getElementById('fq-solution').value; q.cases = [...extra.querySelectorAll('[data-cin]')].map((inp, i) => ({ input: inp.value, expected: extra.querySelector(`[data-cexp="${i}"]`).value })); }
    else if (extra.querySelector('[data-blank]')) { q.type = 'fill'; q.options = []; q.answer = [...extra.querySelectorAll('[data-blank]')].map(i => i.value); }
  };
  document.getElementById('fq-type').onchange = () => { collect(); drawExtra(); };
  drawExtra();
  document.getElementById('fq-save').onclick = async () => {
    collect();
    q.score = Number(document.getElementById('fq-score').value) || 5;
    q.difficulty = document.getElementById('fq-diff').value;
    q.tag = document.getElementById('fq-tag').value.trim();
    q.subject = document.getElementById('fq-subject').value.trim() || 'Linux基础';
    q.analysis = document.getElementById('fq-analysis').value;
    if (!q.stem.trim()) return toast('题干不能为空', 'err');
    if (q.type === 'multi' && (!Array.isArray(q.answer) || !q.answer.length)) return toast('多选题至少要有一个正确答案', 'err');
    if (q.type === 'essay' && !String(q.answer || '').trim()) return toast('简答题请填写参考答案（批改对照用）', 'err');
    if (q.type === 'code' && (!Array.isArray(q.cases) || !q.cases.length || q.cases.some(c => c.expected === ''))) return toast('编程题每个测试用例都要填写期望输出', 'err');
    if (q.type === 'fill' && q.answer.some(a => !String(a).trim())) return toast('填空题每个空都要有答案', 'err');
    try { await api(isNew ? 'POST' : 'PUT', '/api/questions' + (isNew ? '' : '/' + q.id), q); closeModal(); toast('已保存'); viewQuestions(); }
    catch (e) { toast(e.message, 'err'); }
  };
}

async function aiGenerateModal() {
  let st = { enabled: false };
  try { st = await api('GET', '/api/ai/status'); } catch (e) { /* 状态拉取失败按未启用处理 */ }
  if (!st.enabled) return toast('AI 接口未启用或未配置完整，请管理员先在「AI 接口设置」页设置', 'warn');
  openModal(`<h3>AI 生成题目</h3><div class="form-grid">
  <label>主题 / 知识点<input id="ag-topic" placeholder="如：grep 文本查找、systemd 服务管理、文件权限"></label>
  <div class="row"><label style="flex:1">题型<select id="ag-type">${['single', 'multi', 'judge', 'fill', 'essay'].map(t => `<option value="${t}">${TYPE_NAME[t]}</option>`).join('')}</select></label>
  <label style="flex:1">难度<select id="ag-diff">${['易', '中', '难'].map(d => `<option ${d === '中' ? 'selected' : ''}>${d}</option>`).join('')}</select></label></div></div>
  <p class="sub small">当前模型：${esc(st.model || '')}。生成后会打开题目编辑窗，检查无误后再保存入库。AI 出题偶有错误，务必人工核对答案。</p>
  <div class="row" style="justify-content:flex-end"><button class="btn ghost" onclick="closeModal()">取消</button><button class="btn ai" id="ag-go">生成</button></div>`);
  document.getElementById('ag-go').onclick = async () => {
    const btn = document.getElementById('ag-go');
    const topic = document.getElementById('ag-topic').value.trim();
    if (!topic) return toast('请先填写主题 / 知识点', 'warn');
    btn.disabled = true; btn.textContent = '生成中…';
    try {
      const draft = await api('POST', '/api/ai/generate', { topic, type: document.getElementById('ag-type').value, difficulty: document.getElementById('ag-diff').value });
      S.pendingDraft = draft; closeModal(); questionForm(null);
      toast('已生成草稿，请核对后保存');
    } catch (e) { toast(e.message, 'err'); btn.disabled = false; btn.textContent = '生成'; }
  };
}

function importQuestionsModal() {
  const tpl = [
    '题型,题干,选项A,选项B,选项C,选项D,正确答案,解析,分值,难度,知识点,科目',
    '单选,示例题：查看当前目录下文件的命令是？,ls,pwd,cd,mkdir,A,ls 用于列出目录内容,5,易,命令行基础,Linux基础',
    '多选,示例题：文本处理三剑客包括哪些？,grep,sed,awk,find,"A,B,C",grep 查找 sed 编辑 awk 分析,6,中,文本处理,Linux基础',
    '判断,示例题：Linux 的设计理念之一是一切皆文件。,,,,,对,设备在 /dev 下以文件形式访问,5,易,系统概念,Linux基础',
    '填空,示例题：显示当前所在目录路径的命令是 ____。,,,,,pwd,pwd 输出当前工作目录,3,易,命令行基础,Linux基础',
    '填空,示例题：切换目录用 ____ 命令；回到上层目录用 ____。,,,,,cd;cd ..,多空答案用英文分号分隔,5,中,命令行基础,Linux基础',
    '简答,示例题：简述 chmod 777 的含义与生产环境慎用原因。,,,,,三个数字依次表示所有者与所属组与其他人的权限；7 为读加写加执行；任意用户可改写有被篡改风险；应遵循最小权限原则,评分要点：权限构成 6 分；风险 2 分；最小权限 2 分,10,中,用户权限,Linux基础'
  ].join('\n');
  openModal(`<h3>批量导入题目（CSV）</h3>
  <p class="sub small" style="line-height:1.8">列顺序：题型、题干、选项A~D、正确答案、解析、分值、难度、知识点、科目。<br>答案写法：单选填字母；多选用英文逗号分隔（如 A,B,C，需给单元格加引号）；判断填 对/错；填空多空用英文分号分隔、等价答案用 | 分隔；简答填参考答案全文。</p>
  <div class="row mt"><button class="btn ghost small" id="qi-tpl">下载模板</button><label class="btn ghost small" style="cursor:pointer">选择 CSV 文件<input id="qi-file" type="file" accept=".csv,text/csv" style="display:none"></label></div>
  <textarea id="qi-text" rows="9" style="width:100%;margin-top:10px" placeholder="也可以把 CSV 内容直接粘贴到这里"></textarea>
  <div id="qi-result" class="mt" style="line-height:1.8"></div>
  <div class="row" style="justify-content:flex-end"><button class="btn ghost" onclick="closeModal()">取消</button><button class="btn" id="qi-go">开始导入</button></div>`, true);
  document.getElementById('qi-tpl').onclick = () => downloadText('题目导入模板.csv', '\ufeff' + tpl, 'text/csv;charset=utf-8');
  document.getElementById('qi-file').onchange = async e => { const f = e.target.files[0]; if (f) document.getElementById('qi-text').value = await f.text(); };
  document.getElementById('qi-go').onclick = async () => {
    const parsed = csvRowsToQuestions(parseCSV(document.getElementById('qi-text').value));
    const localErr = parsed.filter(x => x.__error).map(x => x.__error);
    const items = parsed.filter(x => !x.__error);
    if (!items.length) { document.getElementById('qi-result').innerHTML = '<span style="color:var(--bad)">没有可导入的题目，请检查格式。</span>'; return; }
    try {
      const r = await api('POST', '/api/questions/import', { items });
      const errs = [...localErr, ...r.errors.map(e => `第 ${e.row} 行：${e.error}`)];
      document.getElementById('qi-result').innerHTML = `成功导入 <strong>${r.created}</strong> 道题。${errs.length ? `<br><span style="color:var(--bad)">${errs.length} 行未导入：</span><br>${errs.map(esc).join('<br>')}` : ''}`;
      toast(`导入完成：${r.created} 道`);
      S.qfilter = {}; viewQuestions();
    } catch (e) { toast(e.message, 'err'); }
  };
}

/* ================= 教师端：试卷 ================= */
async function viewPapers() {
  S.papers = await api('GET', '/api/papers');
  main().innerHTML = `<h2>试卷管理</h2>
  <div class="card"><div class="row spread"><span class="sub">手动勾选题目，或按题型 / 难度规则随机抽题组卷。</span><button class="btn" id="p-new">＋ 新建试卷</button></div></div>
  ${S.papers.length ? S.papers.map(pp => `<div class="card"><div class="row spread"><div><strong>${esc(pp.name)}</strong> <span class="tag gray">${esc(pp.subject)}</span><div class="sub small mt">共 ${pp.items.length} 题 · 总分 ${pp.total} 分 · 创建于 ${fmtDT(pp.createdAt)}</div></div>
    <div class="row"><button class="btn ghost small" data-editpaper="${pp.id}">编辑</button><button class="btn ghost small" data-duppaper="${pp.id}">复制</button><button class="btn ghost small" data-preview="${pp.id}">预览整卷</button><button class="btn ghost small" data-printpaper="${pp.id}">打印</button><button class="btn ghost small" data-delpaper="${pp.id}" style="color:var(--bad)">删除</button></div></div></div>`).join('') : '<div class="card"><div class="empty">暂无试卷。</div></div>'}`;
  document.getElementById('p-new').onclick = () => paperBuilder();
  main().querySelectorAll('[data-preview]').forEach(b => b.onclick = () => { const pp = S.papers.find(x => x.id === b.dataset.preview); openModal(`<h3>${esc(pp.name)}（总分 ${pp.total}）</h3>` + pp.items.map((it, i) => it.question ? `<p style="margin-bottom:10px"><strong>${i + 1}.（${TYPE_NAME[it.question.type]}，${it.score} 分）</strong>${esc(it.question.stem)}<br><span class="sub small">答案：${esc(ansText(it.question, it.question.answer))}</span></p>` : '').join('') + `<div class="row" style="justify-content:flex-end"><button class="btn" onclick="closeModal()">关闭</button></div>`, true); });
  main().querySelectorAll('[data-editpaper]').forEach(b => b.onclick = () => paperBuilder(S.papers.find(x => x.id === b.dataset.editpaper)));
  main().querySelectorAll('[data-duppaper]').forEach(b => b.onclick = async () => { try { await api('POST', '/api/papers/' + b.dataset.duppaper + '/duplicate'); toast('已复制为新试卷（副本）'); viewPapers(); } catch (e) { toast(e.message, 'err'); } });
  main().querySelectorAll('[data-printpaper]').forEach(b => b.onclick = async () => { if (!S.bank || !S.bank.length) { try { S.bank = await api('GET', '/api/questions'); } catch (e) { return toast(e.message, 'err'); } } printPaper(S.papers.find(x => x.id === b.dataset.printpaper)); });
  main().querySelectorAll('[data-delpaper]').forEach(b => b.onclick = () => confirmBox('确定删除这份试卷吗？', async () => { try { await api('DELETE', '/api/papers/' + b.dataset.delpaper); toast('已删除'); viewPapers(); } catch (e) { toast(e.message, 'err'); } }));
}
async function paperBuilder(existing) {
  if (!S.questions.length) S.questions = await api('GET', '/api/questions');
  const picked = []; // {q, score}
  if (existing) (existing.items || []).forEach(it => { if (it.question) picked.push({ q: it.question, score: it.score }); });
  openModal(`<h3>${existing ? '编辑试卷' : '新建试卷'}</h3>
  <label style="display:block;margin-bottom:10px">试卷名称<input id="pb-name" style="width:100%;margin-top:5px" value="${esc(existing ? existing.name : 'Linux基础测验卷')}"></label>
  <div class="row mb"><button class="btn small" id="pb-tab-manual">手动组卷</button><button class="btn ghost small" id="pb-tab-random">规则随机组卷</button></div>
  <div id="pb-body"></div>
  <div class="card" style="background:#f8fafc;margin-top:12px"><div class="row spread"><span>已选 <strong id="pb-count">0</strong> 题 · 总分 <strong id="pb-total">0</strong> 分</span>
  <div class="row"><button class="btn ghost" onclick="closeModal()">取消</button><button class="btn" id="pb-save">保存试卷</button></div></div>
  <div id="pb-picked" class="mt"></div></div>`, true);
  const body = document.getElementById('pb-body');
  const refreshPicked = () => {
    document.getElementById('pb-count').textContent = picked.length;
    document.getElementById('pb-total').textContent = picked.reduce((s, x) => s + x.score, 0);
    document.getElementById('pb-picked').innerHTML = picked.map((x, i) => `<div class="checkrow"><span style="flex:1"><strong>${i + 1}.</strong> <span class="tag">${TYPE_NAME[x.q.type]}</span> ${esc(x.q.stem)} <span class="tag gray">${x.q.difficulty}</span></span><input type="number" min="0.5" step="0.5" value="${x.score}" data-pscore="${i}"><button class="link" data-move="${i}|-1" title="上移">↑</button><button class="link" data-move="${i}|1" title="下移">↓</button><button class="link" data-replace="${i}">换一题</button><button class="link danger" data-remove="${i}">移除</button></div>`).join('');
    document.querySelectorAll('[data-pscore]').forEach(inp => inp.onchange = () => { picked[Number(inp.dataset.pscore)].score = Number(inp.value) || 0; refreshPicked(); });
    document.querySelectorAll('[data-move]').forEach(b => b.onclick = () => { const parts = b.dataset.move.split('|'); const i = Number(parts[0]), j = i + Number(parts[1]); if (j < 0 || j >= picked.length) return; const t = picked[i]; picked[i] = picked[j]; picked[j] = t; refreshPicked(); });
    document.querySelectorAll('[data-remove]').forEach(b => b.onclick = () => { picked.splice(Number(b.dataset.remove), 1); refreshPicked(); drawManual(); });
    document.querySelectorAll('[data-replace]').forEach(b => b.onclick = async () => {
      const i = Number(b.dataset.replace), cur = picked[i];
      try { const nq = await api('POST', '/api/papers/replace-one', { type: cur.q.type, difficulty: cur.q.difficulty, exclude: picked.map(x => x.q.id) }); picked[i] = { q: nq, score: cur.score }; refreshPicked(); drawManual(); toast('已替换'); }
      catch (e) { toast(e.message, 'err'); }
    });
  };
  const drawManual = () => {
    body.innerHTML = `<div class="paper-pick">${S.questions.map(q => { const sel = picked.find(x => x.q.id === q.id); return `<div class="checkrow"><input type="checkbox" data-pick="${q.id}" ${sel ? 'checked' : ''}><span style="flex:1"><span class="tag">${TYPE_NAME[q.type]}</span> ${esc(q.stem)} <span class="tag gray">${q.difficulty}</span> <span class="sub small">${q.score} 分</span></span></div>`; }).join('') || '<div class="empty">题库为空。</div>'}</div>`;
    body.querySelectorAll('[data-pick]').forEach(cb => cb.onchange = () => { const q = S.questions.find(x => x.id === cb.dataset.pick); if (cb.checked) picked.push({ q, score: q.score }); else { const i = picked.findIndex(x => x.q.id === q.id); if (i >= 0) picked.splice(i, 1); } refreshPicked(); });
  };
  const drawRandom = () => {
    body.innerHTML = Object.entries(TYPE_NAME).map(([t, name]) => `<div class="row mb"><span style="width:52px"><strong>${name}</strong></span>${['易', '中', '难'].map(d => `<label class="sub small">${d} <input type="number" min="0" value="0" id="rr-${t}-${d}" style="width:60px"></label>`).join('')}<span class="sub small">题库现有：${['易', '中', '难'].map(d => d + ' ' + S.questions.filter(q => q.type === t && q.difficulty === d).length).join(' · ')}</span></div>`).join('') +
      `<button class="btn" id="rr-go">按规则随机抽题</button> <span class="sub small">抽题结果会填入下方已选区，可再逐题替换。</span>`;
    document.getElementById('rr-go').onclick = async () => {
      const rules = Object.keys(TYPE_NAME).map(t => ({ type: t, easy: Number(document.getElementById(`rr-${t}-易`).value) || 0, mid: Number(document.getElementById(`rr-${t}-中`).value) || 0, hard: Number(document.getElementById(`rr-${t}-难`).value) || 0 })).filter(r => r.easy + r.mid + r.hard > 0);
      if (!rules.length) return toast('至少设置一种题型的数量', 'warn');
      try { const got = await api('POST', '/api/papers/random-preview', { rules }); picked.length = 0; got.forEach(q => picked.push({ q, score: q.score })); refreshPicked(); toast(`已抽中 ${got.length} 道题`); }
      catch (e) { toast(e.message, 'err'); }
    };
  };
  const tabM = document.getElementById('pb-tab-manual'), tabR = document.getElementById('pb-tab-random');
  tabM.onclick = () => { tabM.className = 'btn small'; tabR.className = 'btn ghost small'; drawManual(); };
  tabR.onclick = () => { tabR.className = 'btn small'; tabM.className = 'btn ghost small'; drawRandom(); };
  drawManual(); refreshPicked();
  document.getElementById('pb-save').onclick = async () => {
    if (!picked.length) return toast('还没有选任何题目', 'warn');
    const payload = { name: document.getElementById('pb-name').value.trim() || '未命名试卷', subject: existing ? existing.subject : 'Linux基础', items: picked.map(x => ({ qid: x.q.id, score: x.score })) };
    try { const pp = existing ? await api('PUT', '/api/papers/' + existing.id, payload) : await api('POST', '/api/papers', payload); closeModal(); toast(`试卷已保存：共 ${pp.items.length} 题，总分 ${pp.total} 分`); viewPapers(); }
    catch (e) { toast(e.message, 'err'); }
  };
}

/* ================= 教师端：考试 ================= */
async function viewExams() {
  const showArchived = !!S.showArchivedExams;
  S.exams = await api('GET', '/api/exams' + (showArchived ? '?archived=1' : ''));
  if (!S.papers.length) S.papers = await api('GET', '/api/papers');
  main().innerHTML = `<h2>考试管理</h2>
  <div class="card"><div class="row spread"><span class="sub">发布考试后，学生在时间窗口内参加；状态按时间自动流转。归档会隐藏考试但保留答卷、成绩和试卷引用。</span>${showArchived ? '' : '<button class="btn" id="e-new">＋ 发布考试</button>'}</div>
  <div class="row mt"><button class="btn small ${showArchived ? 'ghost' : ''}" data-exam-view="active">考试列表</button><button class="btn small ${showArchived ? '' : 'ghost'}" data-exam-view="archived">已归档</button></div></div>
  ${S.exams.length ? `<div class="card"><table><tr><th>考试名称</th><th>试卷</th><th>时间窗口</th><th>时长</th><th>状态</th><th>参考/交卷</th><th>平均分</th><th>操作</th></tr>
  ${S.exams.map(e => { const pp = S.papers.find(x => x.id === e.paperId); return `<tr><td><strong>${esc(e.name)}</strong></td><td>${esc(pp ? pp.name : '-')}</td><td class="small">${fmtDT(e.startTime)} ~ ${fmtDT(e.endTime)}</td><td>${e.durationMin} 分钟</td><td>${statusTag(e.status)}</td><td>${e.joined} / ${e.submitted}${e.pendingGrading ? `<br><span class="tag orange">待批改 ${e.pendingGrading} 份</span>` : ''}</td><td>${e.avg === null ? '-' : e.avg}</td>
  <td>${e.status === '未开始' && !showArchived ? `<button class="link" data-editexam="${e.id}">编辑</button><button class="link danger" data-delexam="${e.id}">删除</button>` : `<button class="link" data-gostats="${e.id}">看统计</button>`}${e.status === '进行中' && !showArchived ? `<button class="link" data-monitor="${e.id}">监考</button><button class="link danger" data-stop-exam="${e.id}">停止考试</button>` : ''}${showArchived ? `<button class="link" data-unarchive="${e.id}">恢复</button>` : e.status !== '进行中' ? `<button class="link" data-archive="${e.id}">归档</button>` : ''}${!showArchived ? `<button class="link" data-dupexam="${e.id}">复制</button>` : ''}</td></tr>`; }).join('')}</table></div>` : `<div class="card"><div class="empty">${showArchived ? '暂无已归档考试。' : '暂无考试。'}</div></div>`}`;
  main().querySelectorAll('[data-exam-view]').forEach(b => b.onclick = () => { S.showArchivedExams = b.dataset.examView === 'archived'; viewExams(); });
  const newExamButton = document.getElementById('e-new'); if (newExamButton) newExamButton.onclick = () => examForm();
  main().querySelectorAll('[data-archive]').forEach(b => b.onclick = () => confirmBox('归档后，学生将看不到这场考试，但所有答卷、成绩和统计都会保留。确定归档吗？', async () => {
    try { await api('POST', `/api/exams/${b.dataset.archive}/archive`); toast('考试已归档，答卷和成绩保留'); viewExams(); }
    catch (e) { toast(e.message, 'err'); }
  }));
  main().querySelectorAll('[data-unarchive]').forEach(b => b.onclick = async () => {
    try { await api('POST', `/api/exams/${b.dataset.unarchive}/unarchive`); toast('考试已恢复'); viewExams(); }
    catch (e) { toast(e.message, 'err'); }
  });
  main().querySelectorAll('[data-stop-exam]').forEach(b => b.onclick = () => confirmBox('确定立即停止这场考试吗？正在答题的学生将按已保存答案立即交卷并判分。', async () => {
    try { const r = await api('POST', `/api/exams/${b.dataset.stopExam}/stop`); toast(`考试已停止，已封卷 ${r.submitted} 份答卷`); viewExams(); }
    catch (e) { toast(e.message, 'err'); }
  }));
  main().querySelectorAll('[data-delexam]').forEach(b => b.onclick = () => confirmBox('确定删除这场未开考的考试吗？', async () => { try { await api('DELETE', '/api/exams/' + b.dataset.delexam); toast('已删除'); viewExams(); } catch (e) { toast(e.message, 'err'); } }));
  main().querySelectorAll('[data-editexam]').forEach(b => b.onclick = () => examForm(S.exams.find(x => x.id === b.dataset.editexam)));
  main().querySelectorAll('[data-gostats]').forEach(b => b.onclick = () => { S.statsExam = b.dataset.gostats; S.view = 'stats'; document.querySelectorAll('.sidebar nav button').forEach(x => x.classList.toggle('active', x.dataset.v === 'stats')); renderView(); });
  main().querySelectorAll('[data-monitor]').forEach(b => b.onclick = () => { S.view = 'monitor'; document.querySelectorAll('.sidebar nav button').forEach(x => x.classList.remove('active')); viewMonitor(b.dataset.monitor); });
  main().querySelectorAll('[data-dupexam]').forEach(b => b.onclick = async () => { try { const cp = await api('POST', '/api/exams/' + b.dataset.dupexam + '/duplicate'); toast(`已复制为「${cp.name}」，开考时间设为明天，可再编辑调整`); viewExams(); } catch (e) { toast(e.message, 'err'); } });
}
function examForm(exam) {
  if (!S.papers.length) return toast('请先在“试卷管理”里建一份试卷', 'warn');
  const start = new Date(); const end = new Date(Date.now() + 7 * 24 * 3600 * 1000);
  openModal(`<h3>${exam ? '编辑考试' : '发布考试'}</h3><div class="form-grid">
  <label>考试名称<input id="fe-name" value="${esc(exam ? exam.name : 'Linux基础随堂测验')}"></label>
  <label>关联试卷<select id="fe-paper">${S.papers.map(pp => `<option value="${pp.id}" ${exam && exam.paperId === pp.id ? 'selected' : ''}>${esc(pp.name)}（${pp.items.length} 题 / ${pp.total} 分）</option>`).join('')}</select></label>
  <div class="row"><label style="flex:1">开始时间<input id="fe-start" type="datetime-local" value="${exam ? toLocal(exam.startTime) : toLocal(start)}"></label>
  <label style="flex:1">结束时间<input id="fe-end" type="datetime-local" value="${exam ? toLocal(exam.endTime) : toLocal(end)}"></label>
  <label style="flex:1">考试时长（分钟）<input id="fe-dur" type="number" min="1" value="${exam ? exam.durationMin : 30}"></label>
  <label style="flex:1">切屏上限（次，0=不限制）<input id="fe-limit" type="number" min="0" value="${exam ? (exam.switchLimit || 0) : 0}"></label></div>
  <label style="color:var(--ink)"><input type="checkbox" id="fe-show" ${!exam || exam.showAnswer ? 'checked' : ''}> 交卷后向学生展示正确答案与解析</label>
  <label>考试说明<textarea id="fe-note" rows="2">${esc(exam ? (exam.note || '') : '闭卷答题，请独立完成。')}</textarea></label></div>
  <div class="row" style="justify-content:flex-end"><button class="btn ghost" onclick="closeModal()">取消</button><button class="btn" id="fe-save">${exam ? '保存修改' : '发布考试'}</button></div>`);
  document.getElementById('fe-save').onclick = async () => {
    const body = { name: document.getElementById('fe-name').value.trim(), paperId: document.getElementById('fe-paper').value, startTime: new Date(document.getElementById('fe-start').value).toISOString(), endTime: new Date(document.getElementById('fe-end').value).toISOString(), durationMin: Number(document.getElementById('fe-dur').value) || 30, switchLimit: Math.max(0, Number(document.getElementById('fe-limit').value) || 0), showAnswer: document.getElementById('fe-show').checked, note: document.getElementById('fe-note').value };
    if (!body.name) return toast('考试名称不能为空', 'err');
    try { if (exam) { await api('PUT', '/api/exams/' + exam.id, body); toast('考试已更新'); } else { await api('POST', '/api/exams', body); toast('考试已发布'); } closeModal(); viewExams(); } catch (e) { toast(e.message, 'err'); }
  };
}

/* ================= 教师端：成绩统计 ================= */
async function viewStats() {
  S.exams = await api('GET', '/api/exams');
  if (!S.exams.length) { main().innerHTML = '<h2>成绩统计</h2><div class="card"><div class="empty">暂无考试。</div></div>'; return; }
  const cur = S.statsExam && S.exams.some(e => e.id === S.statsExam) ? S.statsExam : S.exams[0].id;
  S.statsExam = cur;
  const st = await api('GET', `/api/exams/${cur}/stats`);
  main().innerHTML = `<h2>成绩统计</h2>
  <div class="card"><div class="row spread"><div class="row"><span class="sub">选择考试</span>
    <select id="st-exam">${S.exams.map(e => `<option value="${e.id}" ${e.id === cur ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}</select>
    ${statusTag(st.exam.status)}<span class="sub small">试卷满分 ${st.paperTotal} 分</span></div>
    <button class="btn ghost" id="st-export">导出成绩 CSV</button></div></div>
  <div class="stat-grid mb">
    <div class="stat-box"><div class="num">${st.submitted}</div><div class="lbl">已交卷人数</div></div>
    <div class="stat-box"><div class="num">${st.avg}</div><div class="lbl">平均分</div></div>
    <div class="stat-box"><div class="num">${st.max}</div><div class="lbl">最高分</div></div>
    <div class="stat-box"><div class="num">${st.min}</div><div class="lbl">最低分</div></div>
    <div class="stat-box"><div class="num">${st.passRate}%</div><div class="lbl">及格率（≥60）</div></div>
  </div>
  ${st.pendingSheets ? `<div class="card" style="border-color:var(--warn);background:#fffbeb"><div class="row spread"><strong>待批改答卷（${st.pendingSheets} 份）</strong><span class="sub small">含主观题未批改，上方统计暂不含这几份</span></div>
    ${st.rows.filter(r => r.pending).map(r => `<div class="checkrow" style="margin-top:8px;background:#fff"><span style="flex:1">${esc(r.student)}（${esc(r.className)}）· 待批改 ${r.pending} 题 · 当前已判 ${r.score} 分</span><button class="btn small" data-grade="${r.sheetId}">去批改</button></div>`).join('')}</div>` : ''}
  <div class="card"><h3 style="margin-bottom:10px">分数分布</h3>
    ${Object.entries(st.dist).map(([k, v]) => `<div class="bar-row"><span class="bl">${k}</span><div class="bar-track"><div class="bar-fill" style="width:${(st.submitted - st.pendingSheets) ? Math.round(v / (st.submitted - st.pendingSheets) * 100) : 0}%"></div></div><span class="bv">${v} 人</span></div>`).join('')}</div>
  <div class="card"><h3 style="margin-bottom:10px">错题排行 Top 10（正确率最低在前）</h3>
    ${st.wrongTop.length ? `<table><tr><th style="width:44px">题号</th><th>题干</th><th style="width:70px">题型</th><th style="width:80px">正确率</th><th style="width:80px">平均得分</th></tr>
    ${st.wrongTop.map(w => `<tr><td>第 ${w.idx} 题</td><td class="stem-cell">${esc(w.stem)}</td><td>${TYPE_NAME[w.type] || ''}</td><td>${w.correctRate}%</td><td>${w.avgScore} / ${w.full}</td></tr>`).join('')}</table>` : '<div class="empty">暂无交卷数据。</div>'}</div>
  <div class="card"><h3 style="margin-bottom:10px">每题正确率（简答 / 编程题为平均得分率）</h3>
    <table><tr><th style="width:44px">题号</th><th>题干</th><th style="width:110px">正确率</th><th style="width:90px">平均得分</th></tr>
    ${st.perQuestion.map(w => `<tr><td>第 ${w.idx} 题</td><td class="stem-cell">${esc(w.stem)}</td><td><div class="bar-track" style="display:inline-block;width:80px;vertical-align:middle"><div class="bar-fill" style="width:${w.correctRate}%;background:${w.correctRate < 50 ? 'var(--bad)' : w.correctRate < 75 ? 'var(--warn)' : 'var(--ok)'}"></div></div> ${w.correctRate}%</td><td>${w.avgScore} / ${w.full}</td></tr>`).join('')}</table></div>
  <div class="card"><h3 style="margin-bottom:10px">知识点掌握度（按得分率从弱到强，最弱的排最前）</h3>
    ${st.byTag && st.byTag.length ? `<table><tr><th>知识点</th><th style="width:70px">题数</th><th style="width:240px">得分率</th></tr>
    ${st.byTag.map(t => `<tr><td>${esc(t.tag)}</td><td>${t.questions}</td><td><div class="bar-track" style="display:inline-block;width:140px;vertical-align:middle"><div class="bar-fill" style="width:${t.rate}%;background:${t.rate < 50 ? 'var(--bad)' : t.rate < 75 ? 'var(--warn)' : 'var(--ok)'}"></div></div> ${t.rate}%</td></tr>`).join('')}</table>` : '<div class="empty">暂无数据。</div>'}</div>
  <div class="card"><h3 style="margin-bottom:10px">班级成绩对比（仅计已完成批改的答卷）</h3>
    ${st.byClass && st.byClass.length ? `<table><tr><th>班级</th><th>人数</th><th>平均分</th><th>最高分</th><th>及格率</th></tr>
    ${st.byClass.map(c => `<tr><td>${esc(c.className)}</td><td>${c.count}</td><td><strong>${c.avg}</strong></td><td>${c.max}</td><td>${c.passRate}%</td></tr>`).join('')}</table>` : '<div class="empty">暂无数据。</div>'}</div>
  <div class="card"><h3 style="margin-bottom:10px">成绩明细</h3>
    ${st.rows.length ? `<table><tr><th>学生</th><th>班级</th><th>得分</th><th>切屏次数</th><th>交卷时间</th><th>操作</th></tr>
    ${st.rows.map(r => `<tr><td>${esc(r.student)}${r.flagged ? ' <span class="tag red">切屏超 3 次</span>' : ''}${r.submitReason === 'switch' ? ' <span class="tag red">切屏超限交卷</span>' : r.submitReason === 'timeout' ? ' <span class="tag gray">到时交卷</span>' : ''}</td><td>${esc(r.className)}</td><td><strong>${r.score}</strong>${r.pending ? ' <span class="tag orange">暂定</span>' : ''}</td><td>${r.switchCount}</td><td class="small">${fmtDT(r.submitAt)}</td><td>${r.pending ? `<button class="link" data-grade="${r.sheetId}" style="color:#ea580c;font-weight:600">批改</button>` : ''}<button class="link" data-review="${r.sheetId}">看答卷</button><button class="link danger" data-reset="${r.sheetId}">重置答卷</button></td></tr>`).join('')}</table>` : '<div class="empty">暂无交卷数据。</div>'}</div>`;
  document.getElementById('st-exam').onchange = e => { S.statsExam = e.target.value; viewStats(); };
  document.getElementById('st-export').onclick = async () => {
    const r = await fetch(`/api/exams/${cur}/export`, { headers: { Authorization: 'Bearer ' + S.token } });
    const blob = await r.blob(); const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = '成绩导出.csv'; a.click(); URL.revokeObjectURL(a.href);
    toast('CSV 已下载');
  };
  main().querySelectorAll('[data-review]').forEach(b => b.onclick = () => viewReview(b.dataset.review, 'stats'));
  main().querySelectorAll('[data-grade]').forEach(b => b.onclick = () => viewGrade(b.dataset.grade));
  main().querySelectorAll('[data-reset]').forEach(b => b.onclick = () => confirmBox('确定重置这名学生的答卷吗？该答卷将被删除，学生可重新参加本场考试（用于补考）。', async () => { try { await api('POST', `/api/sheets/${b.dataset.reset}/reset`); toast('答卷已重置，该生可重新参加考试'); viewStats(); } catch (e) { toast(e.message, 'err'); } }));
}

/* ================= 教师端：监考台 ================= */
async function viewMonitor(examId) {
  let d;
  try { d = await api('GET', `/api/exams/${examId}/monitor`); } catch (e) { toast(e.message, 'err'); return; }
  if (window.__monTimer) clearInterval(window.__monTimer);
  const keepScroll = (S.view === 'monitor' && window.__monExam === examId) ? window.scrollY : 0;
  window.__monExam = examId;
  main().innerHTML = `<div class="row spread mb"><h2 style="margin:0">监考 · ${esc(d.exam.name)}</h2><div class="row"><label class="sub small"><input type="checkbox" id="mon-auto" checked> 每 5 秒自动刷新</label><button class="btn ghost" id="mon-back">返回考试管理</button></div></div>
  <div class="stat-grid mb">
    <div class="stat-box"><div class="num">${d.entered.length}</div><div class="lbl">已进入</div></div>
    <div class="stat-box"><div class="num">${d.answering}</div><div class="lbl">答题中</div></div>
    <div class="stat-box"><div class="num">${d.submitted}</div><div class="lbl">已交卷</div></div>
    <div class="stat-box"><div class="num">${d.notEntered.length}</div><div class="lbl">未进入</div></div>
  </div>
  <div class="card"><h3 style="margin-bottom:10px">考生动态</h3>
  ${d.entered.length ? `<table><tr><th>学生</th><th>班级</th><th>状态</th><th>进度</th><th>切屏</th><th>开始时间</th><th>得分</th></tr>
  ${d.entered.map(s => `<tr><td>${esc(s.student)}（${esc(s.username)}）</td><td>${esc(s.className)}</td><td>${s.status === 'submitted' ? '<span class="tag green">已交卷</span>' : '<span class="tag orange">答题中</span>'}</td><td>${s.answered} / ${s.totalQ} 题</td><td>${s.switchCount}${s.switchCount > 3 ? ' <span class="tag red">超 3 次</span>' : ''}</td><td class="small">${fmtDT(s.startAt)}</td><td>${s.score === null ? '-' : '<strong>' + s.score + '</strong>' + (s.pending ? ' <span class="tag orange">暂定</span>' : '')}</td></tr>`).join('')}</table>` : '<div class="empty">还没有学生进入考试。</div>'}
  ${d.notEntered.length ? `<p class="sub small mt">未进入（${d.notEntered.length} 人）：${d.notEntered.map(s => esc(s.student)).join('、')}</p>` : ''}</div>`;
  if (keepScroll) window.scrollTo(0, keepScroll);
  document.getElementById('mon-back').onclick = () => { if (window.__monTimer) clearInterval(window.__monTimer); S.view = 'exams'; document.querySelectorAll('.sidebar nav button').forEach(x => x.classList.toggle('active', x.dataset.v === 'exams')); renderView(); };
  window.__monTimer = setInterval(() => { const cb = document.getElementById('mon-auto'); if (cb && cb.checked && S.view === 'monitor') viewMonitor(examId); else if (window.__monTimer) clearInterval(window.__monTimer); }, 5000);
}

function printPaper(pp) {
  const qs = pp.items.map(it => S.bank.find(q => q.id === it.qid));
  openModal(`<h3>打印试卷</h3><p>${esc(pp.name)}（${pp.items.length} 题 / 共 ${pp.total} 分）</p>
  <div class="row mt"><button class="btn" id="pr-stu">学生版（无答案）</button><button class="btn ghost" id="pr-tea">教师版（带答案解析）</button><button class="btn ghost" onclick="closeModal()">取消</button></div>`);
  const build = withAns => {
    const body = pp.items.map((it, i) => {
      const q = qs[i]; if (!q) return '';
      let inner = `<div class="q"><p><b>${i + 1}.</b>【${TYPE_NAME[q.type] || q.type} · ${it.score} 分】${esc(q.stem)}</p>`;
      if (q.type === 'single' || q.type === 'multi') inner += q.options.map(o => `<p class="opt">${o.k}. ${esc(o.t)}</p>`).join('');
      else if (q.type === 'fill') inner += `<p class="opt">（ ${(Array.isArray(q.answer) ? q.answer : []).map(() => '＿＿＿＿＿＿').join('　')} ）</p>`;
      else if (q.type === 'essay') inner += `<div class="essay"></div>`;
      else if (q.type === 'code') inner += `<p class="opt">编程语言：${LANG_NAME[q.language] || q.language || ''} · 共 ${(q.cases || []).length} 个测试用例 · 请在下方空白处写出完整代码</p><div class="essay" style="height:180px"></div>`;
      if (withAns) inner += `<p class="ans">${q.type === 'code' ? '参考代码' : '答案'}：${esc(ansText(q, q.answer))}<br>解析：${esc(q.analysis || '—')}</p>`;
      return inner + '</div>';
    }).join('');
    const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>${esc(pp.name)}</title><style>body{font-family:'Microsoft YaHei',sans-serif;margin:36px;color:#111}h1{text-align:center;font-size:22px}.meta{text-align:center;color:#444;margin:8px 0 4px}.info{display:flex;justify-content:space-between;border-bottom:2px solid #111;padding:10px 2px;margin-bottom:14px}.q{margin:16px 0;page-break-inside:avoid}.opt{margin:4px 0 4px 22px}.ans{color:#065f46;background:#f0fdf4;padding:6px 10px;border-radius:6px;margin-top:6px;line-height:1.7;white-space:pre-wrap}.essay{height:110px;border:1px solid #bbb;border-radius:4px;margin-top:8px}</style></head><body><h1>${esc(pp.name)}</h1><div class="meta">${esc(pp.subject || '')} · 共 ${pp.items.length} 题 · 满分 ${pp.total} 分${withAns ? ' · 教师版（含答案解析）' : ''}</div><div class="info"><span>姓名：＿＿＿＿＿＿</span><span>班级：＿＿＿＿＿＿</span><span>学号：＿＿＿＿＿＿</span><span>得分：＿＿＿＿</span></div>${body}</body></html>`;
    const w2 = window.open('', '_blank');
    if (!w2) { toast('浏览器拦截了新窗口，请允许弹窗后重试', 'warn'); return; }
    w2.document.write(html); w2.document.close(); w2.focus();
    setTimeout(() => { try { w2.print(); } catch (e) {} }, 400);
    closeModal();
  };
  document.getElementById('pr-stu').onclick = () => build(false);
  document.getElementById('pr-tea').onclick = () => build(true);
}

/* ================= 教师端：批改主观题 ================= */
async function viewGrade(sheetId) {
  let r;
  try { r = await api('GET', `/api/sheets/${sheetId}/review`); } catch (e) { toast(e.message, 'err'); return; }
  let aiOn = false; try { aiOn = (await api('GET', '/api/ai/status')).enabled; } catch (e) { /* AI 状态拉取失败不影响批改 */ }
  const essays = r.items.map((it, i) => ({ ...it, idx: i })).filter(it => it.type === 'essay');
  main().innerHTML = `<div class="row spread mb"><h2 style="margin:0">批改答卷 · ${esc(r.examName)}</h2><button class="btn ghost" id="gr-back">返回统计</button></div>
  <div class="card"><div class="row spread"><span>考生：<strong>${esc(r.student)}</strong></span><span>当前总分 <strong style="font-size:18px;color:var(--primary-d)">${r.score}</strong> 分（保存批改后自动更新）</span></div></div>
  ${essays.length ? essays.map(it => `<div class="card"><div class="row spread"><span class="tag">简答</span><span class="sub">满分 ${it.full} 分 · ${it.pending ? '待批改' : '已批改 ' + it.score + ' 分'}</span></div>
    <p style="margin:10px 0;line-height:1.7"><strong>${it.idx + 1}.</strong> ${esc(it.stem)}</p>
    <p class="sub small">学生答案：</p><p style="line-height:1.7;white-space:pre-wrap">${esc(it.myAnswer || '（未作答）')}</p>
    <p class="sub small mt">参考答案：${esc(it.answer || '')}</p>
    <p class="sub small">评分要点：${esc(it.analysis || '—')}</p>
    <div class="row mt"><label>得分 <input type="number" min="0" max="${it.full}" step="0.5" value="${it.pending ? '' : it.score}" data-gscore="${it.qid}" style="width:90px"></label>
    <label style="flex:1">评语 <input type="text" value="${esc(it.comment || '')}" data-gcomment="${it.qid}" placeholder="给学生的评语（可选）" style="width:100%"></label></div>
    ${aiOn ? `<div class="row mt"><button class="btn ai small" data-ai="${it.qid}" type="button">AI 辅助批改</button><span class="sub small">AI 按参考答案与评分要点给出建议分和评语，教师确认后保存才生效</span></div><div id="ai-${it.qid}"></div>` : ''}</div>`).join('') : '<div class="card"><div class="empty">这份答卷没有主观题。</div></div>'}
  ${essays.length ? '<div class="row" style="justify-content:flex-end"><button class="btn" id="gr-save">保存批改</button></div>' : ''}`;
  document.getElementById('gr-back').onclick = () => { S.view = 'stats'; document.querySelectorAll('.sidebar nav button').forEach(x => x.classList.toggle('active', x.dataset.v === 'stats')); renderView(); };
  const sv = document.getElementById('gr-save');
  if (sv) sv.onclick = async () => {
    const grades = essays.map(it => ({ qid: it.qid, score: document.querySelector(`[data-gscore="${it.qid}"]`).value, comment: document.querySelector(`[data-gcomment="${it.qid}"]`).value }));
    if (grades.some(g => g.score === '')) return toast('每道主观题都要给分（未作答给 0 分）', 'warn');
    try { const r2 = await api('POST', `/api/sheets/${sheetId}/grade`, { grades: grades.map(g => ({ ...g, score: Number(g.score) })) }); toast(`批改已保存，该生总分更新为 ${r2.score} 分`); S.view = 'stats'; document.querySelectorAll('.sidebar nav button').forEach(x => x.classList.toggle('active', x.dataset.v === 'stats')); renderView(); }
    catch (e) { toast(e.message, 'err'); }
  };
  main().querySelectorAll('[data-ai]').forEach(b => b.onclick = async () => {
    const qid = b.dataset.ai; const box = document.getElementById('ai-' + qid);
    b.disabled = true; b.textContent = 'AI 批改中…';
    try {
      const s = await api('POST', '/api/ai/grade-suggest', { sheetId, qid });
      box.innerHTML = `<div class="ai-box"><strong>AI 建议：${s.score} 分</strong><p style="margin-top:4px;line-height:1.7">${esc(s.comment)}</p><button class="btn small mt" data-adopt="1">采用建议（填入得分与评语）</button></div>`;
      box.querySelector('[data-adopt]').onclick = () => { document.querySelector(`[data-gscore="${qid}"]`).value = s.score; document.querySelector(`[data-gcomment="${qid}"]`).value = s.comment; toast('已填入 AI 建议，可再修改后保存批改'); };
    } catch (e) { box.innerHTML = `<span class="mine-bad">${esc(e.message)}</span>`; }
    b.disabled = false; b.textContent = 'AI 辅助批改';
  });
}

/* ================= 学生端 ================= */
async function viewExamList() {
  S.exams = await api('GET', '/api/exams');
  main().innerHTML = `<h2>参加考试</h2>
  ${S.exams.length ? S.exams.map(e => {
    let action = '';
    if (e.mySheet && e.mySheet.status === 'submitted') action = `<span class="tag green">已交卷 · ${e.mySheet.score} 分</span> <button class="btn ghost small" data-review="${e.mySheet.id}">查看回顾</button>`;
    else if (e.status === '已停止') action = '<span class="sub">考试已停止</span>';
    else if (e.status === '未开始') action = '<span class="sub">未到开始时间</span>';
    else if (e.status === '已结束') action = '<span class="sub">已结束</span>';
    else if (e.mySheet) action = `<button class="btn" data-start="${e.id}">继续答题</button>`;
    else action = `<button class="btn" data-start="${e.id}">开始考试</button>`;
    return `<div class="card"><div class="row spread"><div><strong>${esc(e.name)}</strong> ${statusTag(e.status)}<div class="sub small mt">时间窗口：${fmtDT(e.startTime)} ~ ${fmtDT(e.endTime)} · 时长 ${e.durationMin} 分钟<br>${esc(e.note || '')}</div></div><div class="row">${action}</div></div></div>`;
  }).join('') : '<div class="card"><div class="empty">暂无考试安排。</div></div>'}`;
  main().querySelectorAll('[data-start]').forEach(b => b.onclick = () => startExam(b.dataset.start));
  main().querySelectorAll('[data-review]').forEach(b => b.onclick = () => viewReview(b.dataset.review, 'examlist'));
}

let EX = null; // 考试进行态
async function startExam(examId) {
  let d;
  try { d = await api('POST', `/api/exams/${examId}/start`); }
  catch (e) { toast(e.message, 'err'); return; }
  EX = { ...d, idx: 0, answers: JSON.parse(JSON.stringify(d.answers || {})), marked: new Set(d.marked || []), switchCount: d.switchCount || 0, submitted: false, stopping: false, warned5: false, saveTimer: null, lastSwitchAt: 0 };
  S.view = 'taking';
  document.querySelectorAll('.sidebar nav button').forEach(x => x.classList.remove('active'));
  renderTaking();
  window.__examTimer = setInterval(tickCountdown, 500); tickCountdown();
  window.__examStatusTimer = setInterval(checkExamStatus, 3000);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('blur', onBlur);
}
function cleanupExam() {
  if (window.__examTimer) clearInterval(window.__examTimer);
  if (window.__examStatusTimer) clearInterval(window.__examStatusTimer);
  document.removeEventListener('visibilitychange', onVisibility);
  window.removeEventListener('blur', onBlur);
}
async function checkExamStatus() {
  if (!EX || EX.submitted) return;
  try {
    const r = await api('GET', `/api/sheets/${EX.sheetId}/status`);
    if (r.stopping && !EX.stopping) { EX.stopping = true; clearTimeout(EX.saveTimer); toast('教师已停止考试，系统正在封存答卷', 'warn'); }
    if (r.status !== 'submitted') return;
    EX.submitted = true;
    cleanupExam();
    renderScoreResult({ score: r.score, pending: r.pending, rank: null, total: 0, showAnswer: r.showAnswer, sheetId: r.sheetId }, r.submitReason === 'stopped' ? 'stopped' : r.submitReason);
  } catch {}
}
function onVisibility() { if (document.hidden) noteSwitch(); }
function onBlur() { noteSwitch(); }
function noteSwitch() {
  if (!EX || EX.submitted || EX.stopping) return;
  const t = Date.now(); if (t - EX.lastSwitchAt < 1200) return; EX.lastSwitchAt = t;
  EX.switchCount++;
  const el = document.getElementById('sw-count'); if (el) el.textContent = EX.switchCount;
  const limit = EX.exam.switchLimit || 0;
  if (limit > 0 && EX.switchCount > limit) { toast(`切屏已达 ${EX.switchCount} 次，超过上限 ${limit} 次，系统自动交卷`, 'err'); forceSubmitBySwitch(); return; }
  toast(limit > 0 ? `已记录一次切屏（累计 ${EX.switchCount} 次，本场上限 ${limit} 次）` : `已记录一次切屏（累计 ${EX.switchCount} 次），超过 3 次将标注提醒`, 'warn');
  saveProgress();
}
function saveProgress() {
  if (!EX || EX.submitted || EX.stopping) return;
  clearTimeout(EX.saveTimer);
  EX.saveTimer = setTimeout(() => { api('POST', `/api/sheets/${EX.sheetId}/progress`, { answers: EX.answers, marked: [...EX.marked], switchCount: EX.switchCount }).catch(() => {}); }, 300);
}
function tickCountdown() {
  if (!EX || EX.submitted || EX.stopping) return;
  const el = document.getElementById('cd');
  const remain = EX.deadline - Date.now();
  if (remain <= 0) { if (el) el.textContent = '00:00'; toast('考试时间到，系统自动交卷', 'warn'); submitExam(true, 'timeout'); return; }
  const mm = String(Math.floor(remain / 60000)).padStart(2, '0'), ss = String(Math.floor(remain % 60000 / 1000)).padStart(2, '0');
  if (el) { el.textContent = `${mm}:${ss}`; el.classList.toggle('low', remain <= 5 * 60000); }
  if (remain <= 5 * 60000 && !EX.warned5) { EX.warned5 = true; toast('注意：距离考试结束不足 5 分钟', 'warn'); }
}
function isAnswered(q) { const a = EX.answers[q.id]; return !(a === undefined || a === null || a === '' || (Array.isArray(a) && (!a.length || a.every(x => String(x).trim() === '')))); }
function renderTaking() {
  const q = EX.questions[EX.idx];
  main().innerHTML = `<div class="row spread mb"><h2 style="margin:0">${esc(EX.exam.name)}</h2>
    <div class="row"><span class="sub">剩余时间</span><span class="countdown" id="cd">--:--</span><span class="sub small">切屏次数：<span id="sw-count">${EX.switchCount}</span></span></div></div>
  <div class="exam-layout">
    <div class="card answer-card"><strong>答题卡</strong><div class="sub small">共 ${EX.questions.length} 题 · 满分 ${EX.total} 分</div>
      <div class="ac-grid">${EX.questions.map((x, i) => `<button class="ac-cell ${isAnswered(x) ? 'done' : ''} ${i === EX.idx ? 'cur' : ''} ${EX.marked.has(x.id) ? 'marked' : ''}" data-jump="${i}">${i + 1}</button>`).join('')}</div>
      <div class="sub small mt">蓝色 = 已答 · 橙点 = 已标记</div>
      <button class="btn danger mt" style="width:100%" id="btn-submit">交 卷</button></div>
    <div class="card exam-main" id="q-area"></div>
  </div>`;
  main().querySelectorAll('[data-jump]').forEach(b => b.onclick = () => { EX.idx = Number(b.dataset.jump); renderTaking(); });
  document.getElementById('btn-submit').onclick = () => submitExam(false);
  renderQuestion();
}
function renderQuestion() {
  const q = EX.questions[EX.idx];
  const area = document.getElementById('q-area'); if (!area) return;
  const a = EX.answers[q.id];
  let bodyHtml = '';
  if (q.type === 'single' || q.type === 'multi') {
    bodyHtml = `<div class="q-options">` + q.options.map(o => {
      const sel = q.type === 'single' ? a === o.k : Array.isArray(a) && a.includes(o.k);
      return `<div class="q-opt ${sel ? 'sel' : ''}" data-opt="${o.k}"><span class="k">${o.k}</span><span>${esc(o.t)}</span></div>`;
    }).join('') + '</div>';
  } else if (q.type === 'judge') {
    bodyHtml = `<div class="q-options">${[['true', '正确'], ['false', '错误']].map(([v, t]) => `<div class="q-opt ${a === v ? 'sel' : ''}" data-opt="${v}"><span>${t}</span></div>`).join('')}</div>`;
  } else if (q.type === 'essay') {
    bodyHtml = `<textarea class="fill-input" id="essay-input" rows="6" placeholder="在此输入你的答案（交卷后由教师批改）">${esc(typeof a === 'string' ? a : '')}</textarea>`;
  } else if (q.type === 'code') {
    bodyHtml = `<div class="row spread" style="margin:12px 0 8px"><span class="tag">${LANG_NAME[q.language] || q.language || ''}</span><span class="sub small">共 ${q.caseCount || 0} 个测试用例 · 「运行测试」只自查不计分，交卷时自动判分</span><button class="btn small ai" id="btn-run" type="button">▶ 运行测试</button></div>
    <textarea class="code-editor" id="code-input" rows="14" spellcheck="false" placeholder="在这里编写代码">${esc(typeof a === 'string' && a ? a : (q.template || ''))}</textarea>
    <div id="run-result" class="mt"></div>`;
  } else {
    const vals = Array.isArray(a) ? a : (a ? [a] : []);
    bodyHtml = Array.from({ length: Math.max(1, q.blanks || 1) }, (_, i) => `<input class="fill-input" data-blank="${i}" placeholder="第 ${i + 1} 空答案" value="${esc(vals[i] || '')}">`).join('');
  }
  area.innerHTML = `<div class="row spread"><span class="tag">${TYPE_NAME[q.type]}</span><span class="sub">第 ${EX.idx + 1} / ${EX.questions.length} 题 · ${q.score} 分</span></div>
  <p style="font-size:16px;line-height:1.7;margin-top:12px;white-space:pre-wrap">${esc(q.stem)}</p>${bodyHtml}
  <div class="row spread mt"><button class="btn ghost" id="q-prev" ${EX.idx === 0 ? 'disabled' : ''}>上一题</button>
    <button class="btn ghost" id="q-mark">${EX.marked.has(q.id) ? '取消标记' : '标记本题'}</button>
    <button class="btn ghost" id="q-next" ${EX.idx === EX.questions.length - 1 ? 'disabled' : ''}>下一题</button></div>`;
  area.querySelectorAll('[data-opt]').forEach(el => el.onclick = () => {
    const v = el.dataset.opt;
    if (q.type === 'single' || q.type === 'judge') EX.answers[q.id] = v;
    else { const cur = new Set(Array.isArray(EX.answers[q.id]) ? EX.answers[q.id] : []); cur.has(v) ? cur.delete(v) : cur.add(v); EX.answers[q.id] = [...cur].sort(); }
    saveProgress(); renderTaking();
  });
  area.querySelectorAll('[data-blank]').forEach(inp => inp.addEventListener('change', () => {
    const arr = Array.isArray(EX.answers[q.id]) ? [...EX.answers[q.id]] : [];
    arr[Number(inp.dataset.blank)] = inp.value; EX.answers[q.id] = arr; saveProgress(); renderTaking();
  }));
  const ei = area.querySelector('#essay-input');
  if (ei) ei.addEventListener('change', () => { EX.answers[q.id] = ei.value; saveProgress(); renderTaking(); });
  const ci = area.querySelector('#code-input');
  if (ci) {
    ci.addEventListener('input', () => { EX.answers[q.id] = ci.value; saveProgress(); });
    ci.addEventListener('keydown', e => { if (e.key === 'Tab') { e.preventDefault(); const s = ci.selectionStart; ci.value = ci.value.slice(0, s) + '  ' + ci.value.slice(ci.selectionEnd); ci.selectionStart = ci.selectionEnd = s + 2; EX.answers[q.id] = ci.value; } });
    const rb = area.querySelector('#btn-run');
    if (rb) rb.onclick = async () => {
      EX.answers[q.id] = ci.value; saveProgress();
      rb.disabled = true; rb.textContent = '运行中…';
      const box = document.getElementById('run-result');
      try { const r = await api('POST', `/api/sheets/${EX.sheetId}/run`, { qid: q.id, code: ci.value }); box.innerHTML = judgeHtml(r.judge); }
      catch (e) { box.innerHTML = `<span class="mine-bad">${esc(e.message)}</span>`; }
      rb.disabled = false; rb.textContent = '▶ 运行测试';
    };
  }
  document.getElementById('q-prev').onclick = () => { EX.idx--; renderTaking(); };
  document.getElementById('q-next').onclick = () => { EX.idx++; renderTaking(); };
  document.getElementById('q-mark').onclick = () => { EX.marked.has(q.id) ? EX.marked.delete(q.id) : EX.marked.add(q.id); saveProgress(); renderTaking(); };
}
function renderScoreResult(r, mode) {
  const title = mode === 'stopped' ? '教师已停止考试，系统已封卷' : mode === 'switch' ? '切屏次数超过上限，系统已自动交卷' : mode === 'timeout' ? '时间到，已自动交卷' : '交卷成功';
  main().innerHTML = `<div class="card" style="text-align:center;padding:44px 20px">
    <div class="sub">${title} · ${esc(EX.exam.name)}</div>
    <div class="score-big" style="margin:14px 0">${r.score} 分</div>
    ${r.pending ? `<div style="color:#ea580c">其中主观题 ${r.pending} 道待教师批改，上方为已判部分得分，最终成绩以批改后为准</div>` : r.rank ? `<div class="sub">满分 ${EX.total} 分 · 本次共 ${r.total} 份已出分答卷，你目前排第 ${r.rank} 名</div>` : `<div class="sub">满分 ${EX.total} 分</div>`}
    <div class="row mt" style="justify-content:center">
      ${r.showAnswer ? `<button class="btn" id="rs-review">查看逐题回顾</button>` : ''}
      <button class="btn ghost" id="rs-back">返回考试列表</button></div></div>`;
  const rb = document.getElementById('rs-review'); if (rb) rb.onclick = () => viewReview(r.sheetId, 'examlist');
  document.getElementById('rs-back').onclick = () => { S.view = 'examlist'; document.querySelectorAll('.sidebar nav button').forEach(x => x.classList.toggle('active', x.dataset.v === 'examlist')); renderView(); };
}
async function forceSubmitBySwitch() {
  if (!EX || EX.submitted) return;
  try {
    const r = await api('POST', `/api/sheets/${EX.sheetId}/progress`, { answers: EX.answers, marked: [...EX.marked], switchCount: EX.switchCount });
    if (r && r.forceSubmitted) { EX.submitted = true; cleanupExam(); renderScoreResult({ score: r.score, pending: r.pending, rank: null, total: 0, showAnswer: r.showAnswer, sheetId: EX.sheetId }, 'switch'); return; }
  } catch (e) { /* 兜底走普通提交 */ }
  submitExam(true, 'switch');
}
async function submitExam(auto, reason) {
  if (!EX || EX.submitted || EX.stopping) return;
  const un = EX.questions.filter(q => !isAnswered(q)).length;
  const doSubmit = async () => {
    try {
      const r = await api('POST', `/api/sheets/${EX.sheetId}/submit`, { answers: EX.answers, switchCount: EX.switchCount, reason: auto ? (reason || 'timeout') : 'manual' });
      EX.submitted = true; cleanupExam();
      renderScoreResult(r, auto ? (reason || 'timeout') : 'manual');
    } catch (e) { toast(e.message, 'err'); }
  };
  if (auto) return doSubmit();
  openModal(`<h3>确认交卷</h3><p>${un ? `还有 <strong style="color:var(--bad)">${un}</strong> 道题未作答，` : '全部题目已作答，'}交卷后不能再修改。确定交卷吗？</p>
  <div class="row mt" style="justify-content:flex-end"><button class="btn ghost" onclick="closeModal()">继续答题</button><button class="btn danger" id="sb-yes">确认交卷</button></div>`);
  document.getElementById('sb-yes').onclick = () => { closeModal(); doSubmit(); };
}
async function viewMyScores() {
  const list = await api('GET', '/api/my/scores');
  main().innerHTML = `<h2>我的成绩</h2>
  ${list.length ? `<div class="card"><table><tr><th>考试</th><th>得分</th><th>排名</th><th>切屏次数</th><th>交卷时间</th><th>操作</th></tr>
  ${list.map(s => `<tr><td><strong>${esc(s.examName)}</strong></td><td><strong>${s.score}</strong> / ${s.total}${s.pending ? ' <span class="tag orange">暂定</span>' : ''}</td><td>${s.pending ? '<span class="tag orange">主观题待批改</span>' : `第 ${s.rank} / ${s.rankTotal} 名`}</td><td>${s.switchCount}${s.switchCount > 3 ? ' <span class="tag red">超 3 次</span>' : ''}</td><td class="small">${fmtDT(s.submitAt)}</td><td><button class="link" data-review="${s.sheetId}">逐题回顾</button></td></tr>`).join('')}</table></div>`
  : '<div class="card"><div class="empty">还没有成绩，去“参加考试”完成一场考试吧。</div></div>'}`;
  main().querySelectorAll('[data-review]').forEach(b => b.onclick = () => viewReview(b.dataset.review, 'myscores'));
}
async function viewReview(sheetId, backView) {
  let r;
  try { r = await api('GET', `/api/sheets/${sheetId}/review`); } catch (e) { toast(e.message, 'err'); return; }
  let aiOn = false; try { aiOn = (await api('GET', '/api/ai/status')).enabled; } catch (e) { /* AI 状态拉取失败不影响回顾 */ }
  cleanupExam();
  main().innerHTML = `<div class="row spread mb"><h2 style="margin:0">答卷回顾 · ${esc(r.examName)}</h2><button class="btn ghost" id="rv-back">返回</button></div>
  <div class="card"><div class="row spread"><span>考生：<strong>${esc(r.student)}</strong> · 切屏 ${r.switchCount} 次</span><span>得分 <strong style="font-size:20px;color:var(--primary-d)">${r.score}</strong> 分 · 交卷于 ${fmtDT(r.submitAt)}</span></div>
  ${r.showAnswer ? '' : '<div class="sub small mt">本题考试未开启“交卷后展示答案”，仅显示对错与得分。</div>'}</div>
  ${r.items.map((it, i) => `<div class="card review-item"><div class="row spread"><span class="tag">${TYPE_NAME[it.type] || ''}</span>
    ${it.pending ? '<span style="color:#ea580c;font-weight:600">◔ 主观题待教师批改</span>' : `<span class="${it.correct ? 'mine-ok' : 'mine-bad'}">${it.correct ? '✓ 回答正确' : it.score > 0 ? '◐ 部分得分' : '✗ 回答错误'} · ${it.score} / ${it.full} 分</span>`}</div>
    <p style="margin:10px 0;line-height:1.7;white-space:pre-wrap"><strong>${i + 1}.</strong> ${esc(it.stem)}</p>
    ${it.type === 'essay' ? `<p class="sub small">我的答案：</p><p style="line-height:1.7;white-space:pre-wrap">${esc(it.myAnswer || '（未作答）')}</p>` : it.type === 'code' ? `<p class="sub small">我的代码（${LANG_NAME[it.language] || ''}）：</p><pre class="code-view">${esc(it.myAnswer || '（未作答）')}</pre>${judgeHtml(it.judge)}` : `<p>我的答案：<span class="${it.correct ? 'mine-ok' : 'mine-bad'}">${esc(ansText(it, it.myAnswer))}</span></p>`}
    ${it.comment ? `<p class="mt" style="color:var(--primary-d)">教师评语：${esc(it.comment)}</p>` : ''}
    ${r.showAnswer ? (it.type === 'code' ? `<p class="mt sub small">参考代码：</p><pre class="code-view">${esc(it.answer || '')}</pre><p class="sub small mt">解题思路：${esc(it.analysis || '—')}</p>` : `<p class="mt">${it.type === 'essay' ? '参考答案' : '正确答案'}：<span class="mine-ok">${esc(ansText(it, it.answer))}</span></p><p class="sub small mt">${it.type === 'essay' ? '评分要点' : '解析'}：${esc(it.analysis || '—')}</p>`) : ''}
    ${r.showAnswer && aiOn ? `<div class="row mt" style="justify-content:flex-end"><button class="btn ai small" data-explain="${i}">AI 讲解这道题</button></div><div id="explain-${i}" class="mt"></div>` : ''}
  </div>`).join('')}`;
  document.getElementById('rv-back').onclick = () => { S.view = backView; document.querySelectorAll('.sidebar nav button').forEach(x => x.classList.toggle('active', x.dataset.v === backView)); renderView(); };
  main().querySelectorAll('[data-explain]').forEach(b => b.onclick = async () => {
    const it = r.items[Number(b.dataset.explain)];
    const box = document.getElementById('explain-' + b.dataset.explain);
    b.disabled = true; b.textContent = 'AI 讲解生成中…';
    try { const r2 = await api('POST', '/api/ai/explain', { sheetId, qid: it.qid }); box.innerHTML = `<div class="ai-box"><strong>AI 讲解</strong><p style="white-space:pre-wrap;line-height:1.8;margin-top:6px">${esc(r2.text)}</p></div>`; }
    catch (e) { box.innerHTML = `<span class="mine-bad">${esc(e.message)}</span>`; }
    b.disabled = false; b.textContent = 'AI 讲解这道题';
  });
}

/* ================= 学生端：错题本 ================= */
async function viewWrongbook() {
  const items = await api('GET', '/api/my/wrongbook');
  S.wrongItems = items;
  main().innerHTML = `<h2>错题本</h2>
  <div class="card"><span class="sub" style="line-height:1.8">收录你在已交卷考试中答错或未答满分的题目（仅限老师开启了答案展示的考试）。客观题可点“重练”即时判分，答对后自动移出错题本；简答题对照参考答案与评分要点自查。</span></div>
  ${items.length ? items.map((it, i) => `<div class="card review-item"><div class="row spread"><span><span class="tag">${TYPE_NAME[it.type] || ''}</span> <span class="sub small">${esc(it.examName)}</span></span><span class="mine-bad">得 ${it.myScore} / ${it.full} 分</span></div>
    <p style="margin:10px 0;line-height:1.7">${esc(it.stem)}</p>
    ${it.type === 'essay' ? `<p class="sub small">我的答案：</p><p style="line-height:1.7;white-space:pre-wrap">${esc(it.myAnswer || '（未作答）')}</p><p class="mt">参考答案：<span class="mine-ok">${esc(it.answer)}</span></p><p class="sub small mt">评分要点：${esc(it.analysis || '—')}</p>${it.comment ? `<p class="mt" style="color:var(--primary-d)">教师评语：${esc(it.comment)}</p>` : ''}` : it.type === 'code' ? `<p class="sub small">我的代码（${LANG_NAME[it.language] || ''}）：</p><pre class="code-view">${esc(it.myAnswer || '（未作答）')}</pre>${judgeHtml(it.judge)}<p class="mt sub small">参考代码：</p><pre class="code-view">${esc(it.answer || '')}</pre><p class="sub small mt">解题思路：${esc(it.analysis || '—')}</p>` : `<p>我的答案：<span class="mine-bad">${esc(ansText(it, it.myAnswer))}</span></p><p class="mt">正确答案：<span class="mine-ok">${esc(ansText(it, it.answer))}</span></p><p class="sub small mt">解析：${esc(it.analysis || '—')}</p>`}
    <div class="row mt" style="justify-content:flex-end">${it.type === 'essay' ? '' : `<button class="btn small" data-practice="${i}">重练这道题</button>`}<button class="btn ghost small" data-dismiss="${esc(it.key)}">移出错题本</button></div></div>`).join('') : '<div class="card"><div class="empty">错题本是空的，继续保持。</div></div>'}`;
  main().querySelectorAll('[data-dismiss]').forEach(b => b.onclick = async () => { try { await api('POST', `/api/my/wrongbook/${encodeURIComponent(b.dataset.dismiss)}/dismiss`); toast('已移出'); viewWrongbook(); } catch (e) { toast(e.message, 'err'); } });
  main().querySelectorAll('[data-practice]').forEach(b => b.onclick = () => practiceModal(S.wrongItems[Number(b.dataset.practice)]));
}
function practiceModal(it) {
  let cur = it.type === 'multi' ? [] : null;
  let bodyHtml = '';
  if (it.type === 'single' || it.type === 'multi') {
    bodyHtml = `<div class="q-options">${it.options.map(o => `<div class="q-opt" data-opt="${o.k}"><span class="q-letter">${o.k}</span><span>${esc(o.t)}</span></div>`).join('')}</div>`;
  } else if (it.type === 'judge') {
    bodyHtml = `<div class="q-options">${[['true', '正确'], ['false', '错误']].map(([v, t]) => `<div class="q-opt" data-opt="${v}"><span>${t}</span></div>`).join('')}</div>`;
  } else if (it.type === 'fill') {
    const n = Array.isArray(it.answer) ? it.answer.length : 1;
    bodyHtml = Array.from({ length: n }, (_, i) => `<input class="fill-input" data-pblank="${i}" placeholder="第 ${i + 1} 空" style="margin-bottom:8px">`).join('');
  } else if (it.type === 'code') {
    bodyHtml = `<textarea class="code-editor" id="pr-code" rows="12" spellcheck="false">${esc(typeof it.myAnswer === 'string' && it.myAnswer ? it.myAnswer : (it.template || ''))}</textarea><p class="sub small mt">共 ${it.caseCount || 0} 个测试用例，提交后重新判题，按用例通过比例计分；全部通过自动移出错题本。</p>`;
  }
  openModal(`<h3>错题重练 · ${TYPE_NAME[it.type]}（${it.full} 分）</h3>
  <p style="margin:10px 0;line-height:1.7">${esc(it.stem)}</p>${bodyHtml}
  <div id="pr-result" class="mt" style="line-height:1.8"></div>
  <div class="row" style="justify-content:flex-end"><button class="btn ghost" onclick="closeModal()">关闭</button><button class="btn" id="pr-check">提交判分</button></div>`, true);
  const box = document.querySelector('.modal');
  box.querySelectorAll('[data-opt]').forEach(el => el.onclick = () => {
    const v = el.dataset.opt;
    if (it.type === 'multi') { cur = cur.includes(v) ? cur.filter(x => x !== v) : [...cur, v]; el.classList.toggle('sel'); }
    else { cur = v; box.querySelectorAll('[data-opt]').forEach(x => x.classList.toggle('sel', x === el)); }
  });
  document.getElementById('pr-check').onclick = async () => {
    let ans = cur;
    if (it.type === 'fill') ans = [...box.querySelectorAll('[data-pblank]')].map(i => i.value);
    if (it.type === 'code') ans = document.getElementById('pr-code').value;
    if (ans === null || ans === '' || (Array.isArray(ans) && !ans.length)) return toast('先作答再提交', 'warn');
    try {
      const r = await api('POST', '/api/my/wrongbook/practice', { key: it.key, qid: it.qid, answer: ans });
      const res = document.getElementById('pr-result');
      if (r.correct) {
        await api('POST', `/api/my/wrongbook/${encodeURIComponent(it.key)}/dismiss`);
        res.innerHTML = `<span class="mine-ok">✓ 答对了，已自动移出错题本。</span>${it.type === 'code' ? judgeHtml(r.judge) : ''}<br><span class="sub small">解析：${esc(r.analysis || '—')}</span>`;
        toast('答对了，错题已移出');
      } else if (it.type === 'code') {
        res.innerHTML = `<span class="mine-bad">✗ 还没全对（得 ${r.score} / ${it.full} 分）。</span>${judgeHtml(r.judge)}<span class="sub small">解题思路：${esc(r.analysis || '—')}</span>`;
      } else {
        res.innerHTML = `<span class="mine-bad">✗ 还不对（得 ${r.score} / ${it.full} 分）。</span><br>正确答案：<span class="mine-ok">${esc(ansText(it, r.answer))}</span><br><span class="sub small">解析：${esc(r.analysis || '—')}</span>`;
      }
    } catch (e) { toast(e.message, 'err'); }
  };
}

/* ================= 学生端：自主练习 ================= */
let PR = null;
async function viewPractice() {
  let opts;
  try { opts = await api('GET', '/api/practice/options'); } catch (e) { toast(e.message, 'err'); return; }
  main().innerHTML = `<h2>自主练习</h2>
  <div class="card"><div class="row">
    <label>题型 <select id="pr-type"><option value="">全部题型</option>${opts.types.map(t => `<option value="${t}">${TYPE_NAME[t]}</option>`).join('')}</select></label>
    <label>知识点 <select id="pr-tag"><option value="">全部知识点</option>${opts.tags.map(t => `<option>${esc(t)}</option>`).join('')}</select></label>
    <label>题量 <select id="pr-count">${[5, 10, 15, 20].map(n => `<option ${n === 10 ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
    <button class="btn" id="pr-start" ${opts.total ? '' : 'disabled'}>开始练习</button></div>
  <p class="sub small mt">${opts.total ? '从题库随机抽题（不含简答题及未开始或进行中的考试题），答完统一提交、即时判分并显示答案与解析；练习成绩不计入正式考试统计。编程题可先「运行测试」自查再提交。' : '未开始或进行中的考试已覆盖题库中的练习题，考试结束后可再进行自主练习。'}</p></div>
  <div id="pr-area"></div>`;
  document.getElementById('pr-start').onclick = startPractice;
}
async function startPractice() {
  let d;
  try { d = await api('POST', '/api/practice/start', { type: document.getElementById('pr-type').value, tag: document.getElementById('pr-tag').value, count: Number(document.getElementById('pr-count').value) }); }
  catch (e) { toast(e.message, 'err'); return; }
  PR = { sessionId: d.sessionId, questions: d.questions, answers: {} };
  const area = document.getElementById('pr-area');
  area.innerHTML = d.questions.map((q, i) => `<div class="card review-item"><div class="row spread"><span class="tag">${TYPE_NAME[q.type]}</span><span class="sub">第 ${i + 1} 题 · ${q.score} 分${q.tag ? ' · ' + esc(q.tag) : ''}</span></div>
  <p style="margin:10px 0;line-height:1.7;white-space:pre-wrap">${esc(q.stem)}</p><div data-prq="${q.id}"></div><div id="pr-res-${q.id}" class="mt"></div></div>`).join('') +
  `<div class="row" style="justify-content:flex-end"><span id="pr-summary" style="margin-right:auto"></span><button class="btn" id="pr-submit">提交判分</button><button class="btn ghost" id="pr-again" style="display:none">再来一组</button></div>`;
  d.questions.forEach(q => renderPracticeQ(q));
  document.getElementById('pr-again').onclick = startPractice;
  document.getElementById('pr-submit').onclick = async () => {
    try {
      const r = await api('POST', '/api/practice/submit', { sessionId: PR.sessionId, items: PR.questions.map(q => ({ qid: q.id, answer: PR.answers[q.id] })) });
      const byQ = Object.fromEntries(r.results.map(x => [x.qid, x]));
      PR.questions.forEach(q => {
        const res = byQ[q.id]; if (!res) return;
        const box = document.getElementById('pr-res-' + q.id);
        box.innerHTML = `<p class="${res.correct ? 'mine-ok' : 'mine-bad'}">${res.correct ? '✓ 回答正确' : '✗ 得 ' + res.score + ' / ' + res.full + ' 分'}</p>` +
          (q.type === 'code' ? `${judgeHtml(res.judge)}<p class="sub small mt">参考代码：</p><pre class="code-view">${esc(res.answer || '')}</pre>` : `<p>正确答案：<span class="mine-ok">${esc(ansText(q, res.answer))}</span></p>`) +
          `<p class="sub small mt">解析：${esc(res.analysis || '—')}</p>`;
      });
      document.getElementById('pr-summary').innerHTML = `<strong>本组得分 ${r.gotScore} / ${r.totalScore}</strong>`;
      document.getElementById('pr-submit').style.display = 'none';
      document.getElementById('pr-again').style.display = '';
      toast('练习判分完成');
    } catch (e) { toast(e.message, 'err'); }
  };
}
function renderPracticeQ(q) {
  const host = document.querySelector(`[data-prq="${q.id}"]`); if (!host) return;
  if (q.type === 'single' || q.type === 'multi') {
    host.innerHTML = `<div class="q-options">${q.options.map(o => `<div class="q-opt" data-popt="${o.k}"><span class="k">${o.k}</span><span>${esc(o.t)}</span></div>`).join('')}</div>`;
    host.querySelectorAll('[data-popt]').forEach(el => el.onclick = () => {
      const v = el.dataset.popt;
      if (q.type === 'single') { PR.answers[q.id] = v; host.querySelectorAll('[data-popt]').forEach(x => x.classList.toggle('sel', x === el)); }
      else { const cur = new Set(Array.isArray(PR.answers[q.id]) ? PR.answers[q.id] : []); cur.has(v) ? cur.delete(v) : cur.add(v); PR.answers[q.id] = [...cur].sort(); el.classList.toggle('sel'); }
    });
  } else if (q.type === 'judge') {
    host.innerHTML = `<div class="q-options">${[['true', '正确'], ['false', '错误']].map(([v, t]) => `<div class="q-opt" data-popt="${v}"><span>${t}</span></div>`).join('')}</div>`;
    host.querySelectorAll('[data-popt]').forEach(el => el.onclick = () => { PR.answers[q.id] = el.dataset.popt; host.querySelectorAll('[data-popt]').forEach(x => x.classList.toggle('sel', x === el)); });
  } else if (q.type === 'fill') {
    host.innerHTML = Array.from({ length: Math.max(1, q.blanks || 1) }, (_, i) => `<input class="fill-input" data-pblank="${i}" placeholder="第 ${i + 1} 空答案">`).join('');
    host.querySelectorAll('[data-pblank]').forEach(inp => inp.addEventListener('input', () => { const arr = Array.isArray(PR.answers[q.id]) ? [...PR.answers[q.id]] : []; arr[Number(inp.dataset.pblank)] = inp.value; PR.answers[q.id] = arr; }));
  } else if (q.type === 'code') {
    host.innerHTML = `<div class="row spread" style="margin-bottom:8px"><span class="tag">${LANG_NAME[q.language] || ''}</span><span class="sub small">共 ${q.caseCount || 0} 个测试用例</span><button class="btn small ai" data-prun="1" type="button">▶ 运行测试</button></div>
    <textarea class="code-editor" data-pcode="1" rows="12" spellcheck="false">${esc(q.template || '')}</textarea><div data-prunres="1" class="mt"></div>`;
    const ta = host.querySelector('[data-pcode]');
    PR.answers[q.id] = q.template || '';
    ta.addEventListener('input', () => { PR.answers[q.id] = ta.value; });
    host.querySelector('[data-prun]').onclick = async () => {
      const box = host.querySelector('[data-prunres]');
      try { const r = await api('POST', '/api/practice/run', { sessionId: PR.sessionId, qid: q.id, code: ta.value }); box.innerHTML = judgeHtml(r.judge); }
      catch (e) { box.innerHTML = `<span class="mine-bad">${esc(e.message)}</span>`; }
    };
  }
}

/* ================= 管理员端 ================= */
async function viewOverview() {
  const o = await api('GET', '/api/admin/overview');
  main().innerHTML = `<h2>数据概览</h2><div class="stat-grid">
    ${[['用户总数', o.users], ['学生', o.students], ['教师', o.teachers], ['题目', o.questions], ['试卷', o.papers], ['考试', o.exams], ['已交卷答卷', o.sheets], ['班级', o.classes.length]].map(([l, n]) => `<div class="stat-box"><div class="num">${n}</div><div class="lbl">${l}</div></div>`).join('')}
  </div><div class="card mt"><strong>班级列表</strong><div class="mt">${o.classes.map(c => `<span class="tag" style="margin-right:6px">${esc(c)}</span>`).join('') || '<span class="sub">暂无班级</span>'}</div>
  <p class="sub small mt">管理员端对应 PRD 4.7 节：用户管理（新增/删除/批量导入/重置密码）、班级维护、数据备份恢复。</p></div>
  <div class="card mt"><strong>数据备份与恢复</strong>
  <div class="row mt"><button class="btn ghost" id="bk-down">导出备份（JSON）</button><label class="btn ghost" style="cursor:pointer">从备份恢复<input id="bk-file" type="file" accept=".json,application/json" style="display:none"></label></div>
  <p class="sub small mt">备份包含全部用户、题库、试卷、考试与答卷。恢复会覆盖当前数据且所有人需要重新登录；批量导入或删用户前建议先导出一份。</p></div>`;
  document.getElementById('bk-down').onclick = async () => { try { await downloadAuthed('/api/admin/backup', '考试系统备份.json'); toast('备份已下载'); } catch (e) { toast(e.message, 'err'); } };
  document.getElementById('bk-file').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    let data; try { data = JSON.parse(await f.text()); } catch { return toast('文件不是有效的 JSON 备份', 'err'); }
    confirmBox('确定用这份备份恢复吗？当前全部数据将被覆盖，恢复后需要重新登录。', async () => {
      try { await api('POST', '/api/admin/restore', { data }); toast('恢复成功，请重新登录'); setTimeout(logout, 800); }
      catch (err) { toast(err.message, 'err'); }
    });
  };
}
async function viewUsers() {
  const users = await api('GET', '/api/admin/users');
  const roleName = { teacher: '教师', student: '学生', admin: '管理员' };
  const pending = users.filter(u => u.status === 'pending');
  const active = users.filter(u => u.status !== 'pending');
  main().innerHTML = `<div class="row spread mb"><h2 style="margin:0">用户管理</h2><div class="row"><button class="btn ghost" id="u-import">批量导入学生</button><button class="btn" id="u-add">＋ 新增用户</button></div></div>${pending.length ? `<div class="card" style="border-color:var(--warn);background:#fffbeb"><strong>待审核注册（${pending.length}）</strong>${pending.map(u => `<div class="checkrow" style="margin-top:8px;background:#fff"><span style="flex:1">${esc(u.name)}（${esc(u.username)}）申请注册为${roleName[u.role]}</span><button class="btn small" data-approve="${u.id}">通过</button><button class="btn ghost small" data-deluser="${u.id}">拒绝</button></div>`).join('')}</div>` : ''}<div class="card"><table><tr><th>账号</th><th>姓名</th><th>角色</th><th>班级</th><th>操作</th></tr>
  ${active.map(u => `<tr><td>${esc(u.username)}</td><td>${esc(u.name)}</td><td>${roleName[u.role]}</td><td>${esc(u.className || '-')}</td>
  <td><button class="link" data-edituser="${u.id}">编辑</button>${u.role === 'student' ? `<button class="link" data-reset="${u.id}">重置密码</button>` : ''}${u.id !== S.user.id ? `<button class="link danger" data-deluser="${u.id}">删除</button>` : ''}</td></tr>`).join('')}</table>
  <p class="sub small mt">重置后密码为初始密码 123456。已有答卷记录的用户不能删除。批量导入的学生初始密码统一为 123456。教师自助注册的账号会出现在上方待审核区。</p></div>`;
  main().querySelectorAll('[data-approve]').forEach(b => b.onclick = async () => { try { await api('POST', `/api/admin/users/${b.dataset.approve}/approve`); toast('已通过审核'); viewUsers(); } catch (e) { toast(e.message, 'err'); } });
  main().querySelectorAll('[data-edituser]').forEach(b => b.onclick = () => userEditForm(users.find(u => u.id === b.dataset.edituser)));
  main().querySelectorAll('[data-reset]').forEach(b => b.onclick = () => confirmBox('确定把该学生密码重置为 123456 吗？', async () => { await api('POST', `/api/admin/users/${b.dataset.reset}/reset`); toast('已重置'); }));
  main().querySelectorAll('[data-deluser]').forEach(b => b.onclick = () => confirmBox('确定删除该用户吗？此操作不可恢复。', async () => { try { await api('DELETE', `/api/admin/users/${b.dataset.deluser}`); toast('已删除'); viewUsers(); } catch (e) { toast(e.message, 'err'); } }));
  document.getElementById('u-add').onclick = () => userForm();
  document.getElementById('u-import').onclick = () => importStudentsModal();
}
function userEditForm(u) {
  if (!u) return;
  openModal(`<h3>编辑用户 · ${esc(u.username)}</h3><div class="form-grid">
  <label>姓名<input id="ue-name" value="${esc(u.name)}"></label>
  <label>班级<input id="ue-class" value="${esc(u.className || '')}" placeholder="学生填，教师可留空"></label></div>
  <p class="sub small">账号、身份与密码不在此修改（密码用「重置密码」）。</p>
  <div class="row" style="justify-content:flex-end"><button class="btn ghost" onclick="closeModal()">取消</button><button class="btn" id="ue-save">保存</button></div>`);
  document.getElementById('ue-save').onclick = async () => {
    try { await api('PUT', `/api/admin/users/${u.id}`, { name: document.getElementById('ue-name').value.trim(), className: document.getElementById('ue-class').value.trim() }); closeModal(); toast('已保存'); viewUsers(); }
    catch (e) { toast(e.message, 'err'); }
  };
}
function userForm() {
  openModal(`<h3>新增用户</h3><div class="form-grid">
  <label>账号<input id="uf-username" placeholder="如 stu31"></label>
  <label>姓名<input id="uf-name" placeholder="如 张三"></label>
  <label>角色<select id="uf-role"><option value="student">学生</option><option value="teacher">教师</option><option value="admin">管理员</option></select></label>
  <label>班级（学生填）<input id="uf-class" placeholder="如 计算机1班"></label>
  <label>初始密码<input id="uf-pw" value="123456"></label></div>
  <div class="row" style="justify-content:flex-end"><button class="btn ghost" onclick="closeModal()">取消</button><button class="btn" id="uf-save">创建</button></div>`);
  document.getElementById('uf-save').onclick = async () => {
    const body = { username: document.getElementById('uf-username').value.trim(), name: document.getElementById('uf-name').value.trim(), role: document.getElementById('uf-role').value, className: document.getElementById('uf-class').value.trim(), password: document.getElementById('uf-pw').value || '123456' };
    try { await api('POST', '/api/admin/users', body); closeModal(); toast('用户已创建'); viewUsers(); }
    catch (e) { toast(e.message, 'err'); }
  };
}
function importStudentsModal() {
  const tpl = '账号,姓名,班级\nstu31,张三,计算机1班\nstu32,李四,计算机1班';
  openModal(`<h3>批量导入学生（CSV）</h3>
  <p class="sub small" style="line-height:1.8">列顺序：账号、姓名、班级。账号重复的自动跳过，初始密码统一 123456。</p>
  <div class="row mt"><button class="btn ghost small" id="si-tpl">下载模板</button><label class="btn ghost small" style="cursor:pointer">选择 CSV 文件<input id="si-file" type="file" accept=".csv,text/csv" style="display:none"></label></div>
  <textarea id="si-text" rows="7" style="width:100%;margin-top:10px" placeholder="也可以把 CSV 内容直接粘贴到这里"></textarea>
  <div id="si-result" class="mt" style="line-height:1.8"></div>
  <div class="row" style="justify-content:flex-end"><button class="btn ghost" onclick="closeModal()">取消</button><button class="btn" id="si-go">开始导入</button></div>`, true);
  document.getElementById('si-tpl').onclick = () => downloadText('学生导入模板.csv', '\ufeff' + tpl, 'text/csv;charset=utf-8');
  document.getElementById('si-file').onchange = async e => { const f = e.target.files[0]; if (f) document.getElementById('si-text').value = await f.text(); };
  document.getElementById('si-go').onclick = async () => {
    const rows = parseCSV(document.getElementById('si-text').value);
    const start = rows.length && String(rows[0][0]).includes('账号') ? 1 : 0;
    const items = rows.slice(start).map(r => ({ username: String(r[0] || '').trim(), name: String(r[1] || '').trim(), className: String(r[2] || '').trim() })).filter(x => x.username);
    if (!items.length) { document.getElementById('si-result').innerHTML = '<span style="color:var(--bad)">没有可导入的学生，请检查格式。</span>'; return; }
    try {
      const r = await api('POST', '/api/admin/users/import', { items });
      document.getElementById('si-result').innerHTML = `成功导入 <strong>${r.created}</strong> 名学生，跳过 ${r.skipped} 个（账号为空或已存在）。`;
      toast(`导入完成：${r.created} 名`);
      viewUsers();
    } catch (e) { toast(e.message, 'err'); }
  };
}
async function viewClasses() {
  const classes = await api('GET', '/api/admin/classes');
  main().innerHTML = `<h2>班级管理</h2><div class="card"><div class="row"><input id="cl-name" placeholder="新班级名称，如 计算机3班" style="width:240px"><button class="btn" id="cl-add">新增班级</button></div>
  <div class="mt">${classes.map(c => `<div class="checkrow"><span style="flex:1">${esc(c)}</span><button class="link danger" data-delclass="${esc(c)}">删除</button></div>`).join('') || '<div class="empty">暂无班级。</div>'}</div></div>`;
  document.getElementById('cl-add').onclick = async () => {
    const name = document.getElementById('cl-name').value.trim(); if (!name) return toast('班级名不能为空', 'warn');
    try { await api('POST', '/api/admin/classes', { name }); toast('已新增'); viewClasses(); } catch (e) { toast(e.message, 'err'); }
  };
  main().querySelectorAll('[data-delclass]').forEach(b => b.onclick = () => confirmBox(`确定删除班级“${b.dataset.delclass}”吗？（不影响已有用户记录）`, async () => { await api('DELETE', '/api/admin/classes/' + encodeURIComponent(b.dataset.delclass)); toast('已删除'); viewClasses(); }));
}

async function viewAISettings() {
  let s = { enabled: false, baseUrl: '', model: '', apiKeySet: false, apiKeyMasked: '' };
  try { s = await api('GET', '/api/admin/ai-settings'); } catch (e) { toast(e.message, 'err'); }
  main().innerHTML = `<h2>AI 接口设置</h2>
  <div class="card"><p class="sub" style="line-height:1.9">接入任意 <strong>OpenAI 兼容</strong>的大模型接口（DeepSeek、通义千问、Kimi、智谱等云端服务，或本机 Ollama）。开启后教师端可用「AI 生成题目」「AI 辅助批改」，答卷回顾可用「AI 讲解」。API Key 只保存在本机数据库中，调用由本服务转发，不经过第三方。</p>
  <div class="form-grid mt">
  <label style="color:var(--ink)"><input type="checkbox" id="ai-enabled" ${s.enabled ? 'checked' : ''}> 启用 AI 功能</label>
  <label>接口地址（Base URL）<input id="ai-base" value="${esc(s.baseUrl)}" placeholder="如 https://api.deepseek.com/v1 或 http://localhost:11434/v1"></label>
  <label>模型名<input id="ai-model" value="${esc(s.model)}" placeholder="如 deepseek-chat / qwen-plus / llama3.1"></label>
  <label>API Key<input id="ai-key" type="password" placeholder="${s.apiKeySet ? '已保存（' + esc(s.apiKeyMasked) + '），留空表示不修改' : '云端接口必填；本机 Ollama 可留空'}"></label>
  </div>
  <div class="row mt"><button class="btn" id="ai-save">保存设置</button><button class="btn ghost" id="ai-test">测试连接</button><span id="ai-msg" class="sub small"></span></div>
  <p class="sub small mt" style="line-height:1.9">常见地址：DeepSeek https://api.deepseek.com/v1 · 通义千问 https://dashscope.aliyuncs.com/compatible-mode/v1 · Kimi https://api.moonshot.cn/v1 · 智谱 https://open.bigmodel.cn/api/paas/v4 · 本机 Ollama http://localhost:11434/v1（无需 Key）。<br>注意：云端接口需要这台机器能联网；纯离线课堂请用本机 Ollama。未启用时，所有 AI 按钮会自动隐藏，其余功能不受影响。</p></div>`;
  document.getElementById('ai-save').onclick = async () => {
    const body = { enabled: document.getElementById('ai-enabled').checked, baseUrl: document.getElementById('ai-base').value.trim(), model: document.getElementById('ai-model').value.trim() };
    const k = document.getElementById('ai-key').value.trim(); if (k) body.apiKey = k;
    try { await api('PUT', '/api/admin/ai-settings', body); toast('AI 设置已保存'); viewAISettings(); }
    catch (e) { toast(e.message, 'err'); }
  };
  document.getElementById('ai-test').onclick = async () => {
    const msg = document.getElementById('ai-msg'); msg.textContent = '正在调用模型…';
    try { const r = await api('POST', '/api/admin/ai-test'); msg.innerHTML = `<span class="mine-ok" style="color:var(--ok)">连接成功，模型回复：${esc(r.reply)}</span>`; }
    catch (e) { msg.innerHTML = `<span style="color:var(--bad)">${esc(e.message)}</span>`; }
  };
}

/* ---------------- 启动 ---------------- */
if (S.token && S.user) { api('GET', '/api/me').then(u => { S.user = u; enterApp(); }).catch(() => renderLogin()); }
else renderLogin();
