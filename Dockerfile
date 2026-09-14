FROM node:24-alpine AS builder
WORKDIR /app
RUN apk add --no-cache libc6-compat
# 构建期也要东八区：next build 会预渲染，任何在构建时求值的日期都按进程时区算
ENV TZ=Asia/Shanghai

# 先装依赖，让 npm ci 这层能被缓存。postinstall 会跑 prisma generate，
# 所以 schema 必须先于 npm ci 到位。
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci

COPY . .

# Next.js allows projects without static assets, but the runner stage copies this
# directory unconditionally. Create it so clean builds do not depend on stale files.
RUN mkdir -p public

# **必须在 COPY . . 之后再 generate 一次。**
# 上一步的 npm ci 里 postinstall 已经生成过 Prisma Client 了，但 `COPY . .` 会把
# 构建上下文里的 lib/generated 盖回来——它是生成产物、在 .gitignore 里，本地和
# 服务器上都可能残留一份**旧的**。2026-07-29 就这样翻过一次车：新增 CaptureItem
# 后，服务器上残留的旧 client 覆盖了刚生成的，构建报
# `Property 'captureItem' does not exist on type 'PrismaClient'`。
#
# .dockerignore 也排除了 lib/generated，两道一起上：一道防它进上下文，
# 一道保证无论上下文里有什么，最终用的都是按当前 schema 生成的。
RUN npx prisma generate

# 构建期给个占位连接串。`next build` 会为每个路由收集页面数据，这一步会 import 到
# lib/db.ts，而它在**模块求值时**就创建 Prisma Client、缺 DATABASE_URL 直接抛错——
# 构建机上本来就不该有真库地址。占位串只为让模块求值通过。
#
# 它必须是个连不上的地址：`app/(app)/layout.tsx` 的 force-dynamic 保证登录后的页面
# 一个都不在构建期查库，占位串连不上就等于给这条约束上了把锁——将来谁写出一个会在
# 构建期查库的页面，构建会当场红，而不是把烘死的数据带上线。
#
# 真正的地址由 docker-compose 在**运行时**注入；运行时缺它仍然照常报错。
RUN DATABASE_URL="postgresql://build:build@127.0.0.1:5432/build?schema=public" npm run build

# 运行镜像只需要生产依赖。Prisma CLI 属于运行依赖，因为容器启动前要执行
# migrate deploy；它不能留在 devDependencies 再把整棵开发依赖复制进生产。
FROM node:24-alpine AS prod-deps
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci --omit=dev && npm cache clean --force

FROM node:24-alpine AS runner
WORKDIR /app
# tzdata 不是给 Node 用的（自带 ICU 就认得 Asia/Shanghai，实测有效），
# 是给容器里的其他东西——shell、日志时间戳——用的，免得排查时两套时间对不上
RUN apk add --no-cache libc6-compat tzdata
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# 时区：node:alpine 默认 UTC，而 lib/date.ts 的 todayAsDateOnly() 按**进程本地
# 时区**判断「今天是几号」。留 UTC 的话，东八区每天 00:00–08:00 之间「今天」会
# 算成昨天——倒计时、逾期判定、周期任务生成全部差一天。
# 全平台只有这一套时区假设：进程时区 = 用户所在时区。
ENV TZ=Asia/Shanghai

# 只带生产依赖与编译产物，不把 TypeScript 源码、测试和构建工具塞进运行镜像。
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/.next ./.next
COPY --from=builder --chown=node:node /app/public ./public
COPY --chown=node:node package.json package-lock.json next.config.ts prisma.config.ts ./
COPY --chown=node:node prisma ./prisma

# 附件目录（PRD 6），docker-compose 会把宿主机目录挂到这里
RUN mkdir -p /app/data/uploads && chown -R node:node /app/data
# Docker 会把镜像内挂载点的属主与模式复制到第一次挂载的空 named volume。
# 必须在 USER node 前准备，否则卷根是 root:root，应用无法收紧权限或写入。
RUN mkdir -p /var/lib/teacher-desk-audio \
    && chown node:node /var/lib/teacher-desk-audio \
    && chmod 0700 /var/lib/teacher-desk-audio

USER node
EXPOSE 3000

# 启动前先把迁移跑掉。服务器上是空库，只 `next start` 的话一张表都没有；
# migrate deploy 只应用已有迁移、不生成新的，重复执行无副作用。
# 失败就让容器退出（restart 策略会重试），不要带着半套表继续跑。
CMD ["sh", "-c", "npx prisma migrate deploy && npm run start"]
