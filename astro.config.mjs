// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';

// 部署到 username.github.io 时 site 填完整域名，base 保持 '/'。
// 部署到项目仓库（username.github.io/repo）时把 base 改成 '/repo'。
export default defineConfig({
  site: 'https://william3242.github.io',
  base: '/',
  integrations: [mdx(), sitemap()],
  markdown: {
    shikiConfig: {
      themes: { light: 'github-light', dark: 'github-dark' },
    },
  },
});
