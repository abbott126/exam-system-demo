'use strict';
/*
 * 考试系统 v1.0 正式版 —— 零依赖 Node.js 单体服务
 * 对应 PRD：《考试系统Demo-PRD.md》v1.0
 * 运行：node server.js  →  http://localhost:3000
 * 数据：data/db.json（首次启动自动生成演示数据）
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DB_PATH = path.join(ROOT, 'data', 'db.json');
const PUBLIC = path.join(ROOT, 'public');

/* ---------------- 工具 ---------------- */
const LEGACY_SALT = 'exam-demo::';
function hashPw(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(LEGACY_SALT + String(pw), salt, 64).toString('hex');
  return 'scrypt$' + salt + '$' + hash;
}
function isLegacyHash(h) { return typeof h === 'string' && /^[a-f0-9]{64}$/.test(h); }
function verifyPw(pw, stored) {
  if (typeof stored !== 'string' || !stored) return false;
  if (stored.startsWith('scrypt$')) {
    const parts = stored.split('$');
    if (parts.length !== 3) return false;
    const expected = Buffer.from(parts[2], 'hex');
    if (!expected.length) return false;
    let actual;
    try { actual = crypto.scryptSync(LEGACY_SALT + String(pw), parts[1], expected.length); } catch { return false; }
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  }
  if (isLegacyHash(stored)) {
    const actual = crypto.createHash('sha256').update(LEGACY_SALT + String(pw)).digest();
    const expected = Buffer.from(stored, 'hex');
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  }
  return false;
}
const round1 = n => Math.round(n * 10) / 10;
function lcg(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const nowISO = () => new Date().toISOString();

/* ---------------- 演示数据（种子） ---------------- */
function seed() {
  const questions = [
    // 单选 ×8（每题 5 分）
    { id: 'q1', type: 'single', stem: '在 Linux 中，查看当前目录下文件和目录列表最常用的命令是？', options: [{ k: 'A', t: 'ls' }, { k: 'B', t: 'pwd' }, { k: 'C', t: 'cd' }, { k: 'D', t: 'mkdir' }], answer: 'A', analysis: 'ls 列出目录内容；pwd 显示当前路径；cd 切换目录；mkdir 创建目录。', score: 5, difficulty: '易', tag: '命令行基础', subject: 'Linux基础', createdBy: 'u_teacher' },
    { id: 'q2', type: 'single', stem: '在 Shell 中，表示当前用户家目录的符号是？', options: [{ k: 'A', t: '$' }, { k: 'B', t: '~' }, { k: 'C', t: '@' }, { k: 'D', t: '#' }], answer: 'B', analysis: '~ 代表当前用户的家目录，如 /home/student。', score: 5, difficulty: '易', tag: '命令行基础', subject: 'Linux基础', createdBy: 'u_teacher' },
    { id: 'q3', type: 'single', stem: '查看文本文件内容的命令是？', options: [{ k: 'A', t: 'cat' }, { k: 'B', t: 'mv' }, { k: 'C', t: 'rm' }, { k: 'D', t: 'touch' }], answer: 'A', analysis: 'cat 输出文件内容；mv 移动/重命名；rm 删除；touch 新建空文件或更新时间戳。', score: 5, difficulty: '易', tag: '文件操作', subject: 'Linux基础', createdBy: 'u_teacher' },
    { id: 'q4', type: 'single', stem: '修改文件访问权限的命令是？', options: [{ k: 'A', t: 'chown' }, { k: 'B', t: 'chmod' }, { k: 'C', t: 'chgrp' }, { k: 'D', t: 'umask' }], answer: 'B', analysis: 'chmod 修改权限；chown 修改所有者；chgrp 修改所属组；umask 设置默认权限掩码。', score: 5, difficulty: '中', tag: '用户权限', subject: 'Linux基础', createdBy: 'u_teacher' },
    { id: 'q5', type: 'single', stem: '查看当前系统进程快照的命令是？', options: [{ k: 'A', t: 'ps' }, { k: 'B', t: 'kill' }, { k: 'C', t: 'nice' }, { k: 'D', t: 'jobs' }], answer: 'A', analysis: 'ps 显示进程快照，常用组合 ps aux / ps -ef；top 是动态查看。', score: 5, difficulty: '易', tag: '进程管理', subject: 'Linux基础', createdBy: 'u_teacher' },
    { id: 'q6', type: 'single', stem: '向进程发送终止信号的命令是？', options: [{ k: 'A', t: 'kill' }, { k: 'B', t: 'stop' }, { k: 'C', t: 'haltproc' }, { k: 'D', t: 'exit' }], answer: 'A', analysis: 'kill 默认发送 SIGTERM(15)，kill -9 发送 SIGKILL 强制终止。', score: 5, difficulty: '中', tag: '进程管理', subject: 'Linux基础', createdBy: 'u_teacher' },
    { id: 'q7', type: 'single', stem: '查看磁盘分区空间使用情况的命令是？', options: [{ k: 'A', t: 'du' }, { k: 'B', t: 'df' }, { k: 'C', t: 'free' }, { k: 'D', t: 'fdisk' }], answer: 'B', analysis: 'df 看分区整体使用率；du 看目录/文件占用；free 看内存。', score: 5, difficulty: '中', tag: '磁盘管理', subject: 'Linux基础', createdBy: 'u_teacher' },
    { id: 'q8', type: 'single', stem: 'Linux 系统中存放系统配置文件的目录是？', options: [{ k: 'A', t: '/etc' }, { k: 'B', t: '/var' }, { k: 'C', t: '/usr' }, { k: 'D', t: '/home' }], answer: 'A', analysis: '/etc 存放系统与服务的配置文件；/var 存放日志等可变数据；/home 是普通用户家目录。', score: 5, difficulty: '易', tag: '目录结构', subject: 'Linux基础', createdBy: 'u_teacher' },
    // 多选 ×5（每题 6 分）
    { id: 'q9', type: 'multi', stem: '以下属于文本处理“三剑客”的命令有？', options: [{ k: 'A', t: 'grep' }, { k: 'B', t: 'sed' }, { k: 'C', t: 'awk' }, { k: 'D', t: 'find' }], answer: ['A', 'B', 'C'], analysis: 'grep 查找、sed 编辑、awk 分析，是文本三剑客；find 是文件查找命令。', score: 6, difficulty: '中', tag: '文本处理', subject: 'Linux基础', createdBy: 'u_teacher' },
    { id: 'q10', type: 'multi', stem: '以下可以查看网络信息或测试连通性的命令有？', options: [{ k: 'A', t: 'ip addr' }, { k: 'B', t: 'ping' }, { k: 'C', t: 'ss' }, { k: 'D', t: 'cd' }], answer: ['A', 'B', 'C'], analysis: 'ip 查看地址、ping 测连通、ss 看连接与监听端口；cd 只用于切换目录。', score: 6, difficulty: '中', tag: '网络', subject: 'Linux基础', createdBy: 'u_teacher' },
    { id: 'q11', type: 'multi', stem: '以下与压缩、归档相关的命令有？', options: [{ k: 'A', t: 'tar' }, { k: 'B', t: 'gzip' }, { k: 'C', t: 'top' }, { k: 'D', t: 'vim' }], answer: ['A', 'B'], analysis: 'tar 负责打包归档，gzip 负责压缩；top 看进程，vim 是编辑器。', score: 6, difficulty: '中', tag: '文件操作', subject: 'Linux基础', createdBy: 'u_teacher' },
    { id: 'q12', type: 'multi', stem: '以下 systemctl 的用法正确的有？', options: [{ k: 'A', t: 'systemctl start nginx' }, { k: 'B', t: 'systemctl status nginx' }, { k: 'C', t: 'systemctl enable nginx' }, { k: 'D', t: 'systemctl delete nginx' }], answer: ['A', 'B', 'C'], analysis: 'start 启动、status 查看状态、enable 设置开机自启；systemctl 没有 delete 子命令。', score: 6, difficulty: '难', tag: '服务管理', subject: 'Linux基础', createdBy: 'u_teacher' },
    { id: 'q13', type: 'multi', stem: '以下可以用来查找文件或命令位置的有？', options: [{ k: 'A', t: 'find' }, { k: 'B', t: 'locate' }, { k: 'C', t: 'which' }, { k: 'D', t: 'rm' }], answer: ['A', 'B', 'C'], analysis: 'find 按条件查文件、locate 基于索引库查路径、which 查命令所在路径；rm 是删除命令。', score: 6, difficulty: '中', tag: '文件操作', subject: 'Linux基础', createdBy: 'u_teacher' },
    // 判断 ×4（每题 5 分）
    { id: 'q14', type: 'judge', stem: 'Linux 的设计理念之一是“一切皆文件”，硬件设备也可以通过文件的方式访问。', options: [], answer: 'true', analysis: '设备在 /dev 下以设备文件形式存在，可以用统一的文件接口访问。', score: 5, difficulty: '易', tag: '系统概念', subject: 'Linux基础', createdBy: 'u_teacher' },
    { id: 'q15', type: 'judge', stem: 'rm -rf / 是清理系统垃圾的安全命令，可以放心执行。', options: [], answer: 'false', analysis: 'rm -rf / 会递归删除整个文件系统，是极度危险的命令，绝对禁止执行。', score: 5, difficulty: '易', tag: '安全规范', subject: 'Linux基础', createdBy: 'u_teacher' },
    { id: 'q16', type: 'judge', stem: 'chmod 777 表示文件所有者、所属组和其他用户都拥有读、写、执行权限。', options: [], answer: 'true', analysis: '7 = rwx(4+2+1)，三组都是 7 即所有人可读可写可执行，实际工作中应谨慎使用。', score: 5, difficulty: '中', tag: '用户权限', subject: 'Linux基础', createdBy: 'u_teacher' },
    { id: 'q17', type: 'judge', stem: '使用 crontab -e 可以编辑当前用户的计划任务。', options: [], answer: 'true', analysis: 'crontab -e 编辑、-l 查看、-r 删除当前用户的全部计划任务（慎用）。', score: 5, difficulty: '易', tag: '计划任务', subject: 'Linux基础', createdBy: 'u_teacher' },
    // 填空 ×3（4+3+3 分）
    { id: 'q18', type: 'fill', stem: '在 systemd 系统中，查看系统日志的命令是 ____。（填写命令名）', options: [], answer: ['journalctl'], analysis: 'journalctl 查看 systemd 日志，常用 journalctl -u 服务名、journalctl -f 实时跟踪。', score: 4, difficulty: '中', tag: '日志管理', subject: 'Linux基础', createdBy: 'u_teacher' },
    { id: 'q19', type: 'fill', stem: '临时切换到 root 用户身份的命令是 ____。（填写命令名）', options: [], answer: ['su|su -'], analysis: 'su 切换用户，su - 同时切换环境变量；配合 sudo 是日常提权的常用方式。', score: 3, difficulty: '易', tag: '用户权限', subject: 'Linux基础', createdBy: 'u_teacher' },
    { id: 'q20', type: 'fill', stem: '显示当前所在目录完整路径的命令是 ____。（填写命令名）', options: [], answer: ['pwd'], analysis: 'pwd = print working directory，输出当前工作目录的绝对路径。', score: 3, difficulty: '易', tag: '命令行基础', subject: 'Linux基础', createdBy: 'u_teacher' },
    // 简答 ×2（每题 10 分，人工批改）
    { id: 'q21', type: 'essay', stem: '简答题：请说明 chmod 777 中三个数字各代表什么含义，并解释为什么在生产环境中应慎用 777 权限。', options: [], answer: '参考答案：三个数字依次表示所有者、所属组、其他用户的权限；7 = 读(4) + 写(2) + 执行(1)，即所有人可读、可写、可执行。慎用原因：任意用户都能改写甚至替换文件，存在被篡改、植入恶意脚本和误删的风险，应遵循最小权限原则按需授权。', analysis: '评分要点：三组对象与 7 的构成答对给 6 分；说清至少一条具体风险给 2 分；提到最小权限原则给 2 分。', score: 10, difficulty: '中', tag: '用户权限', subject: 'Linux基础', createdBy: 'u_teacher' },
    { id: 'q22', type: 'essay', stem: '简答题：凌晨收到磁盘空间使用率 95% 的告警，请写出你的排查与处置思路（至少三步）。', options: [], answer: '参考答案：先用 df -h 确认是哪个分区；再用 du 逐层定位占用最大的目录；按类型分类处置——日志做轮转/清理（先确认可删）、临时文件清理、业务数据扩容或归档；处置后复查使用率，并补充容量预测与监控，避免再次写满。', analysis: '评分要点：定位分区与大目录的方法给 4 分；分类处置（日志/临时/业务区别对待）给 4 分；处置后复查与预防给 2 分。只写"删文件"不得超过 4 分。', score: 10, difficulty: '难', tag: '磁盘管理', subject: 'Linux基础', createdBy: 'u_teacher' },
    // 编程 ×2（自动判题：JavaScript + Python，各 15 分，按测试用例通过比例给分）
    { id: 'q23', type: 'code', language: 'javascript', stem: '编程题：编写 JavaScript 程序，从标准输入读取一行两个整数（空格分隔），输出它们的和。\n示例输入：3 5\n示例输出：8', options: [], answer: "const data = require('fs').readFileSync(0, 'utf8').trim().split(/\\s+/).map(Number);\nconsole.log(data[0] + data[1]);", template: "// 从标准输入读取一行两个整数，输出它们的和\nconst data = require('fs').readFileSync(0, 'utf8').trim().split(/\\s+/).map(Number);\n// 在下面写你的代码，用 console.log 输出结果\n", cases: [{ input: '3 5', expected: '8' }, { input: '10 -4', expected: '6' }, { input: '0 0', expected: '0' }], analysis: '参考思路：读入整行后按空白切分并转成数字，相加后输出；注意负数与 0 的情况也要成立。', score: 15, difficulty: '中', tag: '编程基础', subject: 'Linux基础', createdBy: 'u_teacher' },
    { id: 'q24', type: 'code', language: 'python', stem: '编程题：编写 Python 程序，从标准输入读取一个整数 n，输出 1 到 n 的所有整数之和。\n示例输入：5\n示例输出：15', options: [], answer: 'import sys\nn = int(sys.stdin.read().strip())\nprint(n * (n + 1) // 2)', template: '# 从标准输入读取一个整数 n，输出 1 到 n 的和\nimport sys\n\nn = int(sys.stdin.read().strip())\n# 在下面写你的代码，用 print 输出结果\n', cases: [{ input: '5', expected: '15' }, { input: '10', expected: '55' }, { input: '100', expected: '5050' }], analysis: '参考思路：可用循环累加，也可用求和公式 n*(n+1)//2；n=100 时结果为 5050。', score: 15, difficulty: '中', tag: '编程基础', subject: 'Linux基础', createdBy: 'u_teacher' }
  ];

  const users = [
    { id: 'u_admin', username: 'admin', password: hashPw('123456'), name: '系统管理员', role: 'admin', className: '' },
    { id: 'u_teacher', username: 'teacher', password: hashPw('123456'), name: '王老师', role: 'teacher', className: '' },
    { id: 'u_student', username: 'student', password: hashPw('123456'), name: '张同学', role: 'student', className: '计算机1班' }
  ];
  for (let i = 1; i <= 30; i++) {
    users.push({ id: 'u_stu' + i, username: 'stu' + String(i).padStart(2, '0'), password: hashPw('123456'), name: '学生' + String(i).padStart(2, '0'), role: 'student', className: i % 2 ? '计算机1班' : '计算机2班' });
  }

  const paper = {
    id: 'p_demo', name: 'Linux基础演示试卷', subject: 'Linux基础', createdBy: 'u_teacher', createdAt: nowISO(),
    items: questions.filter(q => q.type !== 'essay' && q.type !== 'code').map(q => ({ qid: q.id, score: q.score }))
  };
  paper.total = paper.items.reduce((s, it) => s + it.score, 0);

  const dayMs = 24 * 3600 * 1000;
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const exam = {
    id: 'ex_demo', name: 'Linux基础随堂测验（演示）', paperId: paper.id, createdBy: 'u_teacher',
    startTime: new Date(start.getTime()).toISOString(), endTime: new Date(start.getTime() + 30 * dayMs).toISOString(),
    durationMin: 30, showAnswer: true, note: '演示考试：共 20 题，满分 100 分，交卷后立即出分。'
  };

  const paper2 = {
    id: 'p_comp', name: 'Linux基础综合卷（含主观题）', subject: 'Linux基础', createdBy: 'u_teacher', createdAt: nowISO(),
    items: [...paper.items, { qid: 'q21', score: 10 }, { qid: 'q22', score: 10 }]
  };
  paper2.total = paper2.items.reduce((s, it) => s + it.score, 0);
  const exam2 = {
    id: 'ex_comp', name: 'Linux基础综合测验（主观题演示）', paperId: paper2.id, createdBy: 'u_teacher',
    startTime: new Date(start.getTime() - dayMs).toISOString(), endTime: new Date(start.getTime() + 30 * dayMs).toISOString(),
    durationMin: 60, showAnswer: true, note: '含 2 道简答题，交卷后由教师批改，主观题分数以批改后为准。'
  };

  const paper3 = {
    id: 'p_code', name: '编程题演示卷（自动判题）', subject: 'Linux基础', createdBy: 'u_teacher', createdAt: nowISO(),
    items: [{ qid: 'q1', score: 5 }, { qid: 'q9', score: 6 }, { qid: 'q23', score: 15 }, { qid: 'q24', score: 15 }]
  };
  paper3.total = paper3.items.reduce((s, it) => s + it.score, 0);
  const exam3 = {
    id: 'ex_code', name: '编程随堂测验（自动判题演示）', paperId: paper3.id, createdBy: 'u_teacher',
    startTime: new Date(start.getTime() - dayMs).toISOString(), endTime: new Date(start.getTime() + 30 * dayMs).toISOString(),
    durationMin: 45, showAnswer: true, note: '含 2 道编程题：写代码时可点「运行测试」自查，交卷时系统按测试用例自动判分。'
  };

  const db = {
    seq: { question: 24, paper: 3, exam: 3, sheet: 0, user: 33 },
    classes: ['计算机1班', '计算机2班'],
    settings: { ai: { enabled: false, baseUrl: '', apiKey: '', model: '' } },
    users, questions, papers: [paper, paper2, paper3], exams: [exam, exam2, exam3], sheets: []
  };

  // 30 条模拟答卷（确定性伪随机，保证统计页有真实感）
  const qmap = Object.fromEntries(questions.map(q => [q.id, q]));
  for (let i = 1; i <= 30; i++) {
    const rnd = lcg(1000 + i * 77);
    const ability = 0.35 + ((i * 29) % 58) / 100; // 0.35 ~ 0.92
    const answers = {};
    for (const q of questions) {
      if (q.type === 'essay') continue;
      if (rnd() < ability) { answers[q.id] = Array.isArray(q.answer) ? [...q.answer] : q.answer; continue; }
      if (q.type === 'single') {
        const wrong = q.options.map(o => o.k).filter(k => k !== q.answer);
        answers[q.id] = wrong[Math.floor(rnd() * wrong.length)];
      } else if (q.type === 'multi') {
        if (rnd() < 0.5 && q.answer.length > 1) answers[q.id] = q.answer.slice(0, q.answer.length - 1); // 漏选 → 部分分
        else { const extra = q.options.map(o => o.k).find(k => !q.answer.includes(k)); answers[q.id] = extra ? [...q.answer, extra] : [...q.answer]; } // 含错选 → 0 分
      } else if (q.type === 'judge') {
        answers[q.id] = q.answer === 'true' ? 'false' : 'true';
      } else {
        answers[q.id] = [['cat'], ['vim'], ['top'], ['ls']][Math.floor(rnd() * 4)];
      }
    }
    const submitAt = Date.now() - (31 - i) * 47 * 60 * 1000;
    const startAt = submitAt - (16 + (i % 12)) * 60 * 1000;
    const sheet = {
      id: 'sh_mock' + i, examId: exam.id, studentId: 'u_stu' + i,
      startAt: new Date(startAt).toISOString(), submitAt: new Date(submitAt).toISOString(),
      answers, marked: [], switchCount: (i === 4 || i === 12 || i === 20) ? 4 + (i % 3) : Math.floor(rnd() * 3),
      status: 'submitted', score: 0, details: []
    };
    gradeSheet(db, sheet);
    db.sheets.push(sheet);
  }

  // 综合卷模拟答卷：8 份（学生01~08），前 5 份主观题已批改，后 3 份待批改，供批改功能演示
  const essayPool = [
    { a21: '7 表示可读、可写、可执行，三个数字分别是所有者、所属组和其他人的权限。生产上慎用是因为任何人都能改文件，容易被篡改或误删，应按最小权限原则授权。', a22: '先 df -h 看哪个分区满，再用 du 逐层找大目录；日志先轮转再清理，临时文件删除，业务数据考虑扩容或归档；最后复查使用率，并加容量预测监控。', s21: 9, s22: 9, c: '要点完整，表述清楚。' },
    { a21: '777 就是所有人都有读、写、执行权限。危险在于不安全，别人可以随便改我的文件。', a22: '用 df 看是哪个分区，再 du 找大文件，把占地方的日志清掉。', s21: 6, s22: 5, c: '基本思路对，但处置分类和复查预防写得不完整。' },
    { a21: 'chmod 777 就是开放全部权限，图省事。', a22: '把最大的文件删掉就行了。', s21: 3, s22: 2, c: '过于简略：未答到权限构成与具体风险，处置缺少分类与复查。' }
  ];
  for (let i = 1; i <= 8; i++) {
    const rnd = lcg(5000 + i * 131);
    const ability = 0.4 + ((i * 17) % 50) / 100;
    const answers = {};
    for (const q of questions) {
      if (q.type === 'essay') continue;
      if (rnd() < ability) { answers[q.id] = Array.isArray(q.answer) ? [...q.answer] : q.answer; continue; }
      if (q.type === 'single') {
        const wrong = q.options.map(o => o.k).filter(k => k !== q.answer);
        answers[q.id] = wrong[Math.floor(rnd() * wrong.length)];
      } else if (q.type === 'multi') {
        if (rnd() < 0.5 && q.answer.length > 1) answers[q.id] = q.answer.slice(0, q.answer.length - 1);
        else { const extra = q.options.map(o => o.k).find(k => !q.answer.includes(k)); answers[q.id] = extra ? [...q.answer, extra] : [...q.answer]; }
      } else if (q.type === 'judge') {
        answers[q.id] = q.answer === 'true' ? 'false' : 'true';
      } else {
        answers[q.id] = [['cat'], ['vim'], ['top'], ['ls']][Math.floor(rnd() * 4)];
      }
    }
    const tier = essayPool[i % 3];
    answers.q21 = tier.a21; answers.q22 = tier.a22;
    const submitAt = Date.now() - (9 - i) * 31 * 60 * 1000;
    const startAt = submitAt - (35 + (i % 15)) * 60 * 1000;
    const sheet = {
      id: 'sh_comp' + i, examId: exam2.id, studentId: 'u_stu' + i,
      startAt: new Date(startAt).toISOString(), submitAt: new Date(submitAt).toISOString(),
      answers, marked: [], switchCount: Math.floor(rnd() * 2),
      status: 'submitted', score: 0, details: [], pending: 0
    };
    gradeSheet(db, sheet);
    if (i <= 5) { // 已批改：写入主观题得分与评语
      sheet.details.forEach(d => {
        if (d.qid === 'q21') { d.score = tier.s21; d.correct = d.score === d.full; d.comment = tier.c; }
        if (d.qid === 'q22') { d.score = tier.s22; d.correct = d.score === d.full; d.comment = tier.c; }
      });
      sheet.score = round1(sheet.details.reduce((s, d) => s + (d.score || 0), 0));
      sheet.pending = 0;
    }
    db.sheets.push(sheet);
  }

  // 编程卷模拟答卷：6 份（学生01~06），判题结果预置（全对 / 部分通过 / 语法错误与超时），供判题与统计演示
  const codeTiers = [
    { js: "const data = require('fs').readFileSync(0, 'utf8').trim().split(/\\s+/).map(Number);\nconsole.log(data[0] + data[1]);", py: 'import sys\nnums = list(map(int, sys.stdin.read().strip().split()))\nprint(sum(nums))',
      j23: { passed: 3, cases: [['3 5', '8', '8', 'pass'], ['10 -4', '6', '6', 'pass'], ['0 0', '0', '0', 'pass']] },
      j24: { passed: 3, cases: [['5', '15', '15', 'pass'], ['10', '55', '55', 'pass'], ['100', '5050', '5050', 'pass']] } },
    { js: "const data = require('fs').readFileSync(0, 'utf8').trim().split(/\\s+/).map(Number);\nconsole.log(data[0] * data[1]);", py: 'import sys\nn = int(sys.stdin.read().strip())\nprint(n * (n + 1) // 2 if n != 100 else 5000)',
      j23: { passed: 1, cases: [['3 5', '8', '15', 'fail'], ['10 -4', '6', '-40', 'fail'], ['0 0', '0', '0', 'pass']] },
      j24: { passed: 2, cases: [['5', '15', '15', 'pass'], ['10', '55', '55', 'pass'], ['100', '5050', '5000', 'fail']] } },
    { js: 'const a = ;\nconsole.log(a);', py: 'while True:\n    pass',
      j23: { passed: 0, cases: [['3 5', '8', '', 'error'], ['10 -4', '6', '', 'error'], ['0 0', '0', '', 'error']] },
      j24: { passed: 0, cases: [['5', '15', '', 'timeout'], ['10', '55', '', 'timeout'], ['100', '5050', '', 'timeout']] } }
  ];
  for (let i = 1; i <= 6; i++) {
    const tier = codeTiers[(i - 1) % 3];
    const answers = { q1: 'A', q9: i % 2 ? ['A', 'B', 'C'] : ['A', 'B'], q23: tier.js, q24: tier.py };
    const submitAt = Date.now() - (7 - i) * 53 * 60 * 1000;
    const sheet = {
      id: 'sh_code' + i, examId: exam3.id, studentId: 'u_stu' + i,
      startAt: new Date(submitAt - 25 * 60 * 1000).toISOString(), submitAt: new Date(submitAt).toISOString(),
      answers, marked: [], switchCount: 0,
      status: 'submitted', score: 0, details: [], pending: 0
    };
    gradeSheet(db, sheet);
    sheet.details.forEach(d => {
      const j = d.qid === 'q23' ? tier.j23 : d.qid === 'q24' ? tier.j24 : null;
      if (!j) return;
      d.judge = { passed: j.passed, total: 3, cases: j.cases.map(c => ({ input: c[0], expected: c[1], actual: c[2], status: c[3], ms: 40 })) };
      d.score = round1(d.full * j.passed / 3); d.correct = j.passed === 3;
    });
    sheet.score = round1(sheet.details.reduce((s, d) => s + (d.score || 0), 0));
    sheet.pending = 0;
    db.sheets.push(sheet);
  }
  return db;
}

/* ---------------- 判分（PRD 4.2 口径） ---------------- */
function gradeOne(q, full, ans) {
  if (q.type === 'essay') return { score: null, correct: null }; // 主观题待人工批改
  if (ans === undefined || ans === null || ans === '' || (Array.isArray(ans) && ans.length === 0)) return { score: 0, correct: false };
  if (q.type === 'single' || q.type === 'judge') {
    const ok = String(ans) === String(q.answer);
    return { score: ok ? full : 0, correct: ok };
  }
  if (q.type === 'multi') {
    const sel = Array.isArray(ans) ? ans.map(String) : [String(ans)];
    const correct = q.answer.map(String);
    if (sel.some(s => !correct.includes(s))) return { score: 0, correct: false }; // 含错选 0 分
    const got = sel.filter(s => correct.includes(s)).length;
    const score = round1(full * got / correct.length); // 漏选按比例
    return { score, correct: score === full };
  }
  if (q.type === 'fill') {
    const blanks = q.answer; // 每空一个字符串，可含 | 分隔的等价答案
    const mine = Array.isArray(ans) ? ans : [ans];
    const per = full / blanks.length;
    let score = 0;
    blanks.forEach((b, idx) => {
      const v = String(mine[idx] === undefined ? '' : mine[idx]).trim();
      const ok = b.split('|').map(s => s.trim()).includes(v);
      if (ok) score += per;
    });
    score = round1(score);
    return { score, correct: score === full };
  }
  return { score: 0, correct: false };
}
function gradeSheet(db, sheet) {
  const exam = db.exams.find(e => e.id === sheet.examId);
  const paper = db.papers.find(p => p.id === (exam && exam.paperId));
  if (!paper) { sheet.score = 0; sheet.details = []; return; }
  const qmap = Object.fromEntries(db.questions.map(q => [q.id, q]));
  let total = 0, pending = 0;
  sheet.details = paper.items.map(it => {
    const q = qmap[it.qid];
    const ans = sheet.answers[it.qid];
    const g = q ? gradeOne(q, it.score, ans) : { score: 0, correct: false };
    if (g.score === null || g.score === undefined) pending++; else total += g.score;
    return { qid: it.qid, answer: ans === undefined ? null : ans, score: g.score, full: it.score, correct: g.correct, comment: '' };
  });
  sheet.score = round1(total);
  sheet.pending = pending;
}

/* ---------------- 编程题自动判题 ----------------
 * 学生代码在本机子进程中运行：JavaScript 用 node -e、Python 用 python3 -c，
 * 每条测试用例单独喂标准输入、单独限时 3 秒、输出限长，超时/报错计该用例不通过，
 * 得分 = 通过用例数 ÷ 总用例数 × 本题分值。
 * 注意：这是单机课堂演示用的轻量判题，未做系统级沙箱隔离，请勿在公网环境开放。 */
const JUDGE_TIMEOUT = 3000;
function normOut(s) { return String(s === undefined || s === null ? '' : s).replace(/\r\n/g, '\n').split('\n').map(x => x.replace(/\s+$/g, '')).join('\n').trim(); }
function runCase(lang, code, input) {
  return new Promise(resolve => {
    const cmd = lang === 'python' ? 'python3' : 'node';
    const args = lang === 'python' ? ['-c', code] : ['-e', code];
    let child;
    try { child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] }); }
    catch (e) { return resolve({ status: 'error', actual: '', ms: 0, err: String(e && e.message || e) }); }
    const t0 = Date.now();
    let out = '', err = '', done = false;
    const finish = r => { if (!done) { done = true; clearTimeout(timer); resolve(r); } };
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch (e) {} finish({ status: 'timeout', actual: normOut(out), ms: Date.now() - t0 }); }, JUDGE_TIMEOUT);
    child.stdout.on('data', d => { out += d; if (out.length > 65536) { try { child.kill('SIGKILL'); } catch (e) {} } });
    child.stderr.on('data', d => { err += d; if (err.length > 16384) err = err.slice(0, 16384); });
    child.on('error', e => finish({ status: 'error', actual: '', ms: Date.now() - t0, err: String(e && e.message || e) }));
    child.on('close', code2 => {
      const ms = Date.now() - t0;
      if (code2 === 0) finish({ status: 'ok', actual: normOut(out), ms });
      else finish({ status: 'error', actual: normOut(out), ms, err: err.trim().slice(-300) });
    });
    child.stdin.on('error', () => {});
    try { child.stdin.write(String(input === undefined ? '' : input)); child.stdin.end(); } catch (e) {}
  });
}
async function judgeCode(q, code) {
  const cases = Array.isArray(q.cases) ? q.cases : [];
  const src = String(code === undefined || code === null ? '' : code);
  if (!src.trim()) return { passed: 0, total: cases.length, cases: cases.map(c => ({ input: c.input, expected: c.expected, actual: '', status: 'empty', ms: 0 })) };
  if (src.length > 20000) return { passed: 0, total: cases.length, cases: cases.map(c => ({ input: c.input, expected: c.expected, actual: '', status: 'error', ms: 0, err: '代码超过 20000 字符上限' })) };
  const results = [];
  for (const c of cases) {
    const r = await runCase(q.language === 'python' ? 'python' : 'javascript', src, c.input);
    const status = r.status === 'ok' ? (r.actual === normOut(c.expected) ? 'pass' : 'fail') : r.status;
    results.push({ input: c.input, expected: c.expected, actual: String(r.actual || '').slice(0, 500), status, ms: r.ms, err: r.err ? String(r.err).slice(0, 300) : undefined });
  }
  return { passed: results.filter(x => x.status === 'pass').length, total: cases.length, cases: results };
}
function judgeForStudent(judge, revealExpected) {
  if (!judge || revealExpected) return judge;
  return { ...judge, cases: (judge.cases || []).map(({ expected, ...item }) => item) };
}
async function gradeOneAsync(q, full, ans) {
  if (q.type !== 'code') return gradeOne(q, full, ans);
  if (ans === undefined || ans === null || !String(ans).trim()) return { score: 0, correct: false, judge: { passed: 0, total: (q.cases || []).length, cases: [] } };
  const judge = await judgeCode(q, ans);
  const score = judge.total ? round1(full * judge.passed / judge.total) : 0;
  return { score, correct: judge.total > 0 && judge.passed === judge.total, judge };
}
async function gradeSheetAsync(db, sheet) {
  const exam = db.exams.find(e => e.id === sheet.examId);
  const paper = db.papers.find(p => p.id === (exam && exam.paperId));
  if (!paper) { sheet.score = 0; sheet.details = []; sheet.pending = 0; return; }
  const qmap = Object.fromEntries(db.questions.map(q => [q.id, q]));
  let total = 0, pending = 0;
  sheet.details = [];
  for (const it of paper.items) {
    const q = qmap[it.qid];
    const ans = sheet.answers[it.qid];
    const g = q ? await gradeOneAsync(q, it.score, ans) : { score: 0, correct: false };
    if (g.score === null || g.score === undefined) pending++; else total += g.score;
    sheet.details.push({ qid: it.qid, answer: ans === undefined ? null : ans, score: g.score, full: it.score, correct: g.correct, comment: '', judge: g.judge || undefined });
  }
  sheet.score = round1(total);
  sheet.pending = pending;
}

