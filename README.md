# William 的技术笔记

基于 [Astro](https://astro.build) 的极简技术博客，部署在 GitHub Pages 和阿里云 ECS。

## 本地开发

```bash
npm install
npm run dev      # http://localhost:4321
npm run build    # 输出到 dist/
```

## 写文章

在 `src/content/posts/` 新建 `.md` 或 `.mdx` 文件：

```yaml
---
title: 文章标题
description: 一句话摘要
pubDate: 2026-10-21
tags: [Agent, RAG]
draft: false
---
```

## 部署

### GitHub Pages

推送到 `main` 分支后，GitHub Actions 会自动构建并发布。首次使用需在仓库 Settings → Pages 中把 Source 设为 **GitHub Actions**。

### 阿里云 ECS（宝塔面板）

服务器上用[宝塔面板](https://www.bt.cn)的 nginx 提供静态服务。`.github/workflows/deploy-aliyun.yml` 在推送到 `main` 时构建站点，以 `deploy` 用户通过 SSH 把 `dist/` rsync 到服务器的 `/var/www/blog/`。站点文件实际存放在宝塔站点根目录 `/www/wwwroot/blog`，`/var/www/blog` 是指向它的软链接：

```
GitHub Actions ──rsync──▶ /var/www/blog ──软链接──▶ /www/wwwroot/blog ◀── 宝塔 nginx ◀── 浏览器
```

宝塔不允许把站点根目录设在 `/var` 下，所以文件放在宝塔目录里，再用软链接保留 workflow 使用的部署路径，workflow 无需修改。

**首次配置**

1. 本地生成一对部署专用密钥（不设密码）：

   ```bash
   ssh-keygen -t ed25519 -f ~/.ssh/blog_deploy -N "" -C github-actions-deploy
   ```

2. 在服务器上（root）安装 rsync、创建 `deploy` 用户，把上一步的公钥（`~/.ssh/blog_deploy.pub` 的内容）写进去：

   ```bash
   dnf install -y rsync
   useradd -m -s /bin/bash deploy
   install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
   echo '<公钥内容>' > /home/deploy/.ssh/authorized_keys
   chown deploy:deploy /home/deploy/.ssh/authorized_keys && chmod 600 /home/deploy/.ssh/authorized_keys
   ```

3. 宝塔面板 → 网站 → 添加站点：
   - 域名：服务器 IP（备案后再加域名）
   - 根目录：`/www/wwwroot/blog`
   - PHP 版本：纯静态；不创建 FTP 和数据库

4. 宝塔站点 → 设置：
   - 网站目录：取消勾选「防跨站攻击（open_basedir）」，否则会生成锁定的 `.user.ini`，导致 rsync `--delete` 失败
   - 伪静态：填入 `location / { try_files $uri $uri/ $uri.html =404; }`

5. 在服务器上（root）把站点目录交给 `deploy` 用户，并让 `/var/www/blog` 成为指向它的软链接（宝塔给 `.user.ini` 加了不可修改属性，要先解锁删除）：

   ```bash
   chattr -i /www/wwwroot/blog/.user.ini 2>/dev/null; rm -f /www/wwwroot/blog/.user.ini
   chown -R deploy:deploy /www/wwwroot/blog
   mkdir -p /var/www
   rm -rf /var/www/blog && ln -s /www/wwwroot/blog /var/www/blog
   ```

   如果 `/var/www/blog` 已经是一个装有文件的真实目录，先执行 `cp -a /var/www/blog/. /www/wwwroot/blog/` 再删除。

6. 阿里云控制台 → ECS 实例 → 安全组 → 入方向放行 TCP 80（以及 SSH 22，授权对象 `0.0.0.0/0`，因为 GitHub Actions 的出口 IP 不固定）。

7. 在 GitHub 仓库 Settings → Secrets and variables → Actions 中添加：
   - Secret `DEPLOY_HOST`：服务器公网 IP
   - Secret `DEPLOY_SSH_KEY`：`~/.ssh/blog_deploy` 私钥的完整内容
   - （可选）Variable `SITE_URL`：站点完整地址；未设置时使用 `https://www.wlhuang32.me`

   ```bash
   gh secret set DEPLOY_HOST -b <服务器IP> -R William3242/William3242.github.io
   gh secret set DEPLOY_SSH_KEY -R William3242/William3242.github.io < ~/.ssh/blog_deploy
   ```

8. 手动运行一次部署，覆盖宝塔生成的默认 `index.html`（也可以在 Actions 页面点 Run workflow，或直接推送到 `main`）：

   ```bash
   gh workflow run "Deploy to Aliyun ECS" -R William3242/William3242.github.io
   ```

**域名和 HTTPS（wlhuang32.me）**

ICP 备案号 `湘ICP备2026054092号-1`，备案域名 `wlhuang32.me`，首页 `https://www.wlhuang32.me`。页脚的备案号写在 `src/consts.ts` 的 `ICP_BEIAN`，链接到 https://beian.miit.gov.cn/ 。

1. 阿里云「云解析 DNS」→ `wlhuang32.me` → 添加记录：

   | 记录类型 | 主机记录 | 记录值 |
   | --- | --- | --- |
   | A | `@` | 服务器公网 IP |
   | A | `www` | 服务器公网 IP |

   本地用 `dig +short wlhuang32.me www.wlhuang32.me` 确认两条都返回服务器 IP。

2. 宝塔站点 → 设置 → 域名管理，添加 `wlhuang32.me` 和 `www.wlhuang32.me`（IP 那一行可以保留）。
3. 安全组入方向放行 TCP 443。
4. 宝塔站点 → 设置 → SSL → Let's Encrypt，勾选上面两个域名、文件验证，申请；成功后打开「强制 HTTPS」。宝塔会自动续期。
5. （可选）宝塔站点 → 设置 → 重定向：把 `wlhuang32.me` 301 到 `https://www.wlhuang32.me`，让站点只有一个主地址。
6. 部署 workflow 默认用 `https://www.wlhuang32.me` 作为站点地址（RSS、sitemap、canonical），无需另外设置。

服务器在中国内地，未备案的域名会被阿里云拦截（返回 `403 Non-compliance ICP Filing`）。网站开通后 30 日内还需在 https://beian.mps.gov.cn/ 办理公安联网备案，拿到「X公网安备 xxxx 号」后也加到页脚。

**不使用宝塔时**

`deploy/server-setup.sh` 可以在一台干净的 Alibaba Cloud Linux 3 上用系统 nginx 完成同样的配置（配置见 `deploy/nginx-blog.conf`）：`bash server-setup.sh '<公钥内容>'`。它会占用 80 端口，不要和宝塔的 nginx 同时使用。
