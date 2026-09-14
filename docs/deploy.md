# 部署到服务器

本地试用见 [README](../README.md#快速开始)。这份写的是：把它放到一台云服务器上，
用自己的域名、走 HTTPS，手机和电脑随时能打开。

> 这是单人自用的系统：一个口令、一份数据。不要把一个实例开给多位老师共用。

## 0. 准备

- 一台 Linux 服务器（2 核 4G 起步；首次构建镜像时内存吃紧的话，先加 2G swap）
- 已安装 Docker 与 Docker Compose 插件
- 一个域名，解析到服务器 IP。**中国大陆的服务器要先完成 ICP 备案**，否则 80/443 端口会被云厂商拦截
- 安全组 / 防火墙放行 80 和 443

下面以部署目录 `/opt/keticompass`、系统用户 `ubuntu` 为例。`deploy/cron/` 里的模板和备份脚本默认都是这个目录（名字取自项目最早的代号「课题罗盘」），照用可以少改几处。

## 1. 拿代码、写配置

```bash
sudo mkdir -p /opt/keticompass && sudo chown "$USER" /opt/keticompass
git clone https://github.com/Devilyuu/teacher-hub.git /opt/keticompass
cd /opt/keticompass
cp .env.example .env
chmod 600 .env
```

编辑 `.env`，**至少改下面这些**（其余保持默认即可）：

```ini
APP_DOMAIN="desk.example.com"                 # 你的域名
APP_PASSCODE="<你自己的登录口令>"
APP_SESSION_SECRET="<openssl rand -base64 48 生成>"
POSTGRES_PASSWORD="<openssl rand -hex 24 生成>"   # 别用 @ : / ? # 这些字符
MAINTENANCE_TOKEN="<openssl rand -base64 32 生成>" # 用会议录音转写时才需要
TZ="Asia/Shanghai"                            # 你所在的时区
```

**时区一定要设对。**「今天」「逾期」「倒计时」全按进程时区算，留成 UTC 的话，
东八区每天早上 8 点前的「今天」会被算成昨天，而且不会报任何错。

可选功能的配置项（全部留空也能正常使用，只是对应功能不可用）：

```ini
# 会议录音转写（腾讯云录音文件识别）。每次上传都要用户单独确认后才发送
TENCENT_ASR_APP_ID=""
TENCENT_SECRET_ID=""
TENCENT_SECRET_KEY=""
# 会议纪要草稿（任意 OpenAI 兼容接口）。留空时照常手工整理纪要
MINUTES_API_BASE_URL=""
MINUTES_API_KEY=""
MINUTES_MODEL=""
# 备课系统（另一套独立部署的系统，没有就留空）
TEACHING_APP_URL=""
TEACHING_IMPORT_TOKEN=""
```

## 2. 启动

附件目录的属主必须是 uid 1000（容器里以 `node` 用户运行），否则附件传不上、预览报 403：

```bash
mkdir -p data/uploads && sudo chown -R 1000:1000 data/uploads
```

### 方案 A：服务器上没有别的网站（推荐，最省事）

用内置的 Caddy 做反向代理，证书自动申请、自动续期：

```bash
docker compose --profile full up -d --build
```

首次构建要几分钟到十几分钟。完成后打开 `https://你的域名`，用 `APP_PASSCODE` 登录。

检查：

```bash
docker compose --profile full ps                 # 三个容器都应是 running / healthy
curl -fsS https://desk.example.com/api/health     # {"ok":true}
docker compose exec -T app date                   # 时间和时区对不对
```

### 方案 B：服务器上已经有 Nginx 在管 80/443

内置 Caddy 会和 Nginx 抢端口，所以只起数据库和应用，应用绑定到本机回环地址，再由 Nginx 转发。

在 `.env` 里再加两行：

```ini
APP_PORT="3100"
COMPOSE_FILE="docker-compose.yml:docker-compose.server.yml"
```

启动时**一定带上服务名 `app`**，不带的话 `--profile full` 会把 Caddy 也拉起来：

```bash
docker compose --profile full up -d --build app
```

Nginx 配置模板在 `deploy/nginx/`，把里面的 `desk.example.com` 换成你的域名：

- `desk-http.conf`：首次申请证书前用的 HTTP 配置
- `desk.conf`：拿到证书后的正式 HTTPS 配置（上传大小、安全响应头都已配好）

```bash
sudo install -m 644 deploy/nginx/desk-http.conf /etc/nginx/sites-available/desk
sudo ln -sfn /etc/nginx/sites-available/desk /etc/nginx/sites-enabled/desk
sudo mkdir -p /var/www/letsencrypt
sudo nginx -t && sudo systemctl reload nginx

sudo certbot certonly --webroot -w /var/www/letsencrypt -d desk.example.com

sudo install -m 644 deploy/nginx/desk.conf /etc/nginx/sites-available/desk
sudo nginx -t && sudo systemctl reload nginx
```

### 为什么不能直接用 http://IP:端口 访问

生产模式下登录 cookie 带 `Secure` 标志，浏览器在明文 HTTP 下会**静默丢弃**它——
表现是口令输对了也一直弹回登录页，不报任何错。所以应用端口刻意不对公网开放，
唯一入口是 HTTPS。

## 3. 每日备份

`scripts/backup.sh` 备份数据库、附件，用内置 Caddy 时还会备份证书。
`deploy/cron/keticompass-backup` 是每天 03:20 跑一次的 cron 模板，部署目录或用户名和上面不同时先改掉：

```bash
sudo install -d -o ubuntu -g ubuntu -m 700 /opt/keticompass-backups
sudo install -m 644 deploy/cron/keticompass-backup /etc/cron.d/keticompass-backup
sudo touch /var/log/keticompass-backup.log
sudo chown ubuntu:ubuntu /var/log/keticompass-backup.log
```

**没恢复验证过的备份不算备份。** 每隔一段时间拿一份恢复到临时库检查一遍（不会动正式数据）：

```bash
bash scripts/restore.sh /opt/keticompass-backups/<时间戳> --verify-only
```

真要恢复时把 `--verify-only` 换成 `--yes`。服务器本地的备份挡不住整机故障，
定期拉一份到自己电脑或网盘上。

另外，设置页里有「全库 JSON 备份」，可以随时下载一份不依赖本系统的明文数据（不含附件原件）。

## 4. 会议录音转写的维护任务（用转写功能时才需要）

转写有一套生命周期：超时任务重试、滞留任务补做、未确认的录音第 7 天删除。
这些由一个维护接口推进，需要每 10 分钟调用一次。

先在 `.env` 里设置 `MAINTENANCE_TOKEN`，然后改好 `deploy/cron/keticompass-maintenance`
里的路径、用户名和域名再安装。它实际执行的是：

```cron
*/10 * * * * ubuntu cd /opt/keticompass && set -a && . ./.env && set +a && curl -fsS -X POST -H "X-Maintenance-Token: ${MAINTENANCE_TOKEN}" https://desk.example.com/api/maintenance/cleanup >> /var/log/keticompass-maintenance.log 2>&1
```

令牌不写进 cron 文件（`/etc/cron.d` 下的文件全局可读），而是运行时从权限 600 的 `.env` 读取。

```bash
sudo touch /var/log/keticompass-maintenance.log
sudo chown ubuntu:ubuntu /var/log/keticompass-maintenance.log
sudo install -m 644 deploy/cron/keticompass-maintenance /etc/cron.d/keticompass-maintenance
```

**装完核对这几条**，任何一条不满足 cron 都会静默忽略这个文件：

```bash
stat -c "%a %U:%G" /etc/cron.d/keticompass-maintenance   # 需要 644 root:root
tail -c 1 /etc/cron.d/keticompass-maintenance | od -c    # 需要以 \n 结尾
systemctl is-active cron                                  # 需要 active
```

## 5. 升级

```bash
cd /opt/keticompass
BACKUP_DIR=/opt/keticompass-backups bash scripts/backup.sh   # 先备份
git pull
docker compose --profile full up -d --build          # 方案 B 在末尾加 app
```

应用启动时会自动执行数据库迁移（只应用新迁移，重复执行无副作用）。

**构建要十几分钟时，别用会超时断开的 SSH 会话去等**：断开只会杀掉本机的 ssh，
服务器上的构建还在跑，再启动一次就是两个构建抢内存。让它在服务器后台跑、再看日志：

```bash
setsid nohup docker compose --profile full up -d --build > /tmp/deploy.log 2>&1 < /dev/null &
tail -f /tmp/deploy.log
```

回退到旧版本：`git checkout <旧版本>` 后同样重建。**如果新版本带了数据库迁移，
代码回退之前先用升级前的那份备份恢复数据。**

## 6. 修改登录口令

`scripts/change-passcode.sh` 会校验新口令、更新 `.env` 并重启应用，失败时自动回滚原配置：

```bash
bash scripts/change-passcode.sh
```
