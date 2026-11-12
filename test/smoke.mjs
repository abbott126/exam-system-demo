import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TIMEOUT_MS = 15000;

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

function check(name, cond, detail) {
  if (!cond) throw new Error(`${name} 断言失败${detail ? '：' + detail : ''}`);
  console.log(`[ok] ${name}`);
}

function client(base) {
  async function raw(pathname, { method = 'GET', token, body } = {}) {
    const res = await fetch(base + pathname, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`${method} ${pathname} 返回非 JSON（HTTP ${res.status}）：${text.slice(0, 200)}`);
    }
    return { status: res.status, json };
  }
  async function api(pathname, opts) {
    const { status, json } = await raw(pathname, opts);
    if (!json.ok) throw new Error(`${opts?.method || 'GET'} ${pathname} 失败（HTTP ${status}）：${json.error}`);
    return json.data;
  }
  return { raw, api };
}

async function waitReady(base, child) {
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(`服务进程提前退出（code ${child.exitCode}）`);
    try {
      const res = await fetch(base + '/', { signal: AbortSignal.timeout(1000) });
      if (res.ok) return;
    } catch {}
    await delay(100);
  }
  throw new Error('服务在 10 秒内未就绪');
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([once(child, 'exit'), delay(3000)]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

const sumCode = 'const d=require("fs").readFileSync(0,"utf8").trim().split(/\\s+/).map(Number);console.log(d[0]+d[1]);';

async function main() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'exam-smoke-'));
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  let stderr = '';
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), DATA_DIR: tmpDir },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stderr.on('data', d => { stderr += d; });
  let step = '启动服务';

  try {
    await waitReady(base, child);
    check('服务启动并返回首页', true);

    const { raw, api } = client(base);

    step = '角色登录';
    const teacher = await api('/api/login', { method: 'POST', body: { username: 'teacher', password: '123456' } });
    const student = await api('/api/login', { method: 'POST', body: { username: 'student', password: '123456' } });
    const admin = await api('/api/login', { method: 'POST', body: { username: 'admin', password: '123456' } });
    check('教师/学生/管理员登录成功', teacher.token && student.token && admin.token);
    check('登录返回角色正确', teacher.user.role === 'teacher' && student.user.role === 'student' && admin.user.role === 'admin');

    step = '登录失败与权限隔离';
    const badLogin = await raw('/api/login', { method: 'POST', body: { username: 'teacher', password: 'wrong' } });
    check('错误密码返回 401', badLogin.status === 401 && badLogin.json.ok === false);
    const studentQuestions = await raw('/api/questions', { token: student.token });
    check('学生访问题库返回 403', studentQuestions.status === 403 && studentQuestions.json.ok === false);

    step = '教师建题';
    const single = await api('/api/questions', {
      method: 'POST',
      token: teacher.token,
      body: {
        type: 'single', stem: 'Smoke：1 + 1 = ?',
        options: [{ k: 'A', t: '1' }, { k: 'B', t: '2' }],
        answer: 'B', score: 10, difficulty: '易', tag: 'smoke', subject: 'Smoke'
      }
    });
    check('创建单选题', single.id && single.type === 'single');
    const code = await api('/api/questions', {
      method: 'POST',
      token: teacher.token,
      body: {
        type: 'code', stem: 'Smoke：读两个整数求和', language: 'javascript',
        cases: [{ input: '2 3', expected: '5' }, { input: '10 -4', expected: '6' }],
        template: '', answer: sumCode, score: 10, difficulty: '易', tag: 'smoke', subject: 'Smoke'
      }
    });
    check('创建编程题', code.id && code.language === 'javascript' && code.cases.length === 2);
    const slow = await api('/api/questions', {
      method: 'POST',
      token: teacher.token,
      body: {
        type: 'code', stem: 'Smoke：判题超时用例', language: 'javascript',
        cases: [{ input: '', expected: '1' }],
        template: '', answer: '', score: 10, difficulty: '易', tag: 'smoke', subject: 'Smoke'
      }
    });
    check('创建超时验证题', slow.id && slow.cases.length === 1);

    step = '教师组卷';
    const paper = await api('/api/papers', {
      method: 'POST',
      token: teacher.token,
      body: {
        name: 'Smoke 试卷', subject: 'Smoke',
        items: [{ qid: single.id, score: 10 }, { qid: code.id, score: 10 }, { qid: slow.id, score: 10 }]
      }
    });
    check('组卷并汇总总分', paper.id && paper.total === 30);

    step = '教师发布考试';
    const exam = await api('/api/exams', {
      method: 'POST',
      token: teacher.token,
      body: {
        name: 'Smoke 考试', paperId: paper.id,
        startTime: new Date(Date.now() - 60000).toISOString(),
        endTime: new Date(Date.now() + 3600000).toISOString(),
        durationMin: 30, switchLimit: 0, showAnswer: true, classNames: []
      }
    });
    check('发布进行中的考试', exam.id && exam.classNames.length === 0);

    step = '学生进入考试';
    const exams = await api('/api/exams', { token: student.token });
    const listed = exams.find(e => e.id === exam.id);
    check('学生考试列表可见且状态进行中', listed && listed.status === '进行中');
    const started = await api(`/api/exams/${exam.id}/start`, { method: 'POST', token: student.token });
    check('开始考试生成答卷', started.sheetId && started.questions.length === 3);
    check('答题接口不下发正确答案', started.questions.every(q => q.answer === undefined));

    step = '编程题运行测试';
    const run = await api(`/api/sheets/${started.sheetId}/run`, {
      method: 'POST', token: student.token, body: { qid: code.id, code: sumCode }
    });
    check('正确代码全部用例通过', run.judge.passed === 2 && run.judge.total === 2);

    step = '判题超时保护';
    const t0 = Date.now();
    const timedOut = await api(`/api/sheets/${started.sheetId}/run`, {
      method: 'POST', token: student.token, body: { qid: slow.id, code: 'while (true) {}' }
    });
    const elapsed = Date.now() - t0;
    check('死循环被判为超时', timedOut.judge.cases[0].status === 'timeout', JSON.stringify(timedOut.judge.cases[0]));
    check('超时在 3 秒限制附近返回', elapsed >= 2500 && elapsed < 8000, `实际 ${elapsed}ms`);

    step = '学生交卷';
    const submitted = await api(`/api/sheets/${started.sheetId}/submit`, {
      method: 'POST', token: student.token,
      body: { answers: { [single.id]: 'B', [code.id]: sumCode, [slow.id]: 'console.log("1")' }, reason: 'manual' }
    });
    check('交卷后自动判分 30 分', submitted.score === 30 && submitted.pending === 0, JSON.stringify(submitted));

    step = '教师统计';
    const stats = await api(`/api/exams/${exam.id}/stats`, { token: teacher.token });
    check('统计交卷人数与平均分', stats.submitted === 1 && stats.avg === 30);
    check('统计及格率 100%', stats.passRate === 100);
    check('逐题统计覆盖 3 道题', stats.perQuestion.length === 3);
    check('成绩明细分数正确', stats.rows.length === 1 && stats.rows[0].score === 30);

    step = '学生成绩';
    const after = await api('/api/exams', { token: student.token });
    const mine = after.find(e => e.id === exam.id);
    check('学生端显示已交卷与分数', mine && mine.mySheet && mine.mySheet.status === 'submitted' && mine.mySheet.score === 30);

    console.log('\nSMOKE PASS');
  } catch (e) {
    console.error(`\n[FAIL] ${step}：${e.message}`);
    if (stderr.trim()) console.error('服务端 stderr：\n' + stderr.trim().slice(-2000));
    process.exitCode = 1;
  } finally {
    await stopServer(child);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main();