const sheetSubmissions = new Map();
const sheetExpiryTimers = new Map();
function sheetDeadline(ex, sheet) {
  const startedAt = Date.parse(sheet.startAt);
  const examEndsAt = Date.parse(ex.endTime);
  const durationMin = Number(ex.durationMin) || 30;
  return Math.min(Number.isFinite(startedAt) ? startedAt + durationMin * 60000 : 0, Number.isFinite(examEndsAt) ? examEndsAt : 0);
}
function sheetExpired(ex, sheet, now = Date.now()) { return now >= sheetDeadline(ex, sheet); }
function scheduleSheetExpiry(ex, sheet) {
  if (sheet.status !== 'answering') return;
  const existing = sheetExpiryTimers.get(sheet.id);
  if (existing) clearTimeout(existing);
  const remaining = ex.stoppedAt ? 0 : sheetDeadline(ex, sheet) - Date.now();
  const timer = setTimeout(() => {
    sheetExpiryTimers.delete(sheet.id);
    if (sheet.status !== 'answering') return;
    const currentExam = byId(DB.exams, sheet.examId);
    if (!currentExam) return;
    if (currentExam.stoppedAt) finalizeSheet(sheet, 'stopped', currentExam.stoppedAt).catch(console.error);
    else if (sheetExpired(currentExam, sheet)) finalizeSheet(sheet, 'timeout').catch(console.error);
    else scheduleSheetExpiry(currentExam, sheet);
  }, Math.min(Math.max(remaining, 0), 2147483647));
  timer.unref();
  sheetExpiryTimers.set(sheet.id, timer);
}
function resetSheetExpiryTimers() {
  for (const timer of sheetExpiryTimers.values()) clearTimeout(timer);
  sheetExpiryTimers.clear();
  for (const sheet of DB.sheets) {
    const ex = DB.exams.find(item => item.id === sheet.examId);
    if (ex && sheet.status === 'answering') scheduleSheetExpiry(ex, sheet);
  }
}
async function finalizeSheet(sheet, reason, submittedAt = nowISO()) {
  if (sheet.status === 'submitted') return sheet;
  const timer = sheetExpiryTimers.get(sheet.id);
  if (timer) clearTimeout(timer);
  sheetExpiryTimers.delete(sheet.id);
  const pending = sheetSubmissions.get(sheet.id);
  if (pending) { await pending; return sheet; }
  const task = (async () => {
    sheet.submitAt = submittedAt;
    sheet.submitReason = reason;
    await gradeSheetAsync(DB, sheet);
    sheet.status = 'submitted';
    saveDB();
  })();
  sheetSubmissions.set(sheet.id, task);
  try { await task; return sheet; }
  finally { sheetSubmissions.delete(sheet.id); }
}

