#!/usr/bin/env node
'use strict';
/*
 * 将 Markdown 题库导入 data/db.json
 * 用法：node scripts/import-questions.js
 *       QUESTIONS_SRC_DIR=/path/to/题库 node scripts/import-questions.js
 * 分值：单选 1 分、判断 1 分、简答 5 分（判断题未指定分值，与单选同为客观题取 1 分）
 * 源文件默认取桌面，可用 QUESTIONS_SRC_DIR 指定其他目录（题库已移出桌面后必须指定）
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');
const DB_PATH = path.join(DATA_DIR, 'db.json');

const SRC_DIR = process.env.QUESTIONS_SRC_DIR
  ? path.resolve(process.env.QUESTIONS_SRC_DIR)
  : '/Users/abbott/Desktop';

/** 同一题型兼容两种命名：原始桌面文件（xxx100题.md）与导出脚本产出（xxx.md） */
const SRC_CANDIDATES = {
  judge: ['判断题100题.md', '判断题.md'],
  single: ['单选题100题.md', '单选题.md'],
  essay: ['简答题100题.md', '简答题.md'],
};

function resolveSrc(type) {
  for (const name of SRC_CANDIDATES[type]) {
    const p = path.join(SRC_DIR, name);
    if (fs.existsSync(p)) return p;
  }
  throw new Error('未找到' + type + '题源文件，已查找 ' + SRC_DIR + ' 下：' + SRC_CANDIDATES[type].join('、'));
}

const SCORE = { judge: 1, single: 1, essay: 5 };
const DIFFICULTY = '中';
const SUBJECT = 'Linux基础';
const CREATED_BY = 'u_teacher';

function readMd(file) {
  if (!fs.existsSync(file)) throw new Error('源文件不存在：' + file);
  return fs.readFileSync(file, 'utf8');
}

/** 从 ## 标题提取知识点标签，如「一、Linux 基础（1-15）」→「Linux 基础」 */
function tagFromHeader(line) {
  const m = /^##\s*(?:[一二三四五六七八九十]+、)?(.+?)(?:（[^）]*）)?\s*$/.exec(line.trim());
  if (!m) return '';
  return m[1].replace(/\s+/g, ' ').trim();
}

/** 解析选项块：支持同行全角空格分隔与多行两种写法 */
function parseOptions(block) {
  const text = String(block || '').replace(/\u3000/g, ' ').replace(/\r/g, '').trim();
  if (!text) return [];
  const parts = text.split(/(?:^|[\s])(([A-D])[.．])\s*/);
  const options = [];
  for (let i = 1; i < parts.length; i += 3) {
    const k = parts[i + 1];
    const t = (parts[i + 2] || '').trim();
    if (k && t) options.push({ k, t });
  }
  return options;
}

function parseJudge(md) {
  const items = [];
  let tag = '';
  const lines = md.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^##\s/.test(line)) { tag = tagFromHeader(line); i++; continue; }
    const qm = /^\*\*(\d+)\.\s*(.+?)\*\*\s*$/.exec(line.trim());
    if (!qm) { i++; continue; }
    const stem = qm[2].trim();
    i++;
    let answerLine = '';
    let analysisLine = '';
    while (i < lines.length && !/^\*\*\d+\./.test(lines[i].trim()) && !/^##\s/.test(lines[i])) {
      if (lines[i].includes('【答案】')) answerLine += (answerLine ? '\n' : '') + lines[i];
      else if (lines[i].includes('【解析】')) analysisLine += (analysisLine ? '\n' : '') + lines[i].replace(/【解析】/g, '').trim();
      i++;
    }
    const am = /【答案】\s*([√×xX])\s*(?:　|\s)*(?:（(.+?)）)?/.exec(answerLine);
    if (!am) throw new Error('判断题缺少答案：' + stem.slice(0, 40));
    const answer = am[1] === '√' ? 'true' : 'false';
    const analysis = analysisLine.trim() || (am[2] || '').trim();
    items.push({ stem, answer, analysis, tag, srcNo: Number(qm[1]) });
  }
  return items;
}

