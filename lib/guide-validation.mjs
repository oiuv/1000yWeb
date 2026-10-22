import MarkdownIt from 'markdown-it';

// Structural checks only: reference numbers and game rules are not inferred here.
export function validateGuideMarkdown(markdown) {
  const issues = [];
  const add = (line, message) => issues.push({ line: line + 1, message });
  const lines = markdown.split('\n');
  const tokens = new MarkdownIt({ html: true }).parse(markdown, {});
  const codeLines = new Set();
  for (const token of tokens) {
    if (token.type === 'fence' || token.type === 'code_block') {
      for (let i = token.map[0]; i < token.map[1]; i++) codeLines.add(i);
    }
  }
  if (markdown.startsWith('\uFEFF')) add(0, '请使用无 BOM 的 UTF-8');
  if (markdown.includes('\r')) add(0, '请使用 LF 换行');
  if (markdown.includes('\uFFFD')) add(0, '存在 Unicode 替换字符，请核对源编码');
  let previous = 0, titles = 0;
  for (const token of tokens.filter(t => t.type === 'heading_open')) {
    const level = Number(token.tag.slice(1));
    if (level === 1) titles++;
    if (level > previous + 1) add(token.map[0], '标题层级不可跳级');
    previous = level;
  }
  if (titles !== 1 || tokens[0]?.type !== 'heading_open' || tokens[0]?.tag !== 'h1') {
    add(0, '文章应以唯一的一级标题开始');
  }
  for (let i = 0; i < lines.length; i++) {
    if (codeLines.has(i)) continue;
    if (/^- \d+(?:\\\.|[、。])/.test(lines[i])) add(i, '序号误嵌在无序列表中');
    if (/^-[^\s-]/.test(lines[i])) add(i, '列表符号后缺少空格');
    if (/^#{2,6} (?:◎|(?:身体|头|手|腿)(?:破坏|防御)\s*[:：(（])/.test(lines[i])) {
      add(i, '属性正文不应作为章节标题');
    }
  }
  // markdown-it silently fills or drops cells; reject mismatches before rendering.
  function cells(line) {
    let value = '', escaped = false;
    const result = [];
    for (const char of line.trim()) {
      if (char === '|' && !escaped) { result.push(value.trim()); value = ''; }
      else value += char;
      escaped = char === '\\' && !escaped;
    }
    result.push(value.trim());
    if (result[0] === '') result.shift();
    if (result.at(-1) === '') result.pop();
    return result;
  }
  for (const token of tokens.filter(t => t.type === 'table_open')) {
    const [start, end] = token.map;
    const width = cells(lines[start]).length;
    for (let i = start + 1; i < end; i++) {
      if (cells(lines[i]).length !== width) add(i, '表格列数与表头不一致');
    }
  }
  return issues;
}