/* ---------------- AI 模型接口（OpenAI 兼容 /chat/completions） ---------------- */
function aiCfg() { const a = (DB.settings && DB.settings.ai) || {}; return { enabled: !!a.enabled, baseUrl: String(a.baseUrl || '').replace(/\/+$/, ''), apiKey: String(a.apiKey || ''), model: String(a.model || '') }; }
async function callAI(messages) {
  const cfg = aiCfg();
  if (!cfg.enabled) throw new Error('AI 接口未启用，请管理员在「AI 接口设置」页开启并保存配置');
  if (!cfg.baseUrl || !cfg.model) throw new Error('AI 接口未配置完整（缺少接口地址或模型名），请管理员在「AI 接口设置」页设置');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 45000);
  let resp;
  try {
    resp = await fetch(cfg.baseUrl + '/chat/completions', {
      method: 'POST', signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', ...(cfg.apiKey ? { Authorization: 'Bearer ' + cfg.apiKey } : {}) },
      body: JSON.stringify({ model: cfg.model, messages, temperature: 0.2 })
    });
  } catch (e) {
    throw new Error(e && e.name === 'AbortError' ? 'AI 接口调用超时（45 秒），请检查网络或换用更快的模型' : '无法连接 AI 接口：' + (e && e.message || e));
  } finally { clearTimeout(timer); }
  const text = await resp.text();
  if (!resp.ok) throw new Error(`AI 接口返回 ${resp.status}：${text.slice(0, 200)}`);
  let data; try { data = JSON.parse(text); } catch { throw new Error('AI 接口响应不是合法 JSON'); }
  const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!content) throw new Error('AI 接口响应中没有内容');
  return String(content);
}
async function callAIJson(messages) {
  const content = await callAI(messages);
  const m = content.replace(/```json|```/g, '');
  const s = m.indexOf('{'), e = m.lastIndexOf('}');
  if (s < 0 || e <= s) throw new Error('AI 未返回可解析的 JSON，请重试');
  try { return JSON.parse(m.slice(s, e + 1)); } catch { throw new Error('AI 返回的 JSON 解析失败，请重试'); }
}

/* ---------------- 数据存取 ---------------- */
let DB;
function saveDB() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const tmp = DB_PATH + '.tmp';
  const data = JSON.stringify(DB, null, 1);
  const fd = fs.openSync(tmp, 'w');
  try { fs.writeFileSync(fd, data); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  try { if (fs.existsSync(DB_PATH)) fs.copyFileSync(DB_PATH, DB_PATH + '.bak'); } catch (e) { console.error('备份数据文件失败：', e.message); }
  fs.renameSync(tmp, DB_PATH);
}
function loadDB() {
  for (const file of [DB_PATH, DB_PATH + '.bak']) {
    if (!fs.existsSync(file)) continue;
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (data && typeof data === 'object') return { db: data, file };
    } catch (e) { console.error('数据文件读取失败：', file, e.message); }
  }
  return null;
}
const loadedDB = loadDB();
if (loadedDB) {
  DB = loadedDB.db;
  if (loadedDB.file !== DB_PATH) { console.error('主数据文件损坏，已从备份恢复：', loadedDB.file); saveDB(); }
} else {
  if (fs.existsSync(DB_PATH)) throw new Error('data/db.json 无法解析，请检查文件或删除后重启以重建演示数据');
  DB = seed(); saveDB();
}
if (!DB.settings) DB.settings = { ai: { enabled: false, baseUrl: '', apiKey: '', model: '' } };
resetSheetExpiryTimers();