function parseSingle(md) {
  const items = [];
  let tag = '';
  const lines = md.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^##\s/.test(line)) { tag = tagFromHeader(line); i++; continue; }
    const qm = /^\*\*(\d+)\.\s*(.+?)\*\*\s*$/.exec(line.trim());
    if (!qm) { i++; continue; }
    const stem = qm[2].trim();
    i++;
    const body = [];
    let answerLine = '';
    while (i < lines.length && !/^\*\*\d+\./.test(lines[i].trim()) && !/^##\s/.test(lines[i])) {
      if (lines[i].includes('【答案】')) answerLine = lines[i];
      else if (answerLine === '') body.push(lines[i]);
      i++;
    }
    const am = /【答案】\s*([A-D])/.exec(answerLine);
    if (!am) throw new Error('单选题缺少答案：' + stem.slice(0, 40));
    const answer = am[1];
    const options = parseOptions(body.join('\n'));
    if (options.length < 2) throw new Error('单选题选项不足：' + stem.slice(0, 40));
    if (!options.some(o => o.k === answer)) throw new Error('单选答案不在选项中：' + stem.slice(0, 40));
    items.push({ stem, options, answer, analysis: '', tag, srcNo: Number(qm[1]) });
  }
  return items;
}

function parseEssay(md) {
  const items = [];
  let tag = '';
  const lines = md.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^##\s/.test(line)) { tag = tagFromHeader(line); i++; continue; }
    const qm = /^\*\*(\d+)\.\s*(.+?)\*\*\s*$/.exec(line.trim());
    if (!qm) { i++; continue; }
    const stem = qm[2].trim();
    i++;
    const answerParts = [];
    const analysisParts = [];
    while (i < lines.length && !/^\*\*\d+\./.test(lines[i].trim()) && !/^##\s/.test(lines[i])) {
      const t = lines[i].trim();
      if (t.startsWith('【评分要点】')) analysisParts.push(t.slice('【评分要点】'.length).trim());
      else if (t.startsWith('答：')) answerParts.push(t.replace(/^答：/, ''));
      else if (answerParts.length && t) answerParts.push(t);
      i++;
    }
    const answer = answerParts.join('\n').trim();
    if (!answer) throw new Error('简答题缺少参考答案：' + stem.slice(0, 40));
    items.push({ stem, answer, analysis: analysisParts.join('\n').trim(), tag, srcNo: Number(qm[1]) });
  }
  return items;
}

function loadDb() {
  if (!fs.existsSync(DB_PATH)) {
    throw new Error('未找到 ' + DB_PATH + '，请先启动一次服务生成演示数据：node server.js（随后可 Ctrl+C 停止）');
  }
  const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  if (!db || !Array.isArray(db.questions) || !db.seq) throw new Error('db.json 结构不正确');
  return db;
}

function saveDb(db) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const tmp = DB_PATH + '.tmp';
  const data = JSON.stringify(db, null, 1);
  const fd = fs.openSync(tmp, 'w');
  try { fs.writeFileSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  if (fs.existsSync(DB_PATH)) fs.copyFileSync(DB_PATH, DB_PATH + '.bak');
  fs.renameSync(tmp, DB_PATH);
}

function main() {
  const judges = parseJudge(readMd(resolveSrc('judge')));
  const singles = parseSingle(readMd(resolveSrc('single')));
  const essays = parseEssay(readMd(resolveSrc('essay')));
  console.log('解析结果：判断 %d、单选 %d、简答 %d', judges.length, singles.length, essays.length);

  const db = loadDb();
  const existing = new Set(db.questions.map(q => q.type + '\u0000' + q.stem));
  let created = 0;
  let skipped = 0;

  const push = (type, o) => {
    const stem = type === 'essay' ? '简答题：' + o.stem : o.stem;
    const key = type + '\u0000' + stem;
    if (existing.has(key)) { skipped++; return; }
    const q = {
      id: 'q' + (++db.seq.question),
      type,
      stem,
      options: o.options || [],
      answer: o.answer,
      analysis: o.analysis || '',
      score: SCORE[type],
      difficulty: DIFFICULTY,
      tag: o.tag || '',
      subject: SUBJECT,
      createdBy: CREATED_BY,
    };
    db.questions.push(q);
    existing.add(key);
    created++;
  };

  for (const j of judges) push('judge', j);
  for (const s of singles) push('single', s);
  for (const e of essays) push('essay', e);

  saveDb(db);
  const byType = t => db.questions.filter(q => q.type === t).length;
  console.log('导入完成：新增 %d、跳过已存在 %d', created, skipped);
  console.log('题库合计：%d（单选 %d、判断 %d、简答 %d、其他 %d）',
    db.questions.length, byType('single'), byType('judge'), byType('essay'),
    db.questions.length - byType('single') - byType('judge') - byType('essay'));
}

main();
