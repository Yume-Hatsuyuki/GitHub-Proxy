# GitHub Proxy

一个部署在 Cloudflare Workers 的固定上游 GitHub HTTPS 代理，并附带可选的 Tampermonkey 用户脚本，用于在 GitHub 页面上生成代理下载和 Git Clone 入口。

- 支持 Git Smart HTTP：Clone、Fetch、Pull、Push。
- 支持 Raw、Release、源码 ZIP/TAR.GZ、GitHub REST API / GraphQL、Gist、头像和静态资源转发。
- 附带浏览器用户脚本：为 Clone、Raw、Release 和源码归档添加代理入口。
- **不支持 SSH**。普通 Workers `fetch()` 不是 SSH/TCP 隧道。
- 不接受任意目标 URL；每类路径都映射到代码中固定的 GitHub 上游主机。

## 1. 部署到 Cloudflare Workers

需要 Node.js/npm，以及一个有权限部署 Workers 的 Cloudflare 账号。

```bash
npm install
npx wrangler login
npm run deploy
```

首次部署会得到一个 `workers.dev` 地址。可以先访问 `/health`，预期响应为 `ok`。

### 绑定自己的域名

域名不需要写入源码或 `wrangler.toml`。首次部署后，在 Cloudflare Dashboard 中：

1. 打开 **Workers & Pages**。
2. 选择 `github-proxy`。
3. 进入 **Settings → Domains & Routes**。
4. 选择 **Add → Custom Domain**。
5. 输入自己控制的域名并确认。

Cloudflare 会为 Custom Domain 配置 DNS 和 TLS。确保该主机名没有冲突的 DNS 记录。

如果不需要 `workers.dev` 入口，可以在 Dashboard 关闭它，并将 `wrangler.toml` 中的 `workers_dev` 设为 `false`。

本地开发：

```bash
npm run dev
```

语法检查和自动化测试：

```bash
npm run check
npm test
```

## 2. 路由

| Worker 路径 | 固定上游 | 用途 |
|---|---|---|
| `/gh/*` | `github.com` | Git HTTPS、仓库页面及 GitHub 常规路径 |
| `/release/*` | `github.com` | Release 下载快捷入口 |
| `/archive/*` | `github.com` | 源码 ZIP/TAR.GZ |
| `/raw/*` | `raw.githubusercontent.com` | Raw 文件 |
| `/codeload/*` | `codeload.github.com` | 源码归档 |
| `/api/*` | `api.github.com` | REST API 和 GraphQL |
| `/gist/*` | `gist.github.com` | Gist 页面 |
| `/gist-raw/*` | `gist.githubusercontent.com` | Gist Raw |
| `/avatars/*` | `avatars.githubusercontent.com` | 头像 |
| `/assets/*` | `github.githubassets.com` | GitHub 静态资源 |

请求只会被转发到代码中定义的固定上游。重定向仅允许 HTTPS 和白名单中的 GitHub 相关主机；跨主机跳转时会移除认证信息、Cookie、代理密钥等敏感请求头。

## 3. Git Clone / Pull / Push

将 GitHub HTTPS 仓库地址中的主机替换为自己的 Worker 域名，并在路径前添加 `/gh`。

```bash
git remote set-url origin https://YOUR-WORKER-HOST/gh/OWNER/REPOSITORY.git
git push -u origin main
```

后续可以继续使用：

```bash
git push
git pull
```

GitHub HTTPS 认证仍由 Git Credential Manager 或 Personal Access Token 处理。代理域名首次认证时可能需要重新保存凭据。不要将 PAT 写进远程 URL 或 Worker 源码。

## 4. 其他代理入口示例

以下示例中的 `YOUR-WORKER-HOST`、`OWNER`、`REPOSITORY`、`BRANCH` 和 `PATH` 都需要替换成自己的值。

```text
Raw:
https://YOUR-WORKER-HOST/raw/OWNER/REPOSITORY/BRANCH/PATH/TO/FILE

Release:
https://YOUR-WORKER-HOST/release/OWNER/REPOSITORY/releases/download/TAG/FILE

Source archive:
https://YOUR-WORKER-HOST/archive/OWNER/REPOSITORY/archive/refs/heads/BRANCH.zip

GitHub API:
https://YOUR-WORKER-HOST/api/repos/OWNER/REPOSITORY
```

## 5. Tampermonkey 用户脚本

