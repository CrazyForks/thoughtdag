import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse, parseFragment, serialize } from 'parse5';

// Existing data-zh attributes are the translation source. Emit real Chinese HTML.
const out = resolve('dist/pages');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync('website', out, { recursive: true, filter: (p) => !p.endsWith('.mjs') });
cpSync('docs/.vitepress/dist', `${out}/docs`, { recursive: true });
const doc = parse(readFileSync('website/index.html', 'utf8'));
const attr = (node, name) => node.attrs?.find((a) => a.name === name)?.value;
const setAttr = (node, name, value) => {
  const existing = node.attrs.find((a) => a.name === name);
  if (existing) existing.value = value;
  else node.attrs.push({ name, value });
};
const setText = (node, value) => {
  node.childNodes = [{ nodeName: '#text', value, parentNode: node }];
};
const title = 'ThoughtDAG — 开源 AI 对话画布与上下文编辑工具';
const description = 'ThoughtDAG 是开源 AI 对话画布。编辑大模型上下文，展开对话分支，把选中的历史讨论接到新问题上。附三个场景教程与交互示意动画。';
function localize(node) {
  if (node.attrs) {
    if (attr(node, 'data-zh') !== undefined) setText(node, attr(node, 'data-zh'));
    if (attr(node, 'data-zh-html') !== undefined) {
      node.childNodes = parseFragment(node, attr(node, 'data-zh-html')).childNodes;
      node.childNodes.forEach((child) => { child.parentNode = node; });
    }
    if (attr(node, 'data-zh-href')) setAttr(node, 'href', attr(node, 'data-zh-href'));
    if (node.tagName === 'html') setAttr(node, 'lang', 'zh-CN');
    if (node.tagName === 'title') setText(node, title);
    if (node.tagName === 'link' && attr(node, 'rel') === 'canonical') setAttr(node, 'href', 'https://chenxiachan.github.io/thoughtdag/zh.html');
    if (node.tagName === 'meta') {
      const key = attr(node, 'name') || attr(node, 'property');
      if (key === 'description' || key === 'og:description') setAttr(node, 'content', description);
      if (key === 'og:title') setAttr(node, 'content', title);
      if (key === 'og:url') setAttr(node, 'content', 'https://chenxiachan.github.io/thoughtdag/zh.html');
      if (key === 'og:image' || key === 'twitter:image') setAttr(node, 'content', attr(node, 'content').replace('-en-', '-zh-'));
    }
    if (attr(node, 'id') === 'language-toggle') {
      setText(node, 'EN');
      setAttr(node, 'href', './');
      setAttr(node, 'hreflang', 'en');
      setAttr(node, 'aria-label', 'Switch to English');
    }
    if (node.tagName === 'script' && attr(node, 'type') === 'application/ld+json') {
      const data = JSON.parse(node.childNodes[0].value);
      data.description = description;
      data.url = 'https://chenxiachan.github.io/thoughtdag/zh.html';
      data.inLanguage = 'zh-CN';
      setText(node, JSON.stringify(data));
    }
  }
  node.childNodes?.forEach(localize);
}
localize(doc);
writeFileSync(`${out}/zh.html`, serialize(doc));
writeFileSync(`${out}/.nojekyll`, '');
console.log(`Built English and static Chinese landing pages with docs: ${out}`);
