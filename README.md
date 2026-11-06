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

### 阿里云 ECS

`.github/workflows/deploy-aliyun.yml` 在推送到 `main` 时构建站点，并用 rsync 上传到服务器的 `/var/www/blog/`，由 nginx 提供静态服务。

**首次配置**

1. 本地生成一对部署专用密钥（不设密码）：

   ```bash
   ssh-keygen -t ed25519 -f ~/.ssh/blog_deploy -N "" -C github-actions-deploy
   ```

2. 把 `deploy/server-setup.sh` 传到服务器，以 root 运行，参数为公钥内容：

   ```bash
   scp deploy/server-setup.sh root@<服务器IP>:/root/
   ssh root@<服务器IP> "bash /root/server-setup.sh '$(cat ~/.ssh/blog_deploy.pub)'"
   ```

   脚本会安装 nginx 和 rsync、创建 `deploy` 用户、写入 `/etc/nginx/conf.d/blog.conf`（内容同 `deploy/nginx-blog.conf`）并启动 nginx。

3. 在阿里云控制台的安全组中放行 TCP 80（之后 HTTPS 还需 443）。

4. 在 GitHub 仓库 Settings → Secrets and variables → Actions 中添加：
   - Secret `DEPLOY_HOST`：服务器公网 IP
   - Secret `DEPLOY_SSH_KEY`：`~/.ssh/blog_deploy` 私钥的完整内容
   - （可选）Variable `SITE_URL`：站点完整地址；未设置时使用 `http://<DEPLOY_HOST>`

5. 在 Actions 页面手动运行 **Deploy to Aliyun ECS**，或推送到 `main`。

**ICP 备案完成后启用域名和 HTTPS**

1. 把域名 A 记录解析到服务器 IP。
2. 把 `/etc/nginx/conf.d/blog.conf` 中的 `server_name _;` 改成你的域名，`nginx -t && systemctl reload nginx`。
3. 申请证书（以 certbot 为例）：

   ```bash
   dnf install -y certbot python3-certbot-nginx
   certbot --nginx -d example.com -d www.example.com
   ```

   也可以使用阿里云免费 SSL 证书，下载 nginx 格式后在 `blog.conf` 中添加 `listen 443 ssl` 及 `ssl_certificate` / `ssl_certificate_key`。
4. 安全组放行 443。
5. 把仓库 Variable `SITE_URL` 设为 `https://你的域名`，重新运行部署，让 RSS、sitemap 和 canonical 链接使用新域名。
