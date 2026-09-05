// What a release changed, in the user's words — shown once, in the app, after
// an update, and only for releases that ask for it. Most releases don't:
// the dialog is for the few where a person opening the app should learn
// that a new door exists. Content lives here, not in a network call: the
// app is local-first and this must work offline.
//
// `announce: false` (or an absent entry) means the update passes silently.
// Links open in the system browser through the shell's window-open handler.

import type { Lang } from './i18n';

export interface WhatsNewItem {
  title: Record<Lang, string>;
  body: Record<Lang, string>;
  /** where to read more, if anywhere */
  link?: { label: Record<Lang, string>; href: string };
}

export interface WhatsNewEntry {
  version: string;
  announce: boolean;
  /** one line under the version: what this release is about */
  lead: Record<Lang, string>;
  items: WhatsNewItem[];
}

const DOCS = 'https://chenxiachan.github.io/thoughtdag/docs';

export const WHATS_NEW: WhatsNewEntry[] = [
  {
    version: '0.4.5',
    announce: true,
    lead: {
      zh: '🎉 这是 ThoughtDAG 到目前为止最大的一次升级：散在各个 Agent 里的对话接成了一张地图，能从画布里查，还能直接在 DeepSeek Harness 里用。四件新东西，都值得试一试。',
      en: '🎉 The biggest ThoughtDAG release so far: the conversations scattered across your agents become one map, you can query them, and it all runs inside DeepSeek Harness. Four new things, each worth a try.',
    },
    items: [
      {
        title: { zh: '跨 Agent 的对话地图，终于连成一张', en: 'Session Atlas: all your agents, one map' },
        body: {
          zh: 'Claude Code、Codex 和 DeepSeek Harness 的本地会话按项目文件夹聚在一起，点开就是一张图，随对话实时生长。',
          en: 'Local Claude Code, Codex and DeepSeek Harness sessions, grouped by project; open one as a graph and it follows the conversation live.',
        },
        link: { label: { zh: '怎么用', en: 'How it works' }, href: `${DOCS}/zh/guides/session-atlas` },
      },
      {
        title: { zh: '命令行 why：一条命令找回塑造文件的那些对话', en: 'thoughtdag why: one command finds the conversations that shaped a file' },
        body: {
          zh: 'npx thoughtdag why <文件> 列出哪些轮次读过、改过它，当时问了什么、改了什么；find 按原话搜，MCP 让 Agent 自己来查。',
          en: 'npx thoughtdag why <file> lists the turns that read or changed it, what was asked and what changed; find searches verbatim; MCP lets your agent ask.',
        },
        link: { label: { zh: '命令与 MCP', en: 'CLI and MCP' }, href: `${DOCS}/zh/guides/why-layer` },
      },
      {
        title: { zh: 'DeepSeek Harness 插件上线', en: 'DeepSeek Harness plugin is live' },
        body: {
          zh: 'dsh plugin --profile web add dsh-thoughtdag，Harness 的网页里多一个"思维图"视图：在画布上提问、让 Harness 的 Agent 带工具作答，why 也成了它的原生工具。',
          en: 'dsh plugin --profile web add dsh-thoughtdag adds a canvas view to the Harness web UI: ask from the canvas, let its agent answer with tools, and why becomes a native tool there.',
        },
        link: { label: { zh: '插件说明', en: 'Plugin README' }, href: 'https://github.com/chenxiachan/thoughtdag/tree/main/dsh#readme' },
      },
      {
        title: { zh: '文档站上线', en: 'The docs site is live' },
        body: {
          zh: '概念、任务指南、命令字典和隐私说明各有一页，中英文对照。感谢一路同行，欢迎来 Discussions 说说你怎么用它。',
          en: 'Concepts, task guides, the command dictionary and the privacy notes, each on its own page, in both languages. Thank you for coming this far with us; tell us how you use it in Discussions.',
        },
        link: { label: { zh: '打开文档', en: 'Open the docs' }, href: `${DOCS}/zh/` },
      },
    ],
  },
];

/** The entry for a version, or null when that version has nothing to announce. */
export function whatsNewFor(version: string | null | undefined): WhatsNewEntry | null {
  if (!version) return null;
  const e = WHATS_NEW.find((x) => x.version === version);
  return e && e.announce ? e : null;
}
