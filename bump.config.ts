import { defineConfig } from "bumpp";

export default defineConfig({
  // {tag} 即 v<version>，与 publish.yml 的 tag 触发器一致
  commit: "chore: release {tag}",
  // 预发布标识；bumpp 默认使用 beta
  preid: "alpha",
});