脚本文件：[`userscript/github-proxy-enhancement.user.js`](userscript/github-proxy-enhancement.user.js)

### 安装

1. 安装 Tampermonkey。
2. 打开 Tampermonkey 的管理面板，创建新脚本。
3. 将上述 `.user.js` 文件的完整内容复制进去并保存。
4. 打开 `github.com`，点击 Tampermonkey 菜单中的 **GitHub Proxy: Set proxy URL**。
5. 输入 Worker 的基础地址，例如 `https://your-worker.example.workers.dev`。只填写协议和主机名，不要附加 `/gh`、`/raw` 等路径。
6. 刷新 GitHub 页面。

脚本会把代理基础地址保存在 Tampermonkey 的脚本存储中，不会把个人域名写入项目源码。

### 功能

- **Git Clone**：打开 GitHub 仓库的 Code/Clone 面板，并显示 HTTPS 克隆地址后，脚本会提供复制代理 URL、复制 `git clone` 命令和打开代理 URL 的操作。
- **Raw 文件**：在文件详情页添加 `Raw via Proxy` 入口。
- **文件列表**：在目录文件列表的文件名旁添加云朵下载入口，走 `/raw/` 路由。
- **Release**：在 Release 资产链接旁添加 `Proxy` 下载入口，走 `/release/` 路由。
- **源码归档**：在 GitHub ZIP/TAR.GZ 和 Codeload 链接旁添加代理入口，分别走 `/archive/` 或 `/codeload/` 路由。
- 可通过 Tampermonkey 菜单更改代理地址或启用/停用增强功能。

脚本只运行在 `github.com`，不注入第三方站点，不加载远程脚本，也不需要访问 GitHub 以外的网络权限。它不会修改 GitHub 原始链接，只会在旁边添加代理入口。

> 如果 Worker 设置了 `PROXY_KEY`，普通浏览器超链接无法自动添加 `X-Proxy-Key` 请求头，因此该用户脚本的直接下载入口不能使用受密钥保护的代理。公开代理或需要认证的 Git 客户端场景应分别考虑访问策略。

## 6. 可选：设置代理访问密钥

默认情况下，拥有 Worker 地址的人都可以使用代理。公开部署会消耗部署者的请求额度和流量。若要限制访问，可以设置 Worker Secret：

```bash
npx wrangler secret put PROXY_KEY
```

启用后，除 `/` 和 `/health` 外，请求必须携带 `X-Proxy-Key` 请求头。

Git 客户端可以为代理主机设置额外请求头：

```bash
git config --global http.https://YOUR-WORKER-HOST/.extraheader "X-Proxy-Key: YOUR_PROXY_KEY"
```

移除配置：

```bash
git config --global --unset-all http.https://YOUR-WORKER-HOST/.extraheader
```

Git 配置中的密钥以明文保存，只应在可信设备上使用。若不需要访问控制，不要设置 `PROXY_KEY`。

## 7. 限制与注意事项

- Git Smart HTTP 请求体和响应体按流转发，不会在 Worker 中完整缓冲 Git Pack 数据。
- Git 协议和 API 请求不缓存；下载响应保留上游缓存策略。
- GitHub 网页 HTML 会被转发，但页面绝对链接、Cookie 域和外部资源没有被完整重写；本项目不是完整的 GitHub 网页镜像。
- Workers Free 的请求配额、CPU 时间和所在 Zone 的 HTTP 请求体限制可能影响高并发或大型提交。部署前请核对 Cloudflare 当前套餐限制。
- 单次上传请求受 Cloudflare Zone 的请求体大小限制；超过限制的 Git Push 可能收到 HTTP 413。
- Release/归档下载速度取决于客户端到 Cloudflare、Cloudflare 到 GitHub 的网络链路，不保证一定快于直连。
- 本项目不提供 SSH 代理，也不实现 Git LFS 专用传输端点。

## 8. 快速测试

```bash
curl -i https://YOUR-WORKER-HOST/health
```

测试公开仓库 Git Smart HTTP：

```bash
curl -i "https://YOUR-WORKER-HOST/gh/OWNER/REPOSITORY.git/info/refs?service=git-upload-pack"
```

通常应返回 HTTP 200，内容类型为 `application/x-git-upload-pack-advertisement`。

测试 Raw：

```bash
curl -I "https://YOUR-WORKER-HOST/raw/OWNER/REPOSITORY/BRANCH/README.md"
```
