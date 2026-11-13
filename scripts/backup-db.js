#!/usr/bin/env node
'use strict';
/*
 * 考试系统数据备份（data/db.json 不在 git 里，删掉就没有了）
 * 做两件事：
 *   1) 全量快照 → backups/db-YYYYMMDD-HHMMSS.json（本机保存，含账号与 AI Key，不进 git）
 *   2) 题目快照 → 题库/（只含题目，无敏感信息，进 git，删库也能找回题）
 *
 * 用法：node scripts/backup-db.js
 * 恢复：停掉服务后 cp backups/db-YYYYMMDD-HHMMSS.json data/db.json
 */
const fs = require('fs');
const path = require('path');
const { exportQuestions, loadDb, DB_PATH } = require('./export-questions');

const ROOT = path.resolve(__dirname, '..');
const BACKUP_DIR = path.join(ROOT, 'backups');
const QUESTION_DIR = path.join(ROOT, '题库');
const KEEP = 20;

function timestamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}

function pruneOldBackups() {
  const files = fs.readdirSync(BACKUP_DIR)
    .filter(f => /^db-\d{8}-\d{6}\.json$/.test(f))
    .sort();
  const removed = files.slice(0, Math.max(0, files.length - KEEP));
  for (const f of removed) fs.unlinkSync(path.join(BACKUP_DIR, f));
  return removed.length;
}

function main() {
  if (!fs.existsSync(DB_PATH)) {
    throw new Error('未找到 ' + DB_PATH + '，请先启动一次服务生成数据：node server.js（随后可 Ctrl+C 停止）');
  }
  const db = loadDb();
  fs.mkdirSync(BACKUP_DIR, { recursive: true });

  const stamp = timestamp();
  const backupPath = path.join(BACKUP_DIR, 'db-' + stamp + '.json');
  fs.copyFileSync(DB_PATH, backupPath);
  JSON.parse(fs.readFileSync(backupPath, 'utf8'));

  const removed = pruneOldBackups();
  const r = exportQuestions(QUESTION_DIR, db);

  console.log('全量快照：' + path.relative(ROOT, backupPath) + '（含账号与 AI Key，仅本机保存，未纳入 git）');
  console.log('题目快照：' + path.relative(ROOT, QUESTION_DIR) + '/（' + r.written.join('、') + '，无敏感信息，已可提交 git）');
  console.log('题目总数：%d（单选 %d、判断 %d、简答 %d，其余题型仅存于 JSON 快照）',
    r.total, r.counts.single, r.counts.judge, r.counts.essay);
  if (removed) console.log('已清理 %d 个旧快照（保留最近 %d 个）', removed, KEEP);
  console.log('恢复全量数据：停掉服务后执行 cp %s data/db.json', path.relative(ROOT, backupPath));
}

main();
