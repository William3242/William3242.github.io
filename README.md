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
   - （可选）Variable `SITE_URL`：站点完整地址；未设置时使用 `http://<DEPLOY_HOST>`

   ```bash
   gh secret set DEPLOY_HOST -b <服务器IP> -R William3242/William3242.github.io
   gh secret set DEPLOY_SSH_KEY -R William3242/William3242.github.io < ~/.ssh/blog_deploy
   ```

8. 手动运行一次部署，覆盖宝塔生成的默认 `index.html`（也可以在 Actions 页面点 Run workflow，或直接推送到 `main`）：

   ```bash
   gh workflow run "Deploy to Aliyun ECS" -R William3242/William3242.github.io
   ```

**ICP 备案完成后启用域名和 HTTPS**

服务器在中国内地，未备案的域名会被阿里云拦截（返回 `403 Non-compliance ICP Filing`），备案前只能用 IP 访问。

1. 云解析 DNS 中把域名 A 记录指向服务器 IP。
2. 宝塔站点 → 设置 → 域名管理，添加域名。
3. 宝塔站点 → 设置 → SSL，申请 Let's Encrypt 证书（或部署阿里云免费证书），开启「强制 HTTPS」。宝塔会自动续期。
4. 安全组放行 TCP 443。
5. 把仓库 Variable `SITE_URL` 设为 `https://你的域名`，重新运行部署，让 RSS、sitemap 和 canonical 链接使用新域名。

**不使用宝塔时**

`deploy/server-setup.sh` 可以在一台干净的 Alibaba Cloud Linux 3 上用系统 nginx 完成同样的配置（配置见 `deploy/nginx-blog.conf`）：`bash server-setup.sh '<公钥内容>'`。它会占用 80 端口，不要和宝塔的 nginx 同时使用。
