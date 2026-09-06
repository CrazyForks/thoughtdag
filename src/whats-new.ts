// What a release changed, in the user's words. Two readers: the dialog that
// opens once after an update, and the release history behind the ⋯ menu.
// Every release gets an entry here, so the history is complete; `announce`
// decides only whether the entry also pops up on the first launch after the
// update. Most releases pass silently: the dialog is for the few where a
// person opening the app should learn that a new door exists. Content lives
// here, not in a network call: the app is local-first and this must work
// offline. Links open in the system browser through the shell's window-open
// handler. Newest first.

import type { Lang } from './i18n';

export interface WhatsNewItem {
  title: Record<Lang, string>;
  body: Record<Lang, string>;
  /** where to read more, if anywhere */
  link?: { label: Record<Lang, string>; href: string };
}

export interface WhatsNewEntry {
  version: string;
  /** release day, YYYY-MM-DD */
  date: string;
  /** pop up on the first launch after updating to this version */
  announce: boolean;
  /** one line under the version: what this release is about */
  lead: Record<Lang, string>;
  items: WhatsNewItem[];
}

const DOCS = 'https://chenxiachan.github.io/thoughtdag/docs';

export const WHATS_NEW: WhatsNewEntry[] = [
  {
    version: '0.4.6',
    date: '2026-09-06',
    announce: true,
    lead: {
      zh: '🎉 Pi 的会话进了对话地图，「⋯」菜单里多了更新历史，随时能回看每一版改了什么。',
      en: '🎉 Pi sessions join the Session Atlas, and the ⋯ menu gains a release history, so what every version changed is one click away.',
    },
    items: [
      {
        title: { zh: 'Pi 的会话也在地图上了', en: 'Pi sessions are on the map' },
        body: {
          zh: '本地 Pi 会话按项目聚在一起，打开就是一张图。Pi 里的每次分叉在图上就是一条支线，不再压成一条直线。命令行 why 和 MCP 也同步认识 Pi 留下的文件足迹。',
          en: 'Local Pi sessions group by project and open as a graph. Every fork you made in Pi shows up as a branch instead of being flattened into one line. The why command and MCP index Pi\'s file footprints too.',
        },
        link: { label: { zh: '怎么用', en: 'How it works' }, href: `${DOCS}/zh/guides/session-atlas` },
      },
      {
        title: { zh: '更新历史，随时补看', en: 'Release history, whenever you like' },
        body: {
          zh: '右上「⋯」菜单，「如何使用」下面。每个版本改了什么都在这里，从新到旧，当前版本有标记。',
          en: 'In the ⋯ menu, under How it works: what each release changed, newest first, with the version you are running marked.',
        },
      },
    ],
  },
  {
    version: '0.4.5',
    date: '2026-09-06',
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
  {
    version: '0.4.4',
    date: '2026-09-04',
    announce: false,
    lead: {
      zh: 'DeepSeek Harness 成为对话地图的内置来源：它的 zstd 日志由桌面壳逐帧解码，每条消息一个节点，工具调用与结果配对成附件。',
      en: 'DeepSeek Harness becomes a built-in Atlas source: the shell decodes its zstd logs frame by frame, one node per message, tool calls paired with their results as attachments.',
    },
    items: [],
  },
  {
    version: '0.4.3',
    date: '2026-09-03',
    announce: false,
    lead: {
      zh: '深链接可以直达某一轮，画布可以按稳定 id 打开；子 Agent 的会话文件不再打扰实时监听。',
      en: 'A deep link can land on a turn and a canvas opens by its stable id; subagent session files no longer disturb the live watcher.',
    },
    items: [],
  },
  {
    version: '0.4.2',
    date: '2026-09-02',
    announce: false,
    lead: {
      zh: '镜像节点列出那一轮碰过的文件（✏️ 改过、📖 读过），预览用结论而不是开头；子 Agent 的会话作为子线程识别，报告折回发起它的那一轮。',
      en: 'A mirrored node lists the files its turn touched (✏️ edited, 📖 read) and previews the conclusion rather than the opening line; subagent files are recognized as sub-threads and their reports fold into the launching turn.',
    },
    items: [],
  },
  {
    version: '0.4.1',
    date: '2026-09-01',
    announce: false,
    lead: {
      zh: 'Agent 对话地图首发：本地 Claude Code 与 Codex 的会话按项目文件夹聚成一张图，一键接入，随对话实时生长。',
      en: 'Session Atlas debuts: local Claude Code and Codex sessions group by project folder into one map, connect in one click, and grow with the conversation.',
    },
    items: [],
  },
];

/** Numeric compare of dotted versions: negative when a < b. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((x) => parseInt(x, 10) || 0);
  const pb = b.split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * What to show a person who last saw `after` (null: never saw any notes) and
 * now runs `upTo`: every announced entry in between, newest first. Skipped
 * releases are included, so an update that arrives two versions late still
 * tells the whole story.
 */
export function announcedSince(after: string | null, upTo: string): WhatsNewEntry[] {
  return WHATS_NEW.filter((e) => e.announce
    && compareVersions(e.version, upTo) <= 0
    && (after === null || compareVersions(e.version, after) > 0));
}
