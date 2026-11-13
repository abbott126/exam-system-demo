#!/usr/bin/env node
'use strict';
/*
 * 从 data/db.json 导出题库：
 *   1) 判断题.md / 单选题.md / 简答题.md —— 与 scripts/import-questions.js 同格式，可原样回灌
 *   2) 全部题目.json —— 无损快照（含多选/填空/编程等 md 无法表达的题型），仅含题目、不含用户与密钥
 *
 * 用法：
 *   node scripts/export-questions.js                 # 输出到 <仓库根>/题库/
 *   node scripts/export-questions.js --out ~/Desktop # 输出到指定目录（可恢复桌面原位置）
 *   DATA_DIR=/path/to/data node scripts/export-questions.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');
const DB_PATH = path.join(DATA_DIR, 'db.json');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') out.out = argv[++i];
    else if (argv[i].startsWith('--out=')) out.out = argv[i].slice(6);
  }
  return out;
}

const OUT_DIR = path.resolve(parseArgs(process.argv.slice(2)).out || path.join(ROOT, '题库'));

/** 简答题题库里的题干前缀（导入脚本会自动补上，导出时需去掉以免出现两次） */
const ESSAY_PREFIX = '简答题：';

const FILES = {
  judge: '判断题.md',
  single: '单选题.md',
  essay: '简答题.md',
};

function loadDb() {
  if (!fs.existsSync(DB_PATH)) {
    throw new Error('未找到 ' + DB_PATH + '，请先启动一次服务生成数据：node server.js（随后可 Ctrl+C 停止）');
  }
  const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  if (!db || !Array.isArray(db.questions)) throw new Error('db.json 结构不正确');
  return db;
}

/** 单行化：md 解析器按行匹配题干/答案，含换行会被截断 */
function oneLine(s) {
  return String(s == null ? '' : s).replace(/\r/g, '').replace(/\n+/g, ' ').trim();
}

/** 按知识点标签分组，保持库内原有相对顺序 */
function groupByTag(list) {
  const groups = [];
  const index = new Map();
  for (const q of list) {
    const tag = (q.tag || '').trim() || '未分类';
    let group = index.get(tag);
    if (!group) {
      group = { tag, items: [] };
      index.set(tag, group);
      groups.push(group);
    }
    group.items.push(q);
  }
  return groups;
}

/** 判断题答案：true → √，false → × */
function judgeMark(answer) {
  return answer === 'true' || answer === '√' ? '√' : '×';
}

function buildJudgeMd(list) {
  const lines = [
    '# 判断题题库（由 exam-system-demo 导出）',
    '',
    '格式与 scripts/import-questions.js 一致：每个 `## 知识点` 分组下，`**序号. 题干**` 后跟 `【答案】√（解析）`。',
    '',
  ];
  let no = 0;
  for (const g of groupByTag(list)) {
    lines.push('## ' + g.tag, '');
    for (const q of g.items) {
      no++;
      lines.push('**' + no + '. ' + oneLine(q.stem) + '**');
      lines.push('【答案】' + judgeMark(q.answer));
      const analysis = oneLine(q.analysis);
      if (analysis) lines.push('【解析】' + analysis);
      lines.push('');
    }
  }
  return lines.join('\n');
}

function buildSingleMd(list) {
  const lines = [
    '# 单选题题库（由 exam-system-demo 导出）',
    '',
    '格式与 scripts/import-questions.js 一致：`**序号. 题干**` → `A. 选项` 逐行 → `【答案】B`。',
    '',
  ];
  let no = 0;
  for (const g of groupByTag(list)) {
    lines.push('## ' + g.tag, '');
    for (const q of g.items) {
      no++;
      lines.push('**' + no + '. ' + oneLine(q.stem) + '**');
      for (const o of q.options || []) {
        lines.push(o.k + '. ' + oneLine(o.t));
      }
      lines.push('【答案】' + q.answer);
      lines.push('');
    }
  }
  return lines.join('\n');
}

function buildEssayMd(list) {
  const lines = [
    '# 简答题题库（由 exam-system-demo 导出）',
    '',
    '格式与 scripts/import-questions.js 一致：`**序号. 题干**` → `答：参考答案`（续行不缩进）。',
    '',
  ];
  let no = 0;
  for (const g of groupByTag(list)) {
    lines.push('## ' + g.tag, '');
    for (const q of g.items) {
      no++;
      const stem = oneLine(q.stem).startsWith(ESSAY_PREFIX)
        ? oneLine(q.stem).slice(ESSAY_PREFIX.length).trim()
        : oneLine(q.stem);
      lines.push('**' + no + '. ' + stem + '**');
      const analysis = oneLine(q.analysis);
      if (analysis) lines.push('【评分要点】' + analysis);
      const answer = String(q.answer == null ? '' : q.answer).replace(/\r/g, '');
      const rows = answer.split('\n');
      rows.forEach((row, i) => {
        if (i === 0) lines.push('答：' + row);
        else if (row.trim()) lines.push(row);
      });
      if (!rows.length || !rows[0].trim()) lines.push('答：（无参考答案）');
      lines.push('');
    }
  }
  return lines.join('\n');
}

function exportQuestions(outDir, db) {
  const byType = t => db.questions.filter(q => q.type === t);
  const counts = {
    judge: byType('judge').length,
    single: byType('single').length,
    essay: byType('essay').length,
  };

  fs.mkdirSync(outDir, { recursive: true });

  const written = [];
  const write = (name, content) => {
    const p = path.join(outDir, name);
    fs.writeFileSync(p, content, 'utf8');
    written.push(name);
  };

  write(FILES.judge, buildJudgeMd(byType('judge')));
  write(FILES.single, buildSingleMd(byType('single')));
  write(FILES.essay, buildEssayMd(byType('essay')));

  // 无损快照：保留全部题型与原始字段，仅剔除用户/密钥等非题目数据
  const snapshot = {
    exportedAt: new Date().toISOString(),
    source: DB_PATH,
    counts: {
      total: db.questions.length,
      byType: db.questions.reduce((acc, q) => {
        acc[q.type] = (acc[q.type] || 0) + 1;
        return acc;
      }, {}),
    },
    questions: db.questions,
  };
  write('全部题目.json', JSON.stringify(snapshot, null, 2) + '\n');

  return { written, counts, total: db.questions.length };
}

function main() {
  const db = loadDb();
  const r = exportQuestions(OUT_DIR, db);
  console.log('题库已导出到：' + OUT_DIR);
  for (const name of r.written) console.log('  - ' + name);
  console.log('判断 %d、单选 %d、简答 %d（合计 %d 题，含全部题型 %d）',
    r.counts.judge, r.counts.single, r.counts.essay,
    r.counts.judge + r.counts.single + r.counts.essay, r.total);
  console.log('回灌方式：QUESTIONS_SRC_DIR="%s" node scripts/import-questions.js', OUT_DIR);
}

module.exports = { exportQuestions, loadDb, DB_PATH };

if (require.main === module) main();
