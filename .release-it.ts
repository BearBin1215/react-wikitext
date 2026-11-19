import type { Config } from "release-it";

export default {
  git: {
    commitMessage: "chore: release v${version}",
    tagName: "v${version}",
    tagAnnotation: "chore: release v${version}",
  },
  github: {
    release: true,
    releaseName: "v${version}",
    tokenRef: "GH_TOKEN",
  },
  npm: false,
  plugins: {
    "@release-it/conventional-changelog": {
      preset: {
        name: "conventionalcommits",
        types: [
          { type: "feat", section: "🚀 新特性" },
          { type: "fix", section: "🐛 问题修复" },
          { type: "perf", section: "⚡ 性能优化" },
          { type: "refactor", section: "♻️ 重构", effect: "changelog" },
          { type: "docs", section: "📚 文档", effect: "changelog" },
          { type: "build", section: "🛠️ 构建", effect: "changelog" },
          { type: "ci", section: "🤖 CI", effect: "changelog" },
          { type: "test", section: "🧪 测试", effect: "changelog" },
          { type: "chore", section: "🧹 杂项", effect: "changelog" },
          { type: "revert", section: "↩️ 回滚", effect: "changelog" },
          { type: "style", effect: "hidden" },
        ],
      },
    },
  },
} satisfies Config;