const TOKEN_TTL = 12 * 3600 * 1000;
const LOGIN_WINDOW = 10 * 60 * 1000, LOGIN_MAX = 10, LOGIN_LOCK = 5 * 60 * 1000;
const tokens = new Map(); // token -> { userId, expiresAt }
const loginAttempts = new Map(); // username@ip -> { count, firstAt, lockedUntil }
function issueToken(userId) {
  const token = crypto.randomBytes(24).toString('hex');
  tokens.set(token, { userId, expiresAt: Date.now() + TOKEN_TTL });
  return token;
}
function tokenOf(req) { const m = /^Bearer (.+)$/.exec(req.headers.authorization || ''); return m ? m[1] : ''; }
function revokeUserTokens(userId, exceptToken) { for (const [t, rec] of tokens) if (rec.userId === userId && t !== exceptToken) tokens.delete(t); }
function loginKey(req, username) { return String(username || '').toLowerCase() + '@' + ((req.socket && req.socket.remoteAddress) || 'unknown'); }
function loginLockSeconds(key) {
  const a = loginAttempts.get(key);
  if (!a) return 0;
  const now = Date.now();
  if (a.lockedUntil && a.lockedUntil > now) return Math.ceil((a.lockedUntil - now) / 1000);
  if (now - a.firstAt > LOGIN_WINDOW) loginAttempts.delete(key);
  return 0;
}
function noteLoginFailure(key) {
  const now = Date.now();
  let a = loginAttempts.get(key);
  if (!a || now - a.firstAt > LOGIN_WINDOW) a = { count: 0, firstAt: now };
  a.count++;
  if (a.count >= LOGIN_MAX) { a.lockedUntil = now + LOGIN_LOCK; a.count = 0; a.firstAt = now; }
  loginAttempts.set(key, a);
  if (loginAttempts.size > 5000) { for (const [k, v] of loginAttempts) if (!v.lockedUntil || v.lockedUntil < now) loginAttempts.delete(k); }
}
const byId = (arr, id) => arr.find(x => x.id === id);
function examStatus(ex) { if (ex.stoppedAt) return '已停止'; const n = Date.now(); if (n < Date.parse(ex.startTime)) return '未开始'; if (n > Date.parse(ex.endTime)) return '已结束'; return '进行中'; }
function publicUser(u) { return { id: u.id, username: u.username, name: u.name, role: u.role, className: u.className, status: u.status || 'active' }; }

/* 练习会话：答题/判分只接受本次练习下发过的题目，避免按任意 qid 换取答案 */
const PRACTICE_TTL = 2 * 3600 * 1000;
const practiceSessions = new Map(); // id -> { userId, qids:Set, expiresAt }
function newPracticeSession(userId, qids) {
  const id = crypto.randomBytes(12).toString('hex');
  practiceSessions.set(id, { userId, qids: new Set(qids), expiresAt: Date.now() + PRACTICE_TTL });
  if (practiceSessions.size > 2000) { const now = Date.now(); for (const [k, v] of practiceSessions) if (v.expiresAt <= now) practiceSessions.delete(k); }
  return id;
}
function practiceSessionFor(userId, sessionId) {
  const key = String(sessionId || '');
  const s = practiceSessions.get(key);
  if (!s) return null;
  if (s.expiresAt <= Date.now()) { practiceSessions.delete(key); return null; }
  return s.userId === userId ? s : null;
}
/* 未开始或进行中的考试题目：练习和错题重练不得提前泄露答案 */
function activeExamQids() {
  const ids = new Set();
  const papers = new Map(DB.papers.map(p => [p.id, p]));
  for (const ex of DB.exams) {
    if (ex.archivedAt || !['未开始', '进行中'].includes(examStatus(ex))) continue;
    const paper = papers.get(ex.paperId);
    if (paper) for (const it of paper.items) ids.add(it.qid);
  }
  return ids;
}
function studentWrongbookQids(studentId) {
  const set = new Set();
  for (const s of DB.sheets) {
    if (s.studentId !== studentId || s.status !== 'submitted') continue;
    const ex = byId(DB.exams, s.examId);
    if (!ex || !ex.showAnswer) continue;
    for (const d of s.details || []) {
      if (d.score === null || d.score === undefined || d.score >= d.full) continue;
      set.add(d.qid);
    }
  }
  return set;
}

