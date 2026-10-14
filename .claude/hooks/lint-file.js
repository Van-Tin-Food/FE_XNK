// PostToolUse hook (chạy nền): eslint file TS/JS Claude vừa sửa.
// Có lỗi lint -> exit 2 để Claude nhận lỗi và sửa. File khác hoặc lint sạch -> exit 0.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const projectDir = path.resolve(__dirname, '..', '..');
const eslintBin = path.join(projectDir, 'node_modules', 'eslint', 'bin', 'eslint.js');

let input = '';
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  let filePath = '';
  try {
    const payload = JSON.parse(input || '{}');
    filePath = payload.tool_input?.file_path || payload.tool_response?.filePath || '';
  } catch {
    process.exit(0);
  }
  const absolute = path.resolve(projectDir, filePath);
  const relative = path.relative(projectDir, absolute);
  const inProject = relative && !relative.startsWith('..') && !path.isAbsolute(relative);
  if (!inProject || !/\.(tsx?|jsx?|mjs)$/i.test(absolute) || !/^(src|tests)[\\/]/.test(relative)) process.exit(0);
  if (!fs.existsSync(eslintBin)) process.exit(0);

  const result = spawnSync(process.execPath, [eslintBin, relative], { cwd: projectDir, encoding: 'utf8' });
  if (result.status === 0) process.exit(0);
  process.stderr.write(`eslint ${relative}:\n${result.stdout || result.stderr}`);
  process.exit(2);
});
