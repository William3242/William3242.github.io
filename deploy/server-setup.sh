#!/usr/bin/env bash
# 阿里云 ECS（Alibaba Cloud Linux 3）一次性初始化脚本，以 root 运行：
#   sudo bash server-setup.sh "ssh-ed25519 AAAA... github-actions-deploy"
# 参数 $1：GitHub Actions 使用的部署公钥。
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "请以 root 运行" >&2; exit 1
fi
PUBKEY="${1:-}"
if [[ -z "$PUBKEY" ]]; then
  echo "用法: $0 '<部署公钥>'" >&2; exit 1
fi

dnf install -y nginx rsync

# 部署用户
id deploy &>/dev/null || useradd -m -s /bin/bash deploy
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
echo "$PUBKEY" > /home/deploy/.ssh/authorized_keys
chown deploy:deploy /home/deploy/.ssh/authorized_keys
chmod 600 /home/deploy/.ssh/authorized_keys

# 站点目录
install -d -m 755 -o deploy -g deploy /var/www/blog

# 去掉默认站点的 default_server，避免与博客冲突
sed -i 's/ default_server//g' /etc/nginx/nginx.conf

cat > /etc/nginx/conf.d/blog.conf <<'NGINX'
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name wlhuang32.me www.wlhuang32.me _;

    root /var/www/blog;
    index index.html;

    gzip on;
    gzip_types text/plain text/css application/javascript application/json application/xml image/svg+xml;
    gzip_min_length 1024;

    location / {
        try_files $uri $uri/ $uri.html =404;
    }

    location /_astro/ {
        expires 1y;
        add_header Cache-Control "public, max-age=31536000, immutable";
        try_files $uri =404;
    }

    error_page 404 /404.html;
}
NGINX

# 防火墙（若启用）
if systemctl is-active --quiet firewalld; then
  firewall-cmd --permanent --add-service=http
  firewall-cmd --reload
fi

# SELinux（若启用）允许 nginx 读取站点目录
if command -v getenforce &>/dev/null && [[ "$(getenforce)" == "Enforcing" ]]; then
  chcon -R -t httpd_sys_content_t /var/www/blog || true
fi

nginx -t
systemctl enable --now nginx
systemctl reload nginx

echo "完成。请确认阿里云安全组已放行 80 端口。"