/* ---------------- HTTP 基础 ---------------- */
const SECURITY_HEADERS = { 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer' };
function send(res, code, obj, headers) {
  const body = typeof obj === 'string' ? obj : JSON.stringify(obj);
  res.writeHead(code, Object.assign({}, SECURITY_HEADERS, { 'Content-Type': typeof obj === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8' }, headers || {}));
  res.end(body);
}
const ok = (res, data) => send(res, 200, { ok: true, data });
const fail = (res, code, msg) => send(res, code, { ok: false, error: msg });
const csvCell = v => { const s = String(v === undefined || v === null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
function normQuestion(body, createdBy) {
  const type = body.type;
  if (!['single', 'multi', 'judge', 'fill', 'essay', 'code'].includes(type)) return { error: '题型不正确' };
  if (!String(body.stem || '').trim()) return { error: '题干为空' };
  const q = { type, stem: String(body.stem), options: [], answer: body.answer, analysis: String(body.analysis || ''), score: Number(body.score) || 5, difficulty: ['易', '中', '难'].includes(body.difficulty) ? body.difficulty : '易', tag: String(body.tag || ''), subject: String(body.subject || 'Linux基础'), createdBy };
  if (type === 'single') { q.options = Array.isArray(body.options) ? body.options : []; if (q.options.length < 2) return { error: '选择题至少需要 2 个选项' }; if (!q.options.some(o => o.k === q.answer)) return { error: '单选答案不在选项中' }; }
  if (type === 'multi') { q.options = Array.isArray(body.options) ? body.options : []; if (!Array.isArray(q.answer) || !q.answer.length) return { error: '多选答案为空' }; if (q.answer.some(a => !q.options.some(o => o.k === a))) return { error: '多选答案不在选项中' }; }
  if (type === 'judge') { if (!['true', 'false'].includes(String(q.answer))) return { error: '判断题答案须为 true/false' }; q.answer = String(q.answer); }
  if (type === 'fill') { if (!Array.isArray(q.answer) || !q.answer.length || q.answer.some(a => !String(a).trim())) return { error: '填空答案不完整' }; q.answer = q.answer.map(String); }
  if (type === 'essay') { if (!String(q.answer || '').trim()) return { error: '简答题缺少参考答案' }; q.answer = String(q.answer); }
  if (type === 'code') {
    if (!['javascript', 'python'].includes(body.language)) return { error: '编程题须选择语言（JavaScript / Python）' };
    const cases = Array.isArray(body.cases) ? body.cases.map(c => ({ input: String((c && c.input) || ''), expected: String((c && c.expected) || '') })) : [];
    if (!cases.length) return { error: '编程题至少需要 1 个测试用例' };
    if (cases.some(c => c.expected === '')) return { error: '每个测试用例都要有期望输出' };
    if (cases.length > 20) return { error: '测试用例最多 20 个' };
    q.language = body.language; q.cases = cases; q.template = String(body.template || ''); q.answer = String(body.answer || '');
  }
  return { q };
}
function normalizePaperItems(raw, userId) {
  if (!Array.isArray(raw) || !raw.length) return { error: '试卷至少要有一道题' };
  const qmap = new Map(DB.questions.map(q => [q.id, q]));
  const seen = new Set();
  const items = [];
  for (const it of raw) {
    const qid = String((it && it.qid) || '');
    const q = qmap.get(qid);
    if (!q || q.createdBy !== userId) return { error: '存在无效或不属于当前教师的题目' };
    if (seen.has(qid)) return { error: '试卷中存在重复题目' };
    seen.add(qid);
    const score = Number(it && it.score);
    if (!Number.isFinite(score) || score <= 0 || score > 1000) return { error: '题目分值必须是 0 到 1000 之间的正数' };
    items.push({ qid, score: round1(score) });
  }
  return { items };
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let buf = '', done = false;
    const tooLarge = () => {
      if (done) return;
      done = true;
      const err = new Error('请求体超过 2MB 上限');
      err.statusCode = 413;
      reject(err);
      try { req.destroy(); } catch (e) {}
    };
    req.on('data', c => { if (done) return; buf += c; if (buf.length > 2e6) tooLarge(); });
    req.on('end', () => { if (done) return; done = true; try { resolve(buf ? JSON.parse(buf) : {}); } catch { resolve({}); } });
    req.on('error', e => { if (done) return; done = true; reject(e); });
  });
}
function auth(req, roles) {
  const token = tokenOf(req);
  if (!token) return null;
  const rec = tokens.get(token);
  if (!rec) return null;
  if (rec.expiresAt <= Date.now()) { tokens.delete(token); return null; }
  const u = byId(DB.users, rec.userId);
  if (!u) { tokens.delete(token); return null; }
  if (roles && !roles.includes(u.role)) return null;
  return u;
}

/* ---------------- API ---------------- */
async function api(req, res, url) {
  const p = url.pathname, method = req.method;
  const body = (method === 'POST' || method === 'PUT') ? await readBody(req) : {};

  // 登录
  if (p === '/api/login' && method === 'POST') {
    const username = String(body.username || '').trim();
    const key = loginKey(req, username);
    const locked = loginLockSeconds(key);
    if (locked) return fail(res, 429, `登录失败次数过多，请 ${locked} 秒后再试`);
    const u = DB.users.find(x => x.username === username);
    if (!u || !verifyPw(String(body.password || ''), u.password)) {
      noteLoginFailure(key);
      return fail(res, 401, '账号或密码不正确');
    }
    if (u.status === 'pending') return fail(res, 403, '该账号已注册，正在等待管理员审核');
    loginAttempts.delete(key);
    if (isLegacyHash(u.password)) { u.password = hashPw(String(body.password || '')); saveDB(); }
    return ok(res, { token: issueToken(u.id), user: publicUser(u) });
  }
  if (p === '/api/logout' && method === 'POST') {
    const t = tokenOf(req);
    if (t) tokens.delete(t);
    return ok(res, { loggedOut: true });
  }

  // 自助注册（学生注册即生效，教师注册需管理员审核）
  if (p === '/api/register' && method === 'POST') {
    const username = String(body.username || '').trim();
    const name = String(body.name || '').trim();
    const password = String(body.password || '');
    if (!username || !name) return fail(res, 400, '账号和姓名不能为空');
    if (password.length < 6) return fail(res, 400, '密码至少 6 位');
    if (!['student', 'teacher'].includes(body.role)) return fail(res, 400, '只能注册学生或教师账号');
    if (DB.users.some(u => u.username === username)) return fail(res, 400, '该账号已被注册');
    const u = { id: 'u' + (++DB.seq.user), username, password: hashPw(password), name, role: body.role, className: body.role === 'student' ? String(body.className || '').trim() : '', status: body.role === 'teacher' ? 'pending' : 'active', wrongDismissed: [] };
    DB.users.push(u); saveDB();
    return ok(res, { registered: username, status: u.status });
  }
  if (p === '/api/public/classes' && method === 'GET') return ok(res, DB.classes || []);

  const me = auth(req);
  if (!me) return fail(res, 401, '未登录或登录已失效');
  if (p === '/api/me') return ok(res, publicUser(me));
  if (p === '/api/me/password' && method === 'POST') {
    if (!verifyPw(String(body.oldPassword || ''), me.password)) return fail(res, 400, '原密码不正确');
    const np = String(body.newPassword || '');
    if (np.length < 6) return fail(res, 400, '新密码至少 6 位');
    me.password = hashPw(np);
    revokeUserTokens(me.id, tokenOf(req));
    saveDB();
    return ok(res, { changed: true });
  }
  if (p === '/api/me/profile' && method === 'POST') {
    const name = String(body.name || '').trim();
    if (!name) return fail(res, 400, '姓名不能为空');
    me.name = name;
    if (body.className !== undefined) me.className = String(body.className).trim();
    saveDB();
    return ok(res, publicUser(me));
  }

  const teacher = () => auth(req, ['teacher']) || (fail(res, 403, '需要教师权限'), null);
  const student = () => auth(req, ['student']) || (fail(res, 403, '需要学生权限'), null);
  const admin = () => auth(req, ['admin']) || (fail(res, 403, '需要管理员权限'), null);

  /* ----- 题库（教师） ----- */
  if (p === '/api/questions' && method === 'GET') {
    if (!teacher()) return;
    let list = DB.questions.filter(q => q.createdBy === me.id);
    const { type, difficulty, keyword } = Object.fromEntries(url.searchParams);
    if (type) list = list.filter(q => q.type === type);
    if (difficulty) list = list.filter(q => q.difficulty === difficulty);
    if (keyword) list = list.filter(q => q.stem.includes(keyword) || (q.tag || '').includes(keyword));
    return ok(res, list);
  }
  if (p === '/api/questions' && method === 'POST') {
    if (!teacher()) return;
    const r = normQuestion(body, me.id);
    if (r.error) return fail(res, 400, r.error);
    r.q.id = 'q' + (++DB.seq.question);
    DB.questions.push(r.q); saveDB();
    return ok(res, r.q);
  }
  if (p === '/api/questions/import' && method === 'POST') {
    if (!teacher()) return;
    const items = Array.isArray(body.items) ? body.items : [];
    if (!items.length) return fail(res, 400, '没有可导入的题目');
    if (items.length > 500) return fail(res, 400, '单次最多导入 500 道题');
    let created = 0; const errors = [];
    items.forEach((it, i) => {
      const r = normQuestion(it || {}, me.id);
      if (r.error) errors.push({ row: i + 1, error: r.error });
      else { r.q.id = 'q' + (++DB.seq.question); DB.questions.push(r.q); created++; }
    });
    saveDB();
    return ok(res, { created, errors });
  }
  if (p === '/api/questions/export' && method === 'GET') {
    if (!teacher()) return;
    const typeZh = { single: '单选', multi: '多选', judge: '判断', fill: '填空', essay: '简答', code: '编程' };
    const lines = ['题型,题干,选项A,选项B,选项C,选项D,正确答案,解析,分值,难度,知识点,科目'];
    DB.questions.filter(q => q.createdBy === me.id).forEach(q => {
      const opt = k => { const o = (q.options || []).find(x => x.k === k); return o ? o.t : ''; };
      const ans = q.type === 'multi' ? q.answer.join(',') : q.type === 'judge' ? (q.answer === 'true' ? '对' : '错') : q.type === 'fill' ? q.answer.join(';') : q.answer;
      lines.push([typeZh[q.type], q.stem, opt('A'), opt('B'), opt('C'), opt('D'), ans, q.analysis, q.score, q.difficulty, q.tag, q.subject].map(csvCell).join(','));
    });
    res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="questions.csv"' });
    return res.end('\ufeff' + lines.join('\r\n'));
  }
  const qMatch = /^\/api\/questions\/(.+)$/.exec(p);
  if (qMatch && method === 'PUT') {
    if (!teacher()) return;
    const q = byId(DB.questions, qMatch[1]);
    if (!q || q.createdBy !== me.id) return fail(res, 404, '题目不存在');
    const r = normQuestion(body, me.id);
    if (r.error) return fail(res, 400, r.error);
    Object.assign(q, r.q);
    saveDB(); return ok(res, q);
  }
  if (qMatch && method === 'DELETE') {
    if (!teacher()) return;
    const q = byId(DB.questions, qMatch[1]);
    if (!q || q.createdBy !== me.id) return fail(res, 404, '题目不存在');
    if (DB.papers.some(pp => pp.items.some(it => it.qid === q.id))) return fail(res, 400, '题目已被试卷引用，不能删除（可先从试卷移除）');
    DB.questions = DB.questions.filter(x => x.id !== q.id); saveDB();
    return ok(res, { deleted: q.id });
  }

  /* ----- 组卷（教师） ----- */
  if (p === '/api/papers/random-preview' && method === 'POST') {
    if (!teacher()) return;
    const picked = [];
    for (const rule of body.rules || []) {
      const need = [['易', rule.easy || 0], ['中', rule.mid || 0], ['难', rule.hard || 0]];
      for (const [diff, cnt] of need) {
        const pool = DB.questions.filter(q => q.createdBy === me.id && q.type === rule.type && q.difficulty === diff && !picked.some(x => x.id === q.id));
        pool.sort(() => Math.random() - 0.5);
        if (pool.length < cnt) return fail(res, 400, `题库中${rule.type}/${diff}只有 ${pool.length} 道，不足 ${cnt} 道`);
        picked.push(...pool.slice(0, cnt));
      }
    }
    return ok(res, picked);
  }
  if (p === '/api/papers/replace-one' && method === 'POST') {
    if (!teacher()) return;
    const exclude = new Set(body.exclude || []);
    const pool = DB.questions.filter(q => q.createdBy === me.id && q.type === body.type && q.difficulty === body.difficulty && !exclude.has(q.id));
    if (!pool.length) return fail(res, 400, '题库中没有可替换的同类题目');
    return ok(res, pool[Math.floor(Math.random() * pool.length)]);
  }
  if (p === '/api/papers' && method === 'GET') {
    if (!teacher()) return;
    const qmap = Object.fromEntries(DB.questions.map(q => [q.id, q]));
    return ok(res, DB.papers.filter(pp => pp.createdBy === me.id).map(pp => ({ ...pp, items: pp.items.map(it => ({ ...it, question: qmap[it.qid] || null })) })));
  }
  if (p === '/api/papers' && method === 'POST') {
    if (!teacher()) return;
    const parsed = normalizePaperItems(body.items, me.id);
    if (parsed.error) return fail(res, 400, parsed.error);
    const items = parsed.items;
    const paper = { id: 'p' + (++DB.seq.paper), name: body.name || '未命名试卷', subject: body.subject || 'Linux基础', createdBy: me.id, createdAt: nowISO(), items, total: round1(items.reduce((s, it) => s + it.score, 0)) };
    DB.papers.push(paper); saveDB();
    return ok(res, paper);
  }
  const pMatch = /^\/api\/papers\/(.+)$/.exec(p);
  if (pMatch && method === 'PUT') {
    if (!teacher()) return;
    const pp = byId(DB.papers, pMatch[1]);
    if (!pp || pp.createdBy !== me.id) return fail(res, 404, '试卷不存在');
    if (DB.exams.some(e => e.paperId === pp.id && examStatus(e) !== '未开始')) return fail(res, 400, '试卷已被进行中或已结束的考试使用，不能修改（可新建一份）');
    const items = (body.items || []).map(it => ({ qid: it.qid, score: Number(it.score) || 5 }));
    if (!items.length) return fail(res, 400, '试卷至少要有一道题');
    pp.name = body.name || pp.name; pp.subject = body.subject || pp.subject; pp.items = items;
    pp.total = round1(items.reduce((s, it) => s + it.score, 0));
    saveDB(); return ok(res, pp);
  }
  if (pMatch && method === 'DELETE') {
    if (!teacher()) return;
    const pp = byId(DB.papers, pMatch[1]);
    if (!pp || pp.createdBy !== me.id) return fail(res, 404, '试卷不存在');
    if (DB.exams.some(e => e.paperId === pp.id)) return fail(res, 400, '试卷已被考试引用，不能删除');
    DB.papers = DB.papers.filter(x => x.id !== pp.id); saveDB();
    return ok(res, { deleted: pp.id });
  }
  const pDupMatch = /^\/api\/papers\/(.+)\/duplicate$/.exec(p);
  if (pDupMatch && method === 'POST') {
    if (!teacher()) return;
    const pp = byId(DB.papers, pDupMatch[1]);
    if (!pp || pp.createdBy !== me.id) return fail(res, 404, '试卷不存在');
    const copy = { ...pp, id: 'p' + (++DB.seq.paper), name: pp.name + '（副本）', createdAt: nowISO(), items: pp.items.map(it => ({ ...it })) };
    DB.papers.push(copy); saveDB();
    return ok(res, copy);
  }

  /* ----- 考试（教师发布 / 列表） ----- */
  if (p === '/api/exams' && method === 'GET') {
    let list = DB.exams;
    if (me.role === 'teacher') {
      const archived = url.searchParams.get('archived') === '1';
      list = list.filter(e => e.createdBy === me.id && !!e.archivedAt === archived);
    } else if (me.role === 'student') list = list.filter(e => !e.archivedAt);
    const data = list.map(e => {
      const sheets = DB.sheets.filter(s => s.examId === e.id);
      const sub = sheets.filter(s => s.status === 'submitted');
      const mine = me.role === 'student' ? sheets.find(s => s.studentId === me.id) : null;
      return {
        ...e, status: examStatus(e),
        joined: sheets.length, submitted: sub.length,
        avg: sub.length ? round1(sub.reduce((s, x) => s + x.score, 0) / sub.length) : null,
        pendingGrading: sheets.filter(s => s.status === 'submitted' && (s.pending || 0) > 0).length,
        mySheet: mine ? { id: mine.id, status: mine.status, score: mine.status === 'submitted' ? mine.score : null } : null
      };
    });
    return ok(res, data);
  }
  if (p === '/api/exams' && method === 'POST') {
    if (!teacher()) return;
    const paper = byId(DB.papers, body.paperId);
    if (!paper || paper.createdBy !== me.id) return fail(res, 400, '试卷不存在');
    const startAt = Date.parse(body.startTime), endAt = Date.parse(body.endTime);
    const durationMin = body.durationMin === undefined ? 30 : Number(body.durationMin);
    if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || endAt <= startAt) return fail(res, 400, '考试时间无效，结束时间必须晚于开始时间');
    if (!Number.isInteger(durationMin) || durationMin < 1) return fail(res, 400, '考试时长必须是正整数分钟');
    const ex = { id: 'ex' + (++DB.seq.exam), name: body.name || '未命名考试', paperId: paper.id, createdBy: me.id, startTime: body.startTime, endTime: body.endTime, durationMin, switchLimit: Math.max(0, Number(body.switchLimit) || 0), showAnswer: !!body.showAnswer, note: body.note || '' };
    DB.exams.push(ex); saveDB();
    return ok(res, ex);
  }
  const exMatch = /^\/api\/exams\/(.+)$/.exec(p);
  if (exMatch && method === 'PUT') {
    if (!teacher()) return;
    const ex = byId(DB.exams, exMatch[1]);
    if (!ex || ex.createdBy !== me.id) return fail(res, 404, '考试不存在');
    if (examStatus(ex) !== '未开始') return fail(res, 400, '考试已开考或结束，不能编辑');
    const paper = byId(DB.papers, body.paperId);
    if (!paper || paper.createdBy !== me.id) return fail(res, 400, '试卷不存在');
    const startAt = Date.parse(body.startTime), endAt = Date.parse(body.endTime);
    const durationMin = body.durationMin === undefined ? ex.durationMin : Number(body.durationMin);
    if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || endAt <= startAt) return fail(res, 400, '考试时间无效，结束时间必须晚于开始时间');
    if (!Number.isInteger(durationMin) || durationMin < 1) return fail(res, 400, '考试时长必须是正整数分钟');
    Object.assign(ex, { name: body.name || ex.name, paperId: paper.id, startTime: body.startTime, endTime: body.endTime, durationMin, switchLimit: Math.max(0, Number(body.switchLimit) || 0), showAnswer: !!body.showAnswer, note: body.note || '' });
    saveDB(); return ok(res, ex);
  }
  if (exMatch && method === 'DELETE') {
    if (!teacher()) return;
    const ex = byId(DB.exams, exMatch[1]);
    if (!ex || ex.createdBy !== me.id) return fail(res, 404, '考试不存在');
    if (examStatus(ex) !== '未开始') return fail(res, 400, '考试已开考或结束，不能删除');
    DB.exams = DB.exams.filter(x => x.id !== ex.id); DB.sheets = DB.sheets.filter(s => s.examId !== ex.id); saveDB();
    return ok(res, { deleted: ex.id });
  }
  const exDupMatch = /^\/api\/exams\/(.+)\/duplicate$/.exec(p);
  if (exDupMatch && method === 'POST') {
    if (!teacher()) return;
    const ex = byId(DB.exams, exDupMatch[1]);
    if (!ex || ex.createdBy !== me.id) return fail(res, 404, '考试不存在');
    const win = Date.parse(ex.endTime) - Date.parse(ex.startTime);
    const start = new Date(); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() + 1);
    const copy = { ...ex, id: 'ex' + (++DB.seq.exam), name: ex.name + '（副本）', startTime: start.toISOString(), endTime: new Date(start.getTime() + win).toISOString() };
    delete copy.stoppedAt;
    DB.exams.push(copy); saveDB();
    return ok(res, copy);
  }

  const archiveMatch = /^\/api\/exams\/(.+)\/(archive|unarchive)$/.exec(p);
  if (archiveMatch && method === 'POST') {
    if (!teacher()) return;
    const ex = byId(DB.exams, archiveMatch[1]);
    if (!ex || ex.createdBy !== me.id) return fail(res, 404, '考试不存在');
    if (archiveMatch[2] === 'archive') {
      if (examStatus(ex) === '进行中') return fail(res, 400, '请先停止考试，再归档');
      if (!ex.archivedAt) ex.archivedAt = nowISO();
    } else delete ex.archivedAt;
    saveDB();
    return ok(res, { archived: !!ex.archivedAt, examId: ex.id });
  }

  const stopMatch = /^\/api\/exams\/(.+)\/stop$/.exec(p);
  if (stopMatch && method === 'POST') {
    if (!teacher()) return;
    const ex = byId(DB.exams, stopMatch[1]);
    if (!ex || ex.createdBy !== me.id) return fail(res, 404, '考试不存在');
    if (!ex.stoppedAt && examStatus(ex) !== '进行中') return fail(res, 400, '只有进行中的考试可以停止');
    if (!ex.stoppedAt) { ex.stoppedAt = nowISO(); saveDB(); }
    let submitted = 0;
    for (const sheet of DB.sheets.filter(s => s.examId === ex.id && s.status === 'answering')) {
      await finalizeSheet(sheet, 'stopped', ex.stoppedAt);
      submitted++;
    }
    return ok(res, { stoppedAt: ex.stoppedAt, submitted });
  }

  /* ----- 成绩统计（教师） ----- */
  const statsMatch = /^\/api\/exams\/(.+)\/stats$/.exec(p);
  if (statsMatch && method === 'GET') {
    if (!teacher()) return;
    const ex = byId(DB.exams, statsMatch[1]);
    if (!ex || ex.createdBy !== me.id) return fail(res, 404, '考试不存在');
    const paper = byId(DB.papers, ex.paperId);
    const qmap = Object.fromEntries(DB.questions.map(q => [q.id, q]));
    const submitted = DB.sheets.filter(s => s.examId === ex.id && s.status === 'submitted');
    const gradedOnly = submitted.filter(s => (s.pending || 0) === 0);
    const totalScore = paper ? paper.total : 100;
    const scores = gradedOnly.map(s => s.score);
    const pct = s => totalScore ? s / totalScore * 100 : s;
    const dist = { '0-59': 0, '60-69': 0, '70-79': 0, '80-89': 0, '90-100': 0 };
    gradedOnly.forEach(s => { const v = pct(s.score); if (v < 60) dist['0-59']++; else if (v < 70) dist['60-69']++; else if (v < 80) dist['70-79']++; else if (v < 90) dist['80-89']++; else dist['90-100']++; });
    const perQuestion = (paper ? paper.items : []).map((it, idx) => {
      const q = qmap[it.qid];
      const rel = submitted.map(s => s.details.find(d => d.qid === it.qid)).filter(d => d && d.score !== null && d.score !== undefined);
      const fullCount = rel.filter(d => d.correct).length;
      const avgScore = rel.length ? round1(rel.reduce((s, d) => s + d.score, 0) / rel.length) : 0;
      const correctRate = !rel.length ? 0 : (q && (q.type === 'essay' || q.type === 'code') ? round1(avgScore / it.score * 100) : Math.round(fullCount / rel.length * 1000) / 10);
      return { idx: idx + 1, qid: it.qid, stem: q ? q.stem : '(题目已删除)', type: q ? q.type : '', full: it.score, correctRate, avgScore };
    });
    const wrongTop = [...perQuestion].sort((a, b) => a.correctRate - b.correctRate).slice(0, 10);
    const rows = submitted.map(s => { const u = byId(DB.users, s.studentId); return { sheetId: s.id, student: u ? u.name : '?', username: u ? u.username : '', className: u ? u.className : '', score: s.score, pending: s.pending || 0, submitReason: s.submitReason || 'manual', switchCount: s.switchCount, flagged: s.switchCount > 3, submitAt: s.submitAt }; }).sort((a, b) => b.score - a.score);
    const tagQ = {}; (paper ? paper.items : []).forEach(it => { const q = qmap[it.qid]; const tag = (q && q.tag) || '未标注'; tagQ[tag] = (tagQ[tag] || 0) + 1; });
    const tagAgg = {};
    submitted.forEach(s => s.details.forEach(d => { if (d.score === null || d.score === undefined) return; const q = qmap[d.qid]; const tag = (q && q.tag) || '未标注'; const t = tagAgg[tag] = tagAgg[tag] || { got: 0, full: 0 }; t.got += d.score; t.full += d.full; }));
    const byTag = Object.entries(tagAgg).map(([tag, t]) => ({ tag, questions: tagQ[tag] || 0, rate: t.full ? round1(t.got / t.full * 100) : 0 })).sort((a, b) => a.rate - b.rate);
    const classAgg = {};
    gradedOnly.forEach(s => { const u = byId(DB.users, s.studentId); const cn = (u && u.className) || '未分班'; (classAgg[cn] = classAgg[cn] || []).push(s.score); });
    const byClass = Object.entries(classAgg).map(([className, arr]) => ({ className, count: arr.length, avg: round1(arr.reduce((a, b) => a + b, 0) / arr.length), max: Math.max(...arr), passRate: Math.round(arr.filter(x => pct(x) >= 60).length / arr.length * 1000) / 10 }));
    return ok(res, {
      exam: { ...ex, status: examStatus(ex) }, paperTotal: totalScore,
      joined: DB.sheets.filter(s => s.examId === ex.id).length, submitted: submitted.length,
      pendingSheets: submitted.length - gradedOnly.length,
      avg: scores.length ? round1(scores.reduce((a, b) => a + b, 0) / scores.length) : 0,
      max: scores.length ? Math.max(...scores) : 0, min: scores.length ? Math.min(...scores) : 0,
      passRate: scores.length ? Math.round(gradedOnly.filter(s => pct(s.score) >= 60).length / scores.length * 1000) / 10 : 0,
      dist, perQuestion, wrongTop, rows, byTag, byClass
    });
  }
  const monMatch = /^\/api\/exams\/(.+)\/monitor$/.exec(p);
  if (monMatch && method === 'GET') {
    if (!teacher()) return;
    const ex = byId(DB.exams, monMatch[1]);
    if (!ex || ex.createdBy !== me.id) return fail(res, 404, '考试不存在');
    const paper = byId(DB.papers, ex.paperId);
    const totalQ = paper ? paper.items.length : 0;
    const sheets = DB.sheets.filter(s => s.examId === ex.id);
    const isAns = v => !(v === undefined || v === null || v === '' || (Array.isArray(v) && (!v.length || v.every(x => String(x).trim() === ''))));
    const entered = sheets.map(s => {
      const u = byId(DB.users, s.studentId);
      return { student: u ? u.name : '?', username: u ? u.username : '', className: u ? u.className : '', status: s.status, answered: Object.values(s.answers || {}).filter(isAns).length, totalQ, switchCount: s.switchCount, startAt: s.startAt, submitAt: s.submitAt, score: s.status === 'submitted' ? s.score : null, pending: s.pending || 0 };
    }).sort((a, b) => (a.status === b.status ? 0 : a.status === 'answering' ? -1 : 1));
    const enteredIds = new Set(sheets.map(s => s.studentId));
    const notEntered = DB.users.filter(u => u.role === 'student' && u.status !== 'pending' && !enteredIds.has(u.id)).map(u => ({ student: u.name, username: u.username, className: u.className }));
    return ok(res, { exam: { ...ex, status: examStatus(ex) }, totalQ, entered, notEntered, submitted: sheets.filter(s => s.status === 'submitted').length, answering: sheets.filter(s => s.status === 'answering').length });
  }
  const exportMatch = /^\/api\/exams\/(.+)\/export$/.exec(p);
  if (exportMatch && method === 'GET') {
    if (!teacher()) return;
    const ex = byId(DB.exams, exportMatch[1]);
    if (!ex || ex.createdBy !== me.id) return fail(res, 404, '考试不存在');
    const submitted = DB.sheets.filter(s => s.examId === ex.id && s.status === 'submitted').sort((a, b) => b.score - a.score);
    const lines = ['学生,账号,班级,得分,批改状态,交卷时间,切屏次数,切屏提醒'];
    submitted.forEach((s, i) => {
      const u = byId(DB.users, s.studentId) || {};
      lines.push([u.name || '', u.username || '', u.className || '', s.score, (s.pending || 0) > 0 ? '待批改（暂定分）' : '已完成', s.submitAt ? s.submitAt.replace('T', ' ').slice(0, 19) : '', s.switchCount, s.switchCount > 3 ? '超过3次' : ''].join(','));
    });
    res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="scores.csv"' });
    return res.end('\ufeff' + lines.join('\r\n'));
  }

  /* ----- 学生考试 ----- */
  const startMatch = /^\/api\/exams\/(.+)\/start$/.exec(p);
  if (startMatch && method === 'POST') {
    if (!student()) return;
    const ex = byId(DB.exams, startMatch[1]);
    if (!ex) return fail(res, 404, '考试不存在');
    if (ex.stoppedAt) return fail(res, 400, '考试已被教师停止');
    const st = examStatus(ex);
    if (st === '未开始') return fail(res, 400, '考试尚未开始');
    if (st === '已结束') return fail(res, 400, '考试已结束');
    let sheet = DB.sheets.find(s => s.examId === ex.id && s.studentId === me.id);
    if (sheet && sheet.status === 'answering' && sheetExpired(ex, sheet)) await finalizeSheet(sheet, 'timeout');
    if (sheet && sheet.status === 'submitted') return fail(res, 400, '答卷已提交，请到成绩页查看');
    if (!sheet) {
      sheet = { id: 'sh' + (++DB.seq.sheet), examId: ex.id, studentId: me.id, startAt: nowISO(), submitAt: null, answers: {}, marked: [], switchCount: 0, status: 'answering', score: 0, details: [] };
      DB.sheets.push(sheet); saveDB();
    }
    if (sheetExpired(ex, sheet)) {
      await finalizeSheet(sheet, 'timeout');
      return fail(res, 400, '答题时间已结束，答卷已自动提交');
    }
    scheduleSheetExpiry(ex, sheet);
    const paper = byId(DB.papers, ex.paperId);
    const qmap = Object.fromEntries(DB.questions.map(q => [q.id, q]));
    const questions = paper.items.map(it => {
      const q = qmap[it.qid];
      return { id: q.id, type: q.type, stem: q.stem, options: q.options || [], score: it.score, blanks: q.type === 'fill' ? q.answer.length : 0, language: q.type === 'code' ? q.language : undefined, template: q.type === 'code' ? (q.template || '') : undefined, caseCount: q.type === 'code' ? (q.cases || []).length : undefined };
    });
    const deadline = Math.min(Date.parse(sheet.startAt) + ex.durationMin * 60000, Date.parse(ex.endTime));
    return ok(res, { sheetId: sheet.id, exam: { id: ex.id, name: ex.name, durationMin: ex.durationMin, switchLimit: ex.switchLimit || 0, note: ex.note }, paperName: paper.name, total: paper.total, deadline, serverNow: Date.now(), questions, answers: sheet.answers, marked: sheet.marked, switchCount: sheet.switchCount });
  }
  const sheetStatusMatch = /^\/api\/sheets\/(.+)\/status$/.exec(p);
  if (sheetStatusMatch && method === 'GET') {
    if (!student()) return;
    const sheet = byId(DB.sheets, sheetStatusMatch[1]);
    if (!sheet || sheet.studentId !== me.id) return fail(res, 404, '答卷不存在');
    const ex = byId(DB.exams, sheet.examId);
    if (sheet.status === 'answering' && ex) {
      if (ex.stoppedAt) await finalizeSheet(sheet, 'stopped', ex.stoppedAt);
      else if (sheetExpired(ex, sheet)) await finalizeSheet(sheet, 'timeout');
    }
    return ok(res, { status: sheet.status, stopping: !!(ex && ex.stoppedAt), submitReason: sheet.submitReason || '', score: sheet.status === 'submitted' ? sheet.score : null, pending: sheet.pending || 0, showAnswer: !!(ex && ex.showAnswer), sheetId: sheet.id });
  }
  const progMatch = /^\/api\/sheets\/(.+)\/progress$/.exec(p);
  if (progMatch && method === 'POST') {
    if (!student()) return;
    const sheet = byId(DB.sheets, progMatch[1]);
    if (!sheet || sheet.studentId !== me.id) return fail(res, 404, '答卷不存在');
    if (sheet.status === 'submitted') return fail(res, 400, '已交卷');
    const examForProgress = byId(DB.exams, sheet.examId);
    if (sheetSubmissions.has(sheet.id)) {
      await finalizeSheet(sheet, sheet.submitReason || 'timeout');
      return ok(res, { saved: false, forceSubmitted: true, reason: sheet.submitReason, score: sheet.score, pending: sheet.pending || 0, showAnswer: !!(examForProgress && examForProgress.showAnswer) });
    }
    if (examForProgress && (examForProgress.stoppedAt || sheetExpired(examForProgress, sheet))) {
      const reason = examForProgress.stoppedAt ? 'stopped' : 'timeout';
      await finalizeSheet(sheet, reason, examForProgress.stoppedAt || nowISO());
      return ok(res, { saved: false, forceSubmitted: true, reason, score: sheet.score, pending: sheet.pending || 0, showAnswer: !!examForProgress.showAnswer });
    }
    if (body.answers && typeof body.answers === 'object') sheet.answers = body.answers;
    if (Array.isArray(body.marked)) sheet.marked = body.marked;
    if (typeof body.switchCount === 'number') sheet.switchCount = body.switchCount;
    const exForLimit = byId(DB.exams, sheet.examId);
    if (exForLimit && (exForLimit.switchLimit || 0) > 0 && sheet.switchCount > exForLimit.switchLimit) {
      await finalizeSheet(sheet, 'switch');
      return ok(res, { saved: true, forceSubmitted: true, score: sheet.score, pending: sheet.pending || 0, showAnswer: exForLimit.showAnswer });
    }
    saveDB();
    return ok(res, { saved: true });
  }
  const runMatch = /^\/api\/sheets\/(.+)\/run$/.exec(p);
  if (runMatch && method === 'POST') {
    if (!student()) return;
    const sheet = byId(DB.sheets, runMatch[1]);
    if (!sheet || sheet.studentId !== me.id) return fail(res, 404, '答卷不存在');
    if (sheet.status === 'submitted') return fail(res, 400, '已交卷，不能再运行');
    const ex = byId(DB.exams, sheet.examId);
    if (ex && (ex.stoppedAt || sheetExpired(ex, sheet))) {
      if (sheet.status === 'answering') await finalizeSheet(sheet, ex.stoppedAt ? 'stopped' : 'timeout', ex.stoppedAt || nowISO());
      return fail(res, 400, ex.stoppedAt ? '考试已停止' : '答题时间已结束，答卷已自动提交');
    }
    const paper = ex ? byId(DB.papers, ex.paperId) : null;
    if (!paper || !paper.items.some(it => it.qid === body.qid)) return fail(res, 400, '题目不在本场考试中');
    const q = byId(DB.questions, body.qid);
    if (!q || q.type !== 'code') return fail(res, 400, '只有编程题可以运行测试');
    const judge = await judgeCode(q, body.code);
    if (ex && (ex.stoppedAt || sheetExpired(ex, sheet))) {
      if (sheet.status === 'answering') await finalizeSheet(sheet, ex.stoppedAt ? 'stopped' : 'timeout', ex.stoppedAt || nowISO());
      return fail(res, 400, ex.stoppedAt ? '考试已停止' : '答题时间已结束，答卷已自动提交');
    }
    return ok(res, { judge: judgeForStudent(judge, false) });
  }
  const submitMatch = /^\/api\/sheets\/(.+)\/submit$/.exec(p);
  if (submitMatch && method === 'POST') {
    if (!student()) return;
    const sheet = byId(DB.sheets, submitMatch[1]);
    if (!sheet || sheet.studentId !== me.id) return fail(res, 404, '答卷不存在');
    const ex = byId(DB.exams, sheet.examId);
    if (sheet.status !== 'submitted' && !sheetSubmissions.has(sheet.id)) {
      if (ex && (ex.stoppedAt || sheetExpired(ex, sheet))) {
        await finalizeSheet(sheet, ex.stoppedAt ? 'stopped' : 'timeout', ex.stoppedAt || nowISO());
      } else {
        if (body.answers && typeof body.answers === 'object') sheet.answers = body.answers;
        if (typeof body.switchCount === 'number') sheet.switchCount = body.switchCount;
        const reason = ['manual', 'timeout', 'switch'].includes(body.reason) ? body.reason : 'manual';
        await finalizeSheet(sheet, reason);
      }
    } else await finalizeSheet(sheet, sheet.submitReason || 'manual', sheet.submitAt || nowISO());
    const graded = DB.sheets.filter(s => s.examId === sheet.examId && s.status === 'submitted' && (s.pending || 0) === 0);
    const rank = (sheet.pending || 0) === 0 ? 1 + graded.filter(s => s.score > sheet.score).length : null;
    return ok(res, { score: sheet.score, pending: sheet.pending || 0, rank, total: graded.length, showAnswer: ex ? ex.showAnswer : false, sheetId: sheet.id });
  }

  /* ----- 教师重置学生答卷（补考） ----- */
  const resetSheetMatch = /^\/api\/sheets\/(.+)\/reset$/.exec(p);
  if (resetSheetMatch && method === 'POST') {
    if (!teacher()) return;
    const sheet = byId(DB.sheets, resetSheetMatch[1]);
    if (!sheet) return fail(res, 404, '答卷不存在');
    const ex = byId(DB.exams, sheet.examId);
    if (!ex || ex.createdBy !== me.id) return fail(res, 403, '只能重置自己考试的答卷');
    const stu = byId(DB.users, sheet.studentId);
    DB.sheets = DB.sheets.filter(s => s.id !== sheet.id); saveDB();
    return ok(res, { reset: stu ? stu.username : sheet.studentId });
  }

  /* ----- 教师批改主观题 ----- */
  const gradeMatch = /^\/api\/sheets\/(.+)\/grade$/.exec(p);
  if (gradeMatch && method === 'POST') {
    if (!teacher()) return;
    const sheet = byId(DB.sheets, gradeMatch[1]);
    if (!sheet) return fail(res, 404, '答卷不存在');
    const ex = byId(DB.exams, sheet.examId);
    if (!ex || ex.createdBy !== me.id) return fail(res, 403, '只能批改自己考试的答卷');
    if (sheet.status !== 'submitted') return fail(res, 400, '答卷尚未提交，不能批改');
    for (const g of body.grades || []) {
      const d = sheet.details.find(x => x.qid === g.qid);
      const q = byId(DB.questions, g.qid);
      if (!d || !q || q.type !== 'essay') return fail(res, 400, '存在不可批改的题目');
      const sc = Number(g.score);
      if (isNaN(sc) || sc < 0 || sc > d.full) return fail(res, 400, `得分须在 0~${d.full} 之间`);
      d.score = round1(sc); d.correct = d.score === d.full; d.comment = String(g.comment || '');
    }
    sheet.score = round1(sheet.details.reduce((s, d) => s + (d.score || 0), 0));
    sheet.pending = sheet.details.filter(d => d.score === null || d.score === undefined).length;
    saveDB();
    return ok(res, { sheetId: sheet.id, score: sheet.score, pending: sheet.pending });
  }

  /* ----- 自主练习（学生，不计入正式成绩） ----- */
  if (p === '/api/practice/options' && method === 'GET') {
    if (!student()) return;
    const activeQids = activeExamQids();
    const pool = DB.questions.filter(q => q.type !== 'essay' && !activeQids.has(q.id));
    return ok(res, { tags: [...new Set(pool.map(q => q.tag || '未标注'))], types: [...new Set(pool.map(q => q.type))], total: pool.length });
  }
  if (p === '/api/practice/start' && method === 'POST') {
    if (!student()) return;
    const activeQids = activeExamQids();
    let pool = DB.questions.filter(q => q.type !== 'essay' && !activeQids.has(q.id));
    if (body.type) pool = pool.filter(q => q.type === body.type);
    if (body.tag) pool = pool.filter(q => (q.tag || '未标注') === body.tag);
    if (!pool.length) return fail(res, 400, '该范围下暂无可练习的题目');
    pool = [...pool].sort(() => Math.random() - 0.5);
    const n = Math.max(1, Math.min(20, Number(body.count) || 10));
    const questions = pool.slice(0, n).map(q => ({ id: q.id, type: q.type, stem: q.stem, options: q.options || [], score: q.score, blanks: q.type === 'fill' ? q.answer.length : 0, language: q.type === 'code' ? q.language : undefined, template: q.type === 'code' ? (q.template || '') : undefined, caseCount: q.type === 'code' ? (q.cases || []).length : undefined, tag: q.tag || '' }));
    return ok(res, { sessionId: newPracticeSession(me.id, questions.map(q => q.id)), questions });
  }
  if (p === '/api/practice/run' && method === 'POST') {
    if (!student()) return;
    const session = practiceSessionFor(me.id, body.sessionId);
    const qid = String(body.qid || '');
    if (!session || !session.qids.has(qid)) return fail(res, 400, '练习会话无效或题目不属于本组练习');
    if (activeExamQids().has(qid)) return fail(res, 400, '考试进行期间不能运行该题的练习判题');
    const q = byId(DB.questions, qid);
    if (!q || q.type !== 'code') return fail(res, 400, '只有编程题可以运行测试');
    const judge = await judgeCode(q, body.code);
    return ok(res, { judge: judgeForStudent(judge, false) });
  }
  if (p === '/api/practice/submit' && method === 'POST') {
    if (!student()) return;
    const session = practiceSessionFor(me.id, body.sessionId);
    if (!session) return fail(res, 400, '练习会话无效或已过期，请重新开始练习');
    const items = Array.isArray(body.items) ? body.items.slice(0, 20) : [];
    if (!items.length) return fail(res, 400, '没有可提交的练习题');
    const results = [];
    let got = 0, total = 0;
    const activeQids = activeExamQids();
    const seen = new Set();
    for (const it of items) {
      const qid = String((it && it.qid) || '');
      if (!session.qids.has(qid) || activeQids.has(qid) || seen.has(qid)) return fail(res, 400, '提交中包含无效、重复或考试中的题目');
      seen.add(qid);
      const q = byId(DB.questions, qid);
      if (!q || q.type === 'essay') return fail(res, 400, '提交中包含无效题目');
      const g = await gradeOneAsync(q, q.score, it.answer);
      got += g.score; total += q.score;
      results.push({ qid: q.id, score: g.score, full: q.score, correct: g.correct, answer: q.answer, analysis: q.analysis, judge: g.judge || undefined });
    }
    if (!results.length) return fail(res, 400, '没有可提交的练习题');
    if ([...seen].some(qid => activeExamQids().has(qid))) return fail(res, 400, '练习题已进入进行中的考试，无法返回答案');
    return ok(res, { results, gotScore: round1(got), totalScore: total });
  }

  /* ----- 成绩与回顾 ----- */
  if (p === '/api/my/scores' && method === 'GET') {
    if (!student()) return;
    const list = DB.sheets.filter(s => s.studentId === me.id && s.status === 'submitted').map(s => {
      const ex = byId(DB.exams, s.examId);
      const paper = ex ? byId(DB.papers, ex.paperId) : null;
      const graded = DB.sheets.filter(x => x.examId === s.examId && x.status === 'submitted' && (x.pending || 0) === 0);
      return { sheetId: s.id, examId: s.examId, examName: ex ? ex.name : '', score: s.score, pending: s.pending || 0, total: paper ? paper.total : 0, submitAt: s.submitAt, rank: (s.pending || 0) === 0 ? 1 + graded.filter(x => x.score > s.score).length : null, rankTotal: graded.length, switchCount: s.switchCount };
    }).sort((a, b) => Date.parse(b.submitAt) - Date.parse(a.submitAt));
    return ok(res, list);
  }
  /* ----- 错题本（学生） ----- */
  if (p === '/api/my/wrongbook' && method === 'GET') {
    if (!student()) return;
    const dismissed = new Set(me.wrongDismissed || []);
    const activeQids = activeExamQids();
    const qmap = Object.fromEntries(DB.questions.map(q => [q.id, q]));
    const items = [];
    DB.sheets.filter(s => s.studentId === me.id && s.status === 'submitted').forEach(s => {
      const ex = byId(DB.exams, s.examId);
      if (!ex || !ex.showAnswer) return; // 未开启答案展示的考试不进错题本，避免绕过教师设置
      s.details.forEach(d => {
        if (d.score === null || d.score === undefined || d.score >= d.full) return;
        const key = s.id + ':' + d.qid;
        if (dismissed.has(key)) return;
        const q = qmap[d.qid];
        if (!q || activeQids.has(q.id)) return;
        items.push({ key, sheetId: s.id, examName: ex.name, submitAt: s.submitAt, qid: d.qid, type: q.type, stem: q.stem, options: q.options || [], myAnswer: d.answer, myScore: d.score, full: d.full, answer: q.answer, analysis: q.analysis, comment: d.comment || '', judge: d.judge || null, language: q.type === 'code' ? q.language : undefined, template: q.type === 'code' ? (q.template || '') : undefined, caseCount: q.type === 'code' ? (q.cases || []).length : undefined });
      });
    });
    return ok(res, items);
  }
  if (p === '/api/my/wrongbook/practice' && method === 'POST') {
    if (!student()) return;
    const key = String(body.key || '');
    const qid = String(body.qid || '');
    const activeQids = activeExamQids();
    const dismissed = new Set(me.wrongDismissed || []);
    let detail = null;
    if (key && !dismissed.has(key) && !activeQids.has(qid)) {
      for (const sheet of DB.sheets) {
        if (sheet.studentId !== me.id || sheet.status !== 'submitted') continue;
        const ex = byId(DB.exams, sheet.examId);
        if (!ex || !ex.showAnswer) continue;
        const match = (sheet.details || []).find(d => `${sheet.id}:${d.qid}` === key && d.qid === qid && d.score !== null && d.score !== undefined && d.score < d.full);
        if (match) { detail = match; break; }
      }
    }
    if (!detail) return fail(res, 403, '该题不属于当前错题本或考试期间不可重练');
    const q = byId(DB.questions, qid);
    if (!q) return fail(res, 404, '题目不存在');
    if (q.type === 'essay') return fail(res, 400, '简答题请对照参考答案自查');
    const g = await gradeOneAsync(q, detail.full, body.answer);
    if (activeExamQids().has(qid)) return fail(res, 400, '该题已进入进行中的考试，无法返回答案');
    return ok(res, { correct: g.correct, score: g.score, answer: q.answer, analysis: q.analysis, judge: g.judge || undefined });
  }
  const wbDismiss = /^\/api\/my\/wrongbook\/(.+)\/dismiss$/.exec(p);
  if (wbDismiss && method === 'POST') {
    if (!student()) return;
    const key = decodeURIComponent(wbDismiss[1]);
    me.wrongDismissed = me.wrongDismissed || [];
    if (!me.wrongDismissed.includes(key)) me.wrongDismissed.push(key);
    saveDB();
    return ok(res, { dismissed: key });
  }
  const reviewMatch = /^\/api\/sheets\/(.+)\/review$/.exec(p);
  if (reviewMatch && method === 'GET') {
    const sheet = byId(DB.sheets, reviewMatch[1]);
    if (!sheet) return fail(res, 404, '答卷不存在');
    const ex = byId(DB.exams, sheet.examId);
    const isOwner = me.role === 'student' && sheet.studentId === me.id;
    const isTeacher = me.role === 'teacher' && ex && ex.createdBy === me.id;
    if (!isOwner && !isTeacher) return fail(res, 403, '无权查看该答卷');
    if (sheet.status !== 'submitted') return fail(res, 400, '尚未交卷');
    const showAnswer = isTeacher || (ex && ex.showAnswer);
    const qmap = Object.fromEntries(DB.questions.map(q => [q.id, q]));
    const items = sheet.details.map(d => {
      const q = qmap[d.qid] || {};
      return { qid: d.qid, type: q.type, stem: q.stem, options: q.options || [], myAnswer: d.answer, score: d.score, full: d.full, correct: d.correct, comment: d.comment || '', pending: d.score === null || d.score === undefined, answer: showAnswer ? q.answer : undefined, analysis: showAnswer ? q.analysis : undefined, judge: judgeForStudent(d.judge || null, !!showAnswer), language: q.type === 'code' ? q.language : undefined, caseCount: q.type === 'code' ? (q.cases || []).length : undefined };
    });
    const stu = byId(DB.users, sheet.studentId);
    return ok(res, { examName: ex ? ex.name : '', student: stu ? stu.name : '', score: sheet.score, switchCount: sheet.switchCount, submitAt: sheet.submitAt, showAnswer: !!showAnswer, items });
  }

  /* ----- AI 接口（管理员配置，教师/学生使用） ----- */
  if (p === '/api/ai/status' && method === 'GET') {
    const cfg = aiCfg();
    return ok(res, { enabled: cfg.enabled && !!cfg.baseUrl && !!cfg.model, model: cfg.enabled ? cfg.model : '' });
  }
  if (p === '/api/admin/ai-settings' && method === 'GET') {
    if (!admin()) return;
    const cfg = aiCfg();
    return ok(res, { enabled: cfg.enabled, baseUrl: cfg.baseUrl, model: cfg.model, apiKeySet: !!cfg.apiKey, apiKeyMasked: cfg.apiKey ? cfg.apiKey.slice(0, 3) + '****' + cfg.apiKey.slice(-2) : '' });
  }
  if (p === '/api/admin/ai-settings' && method === 'PUT') {
    if (!admin()) return;
    const cur = aiCfg();
    const next = { enabled: !!body.enabled, baseUrl: String(body.baseUrl || '').trim().replace(/\/+$/, ''), model: String(body.model || '').trim(), apiKey: cur.apiKey };
    if (body.apiKey !== undefined && String(body.apiKey) !== '' && !String(body.apiKey).includes('****')) next.apiKey = String(body.apiKey).trim();
    DB.settings = DB.settings || {}; DB.settings.ai = next; saveDB();
    return ok(res, { enabled: next.enabled, baseUrl: next.baseUrl, model: next.model, apiKeySet: !!next.apiKey });
  }
  if (p === '/api/admin/ai-test' && method === 'POST') {
    if (!admin()) return;
    try { const reply = await callAI([{ role: 'user', content: '请只回复两个字：可用' }]); return ok(res, { reply: reply.slice(0, 100) }); }
    catch (e) { return fail(res, 400, e.message); }
  }
  if (p === '/api/ai/grade-suggest' && method === 'POST') {
    if (!teacher()) return;
    const sheet = byId(DB.sheets, body.sheetId);
    if (!sheet) return fail(res, 404, '答卷不存在');
    const ex = byId(DB.exams, sheet.examId);
    if (!ex || ex.createdBy !== me.id) return fail(res, 403, '只能批改自己考试的答卷');
    const d = sheet.details.find(x => x.qid === body.qid);
    const q = byId(DB.questions, body.qid);
    if (!d || !q || q.type !== 'essay') return fail(res, 400, '只能对简答题使用 AI 辅助批改');
    try {
      const r = await callAIJson([
        { role: 'system', content: '你是一位严谨的阅卷教师。只输出 JSON，不要输出任何其他文字。' },
        { role: 'user', content: `请按评分要点为下面的学生答案打分。\n题目：${q.stem}\n参考答案：${q.answer}\n评分要点：${q.analysis || '（未提供，按与参考答案的契合度评分）'}\n满分：${d.full} 分\n学生答案：${String(d.answer || '（未作答）')}\n输出 JSON：{"score": 数字得分（0 到满分之间，可带一位小数）, "comment": "给学生的一句评语（中文，不超过 60 字）"}` }
      ]);
      let sc = Number(r.score);
      if (isNaN(sc)) return fail(res, 502, 'AI 返回的分数无法解析，请重试');
      sc = Math.max(0, Math.min(d.full, round1(sc)));
      return ok(res, { score: sc, comment: String(r.comment || '').slice(0, 200), model: aiCfg().model });
    } catch (e) { return fail(res, 400, e.message); }
  }
  if (p === '/api/ai/generate' && method === 'POST') {
    if (!teacher()) return;
    const type = ['single', 'multi', 'judge', 'fill', 'essay'].includes(body.type) ? body.type : 'single';
    const topic = String(body.topic || '').trim();
    if (!topic) return fail(res, 400, '请填写出题主题或知识点');
    const diff = ['易', '中', '难'].includes(body.difficulty) ? body.difficulty : '中';
    const fmt = {
      single: '{"type":"single","stem":"题干","options":[{"k":"A","t":"选项"},{"k":"B","t":"选项"},{"k":"C","t":"选项"},{"k":"D","t":"选项"}],"answer":"A","analysis":"解析","score":5}',
      multi: '{"type":"multi","stem":"题干","options":[{"k":"A","t":"选项"},{"k":"B","t":"选项"},{"k":"C","t":"选项"},{"k":"D","t":"选项"}],"answer":["A","B"],"analysis":"解析","score":6}',
      judge: '{"type":"judge","stem":"陈述句题干","options":[],"answer":"true","analysis":"解析","score":5}',
      fill: '{"type":"fill","stem":"含 ____ 的题干","options":[],"answer":["空1的标准答案"],"analysis":"解析","score":4}',
      essay: '{"type":"essay","stem":"简答题题干","options":[],"answer":"参考答案全文","analysis":"评分要点","score":10}'
    }[type];
    try {
      const r = await callAIJson([
        { role: 'system', content: '你是 Linux 运维课程的命题教师。只输出 JSON，不要输出任何其他文字。题目要准确、无歧义，答案必须正确。' },
        { role: 'user', content: `围绕主题「${topic}」出 1 道难度为「${diff}」的题，JSON 格式如下：${fmt}` }
      ]);
      const draft = { type, stem: String(r.stem || ''), options: Array.isArray(r.options) ? r.options : [], answer: r.answer, analysis: String(r.analysis || ''), score: Number(r.score) || 5, difficulty: diff, tag: topic.slice(0, 20), subject: 'Linux基础' };
      const chk = normQuestion(draft, me.id);
      if (chk.error) return fail(res, 502, 'AI 生成的题目不完整（' + chk.error + '），请重试');
      return ok(res, chk.q);
    } catch (e) { return fail(res, 400, e.message); }
  }
  if (p === '/api/ai/explain' && method === 'POST') {
    const sheet = byId(DB.sheets, body.sheetId);
    if (!sheet) return fail(res, 404, '答卷不存在');
    const ex = byId(DB.exams, sheet.examId);
    const isOwner = me.role === 'student' && sheet.studentId === me.id;
    const isTeacher = me.role === 'teacher' && ex && ex.createdBy === me.id;
    if (!isOwner && !isTeacher) return fail(res, 403, '无权使用');
    if (isOwner && !(ex && ex.showAnswer)) return fail(res, 403, '本场考试未开启答案展示');
    const d = sheet.details.find(x => x.qid === body.qid);
    const q = byId(DB.questions, body.qid);
    if (!d || !q) return fail(res, 404, '题目不存在');
    try {
      const text = await callAI([
        { role: 'system', content: '你是耐心的 Linux 运维课程助教，用通俗中文讲解，200 字以内，说明为什么正确答案对、学生错在哪里。' },
        { role: 'user', content: `题目：${q.stem}\n正确答案/参考答案：${typeof q.answer === 'object' ? JSON.stringify(q.answer) : q.answer}\n已有解析：${q.analysis || '无'}\n学生答案：${typeof d.answer === 'object' ? JSON.stringify(d.answer) : (d.answer === null || d.answer === undefined ? '（未作答）' : d.answer)}\n这名学生本题得 ${d.score === null ? '待批改' : d.score} 分（满分 ${d.full} 分）。请讲解这道题。` }
      ]);
      return ok(res, { text, model: aiCfg().model });
    } catch (e) { return fail(res, 400, e.message); }
  }

  /* ----- 管理员 ----- */
  if (p === '/api/admin/overview' && method === 'GET') {
    if (!admin()) return;
    return ok(res, { users: DB.users.length, students: DB.users.filter(u => u.role === 'student').length, teachers: DB.users.filter(u => u.role === 'teacher').length, questions: DB.questions.length, papers: DB.papers.length, exams: DB.exams.length, sheets: DB.sheets.filter(s => s.status === 'submitted').length, classes: DB.classes });
  }
  if (p === '/api/admin/users' && method === 'GET') {
    if (!admin()) return;
    return ok(res, DB.users.map(publicUser));
  }
  const resetMatch = /^\/api\/admin\/users\/(.+)\/reset$/.exec(p);
  if (resetMatch && method === 'POST') {
    if (!admin()) return;
    const u = byId(DB.users, resetMatch[1]);
    if (!u) return fail(res, 404, '用户不存在');
    u.password = hashPw('123456'); saveDB();
    return ok(res, { reset: u.username });
  }
  const approveMatch = /^\/api\/admin\/users\/(.+)\/approve$/.exec(p);
  if (approveMatch && method === 'POST') {
    if (!admin()) return;
    const u = byId(DB.users, approveMatch[1]);
    if (!u) return fail(res, 404, '用户不存在');
    u.status = 'active'; saveDB();
    return ok(res, { approved: u.username });
  }
  const uEditMatch = /^\/api\/admin\/users\/(.+)$/.exec(p);
  if (uEditMatch && method === 'PUT') {
    if (!admin()) return;
    const u = byId(DB.users, uEditMatch[1]);
    if (!u) return fail(res, 404, '用户不存在');
    if (body.name !== undefined) { const n = String(body.name).trim(); if (n) u.name = n; }
    if (body.className !== undefined) u.className = String(body.className).trim();
    saveDB();
    return ok(res, publicUser(u));
  }
  if (p === '/api/admin/users' && method === 'POST') {
    if (!admin()) return;
    const username = String(body.username || '').trim();
    if (!username) return fail(res, 400, '账号不能为空');
    if (DB.users.some(u => u.username === username)) return fail(res, 400, '账号已存在');
    if (!['teacher', 'student', 'admin'].includes(body.role)) return fail(res, 400, '角色不正确');
    const u = { id: 'u' + (++DB.seq.user), username, password: hashPw(String(body.password || '123456')), name: String(body.name || username), role: body.role, className: String(body.className || ''), status: 'active', wrongDismissed: [] };
    DB.users.push(u); saveDB();
    return ok(res, publicUser(u));
  }
  if (p === '/api/admin/users/import' && method === 'POST') {
    if (!admin()) return;
    const items = Array.isArray(body.items) ? body.items : [];
    let created = 0, skipped = 0;
    for (const it of items) {
      const username = String((it || {}).username || '').trim();
      if (!username || DB.users.some(u => u.username === username)) { skipped++; continue; }
      DB.users.push({ id: 'u' + (++DB.seq.user), username, password: hashPw('123456'), name: String(it.name || username), role: 'student', className: String(it.className || ''), status: 'active', wrongDismissed: [] });
      created++;
    }
    saveDB();
    return ok(res, { created, skipped });
  }
  const uDelMatch = /^\/api\/admin\/users\/(.+)$/.exec(p);
  if (uDelMatch && method === 'DELETE') {
    if (!admin()) return;
    const u = byId(DB.users, uDelMatch[1]);
    if (!u) return fail(res, 404, '用户不存在');
    if (u.id === me.id) return fail(res, 400, '不能删除自己');
    if (DB.sheets.some(s => s.studentId === u.id)) return fail(res, 400, '该用户已有答卷记录，不能删除');
    DB.users = DB.users.filter(x => x.id !== u.id); saveDB();
    return ok(res, { deleted: u.username });
  }
  if (p === '/api/admin/backup' && method === 'GET') {
    if (!admin()) return;
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': 'attachment; filename="exam-backup.json"' });
    return res.end(JSON.stringify(DB, null, 1));
  }
  if (p === '/api/admin/restore' && method === 'POST') {
    if (!admin()) return;
    const d = body.data;
    if (!d || !Array.isArray(d.users) || !Array.isArray(d.questions) || !Array.isArray(d.papers) || !Array.isArray(d.exams) || !Array.isArray(d.sheets) || !d.seq) return fail(res, 400, '备份文件格式不正确');
    DB = d;
    if (!Array.isArray(DB.classes)) DB.classes = [];
    saveDB(); tokens.clear(); resetSheetExpiryTimers();
    return ok(res, { restored: true });
  }
  if (p === '/api/admin/classes' && method === 'GET') { if (!admin()) return; return ok(res, DB.classes); }
  if (p === '/api/admin/classes' && method === 'POST') {
    if (!admin()) return;
    const name = String(body.name || '').trim();
    if (!name) return fail(res, 400, '班级名不能为空');
    if (DB.classes.includes(name)) return fail(res, 400, '班级已存在');
    DB.classes.push(name); saveDB();
    return ok(res, DB.classes);
  }
  const classMatch = /^\/api\/admin\/classes\/(.+)$/.exec(p);
  if (classMatch && method === 'DELETE') {
    if (!admin()) return;
    const name = decodeURIComponent(classMatch[1]);
    DB.classes = DB.classes.filter(c => c !== name); saveDB();
    return ok(res, DB.classes);
  }

  return fail(res, 404, '接口不存在');
}

/* ---------------- 静态文件 ---------------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.png': 'image/png', '.ico': 'image/x-icon' };
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    let file = url.pathname === '/' ? '/index.html' : url.pathname;
    const fp = path.join(PUBLIC, path.normalize(file).replace(/^(\.\.[/\\])+/, ''));
    if (!fp.startsWith(PUBLIC) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.writeHead(404); return res.end('Not Found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(fp).pipe(res);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) fail(res, 500, '服务器内部错误');
  }
});
server.listen(PORT, () => console.log(`考试系统 v1.0 已启动 → http://localhost:${PORT} （教师 teacher / 学生 student / 管理员 admin，密码均为 123456）`));
