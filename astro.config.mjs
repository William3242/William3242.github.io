// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';

// site 是站点完整地址，用于 RSS、sitemap 和 canonical 链接。
// 部署到阿里云时由 CI 通过 SITE_URL 环境变量传入（见 .github/workflows/deploy-aliyun.yml）。
export default defineConfig({
  site: process.env.SITE_URL ?? 'https://william3242.github.io',
  base: '/',
  integrations: [mdx(), sitemap()],
  markdown: {
    shikiConfig: {
      themes: { light: 'github-light', dark: 'github-dark' },
    },
  },
});
