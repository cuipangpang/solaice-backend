#!/bin/bash
# 在服务器上执行：bash /opt/solaice/scripts/setup_deploy_key.sh
# 只需执行一次
# 用途：生成 GitHub Actions 专用 SSH 部署密钥，并打印需要添加到 GitHub Secrets 的内容

set -e

KEY_FILE=~/.ssh/github_actions_solaice
KEY_COMMENT="github-actions-solaice-$(date +%Y%m%d)"

echo "========================================"
echo "  配置 GitHub Actions 部署密钥"
echo "========================================"

# 生成 ED25519 密钥（更安全更短）
if [ ! -f "$KEY_FILE" ]; then
    ssh-keygen -t ed25519 -C "$KEY_COMMENT" -f "$KEY_FILE" -N ""
    echo "✅ 密钥生成完成"
else
    echo "✅ 密钥已存在，跳过生成"
fi

# 将公钥加入 authorized_keys
mkdir -p ~/.ssh
chmod 700 ~/.ssh
if ! grep -qF "$(cat "$KEY_FILE.pub")" ~/.ssh/authorized_keys 2>/dev/null; then
    cat "$KEY_FILE.pub" >> ~/.ssh/authorized_keys
    chmod 600 ~/.ssh/authorized_keys
    echo "✅ 公钥已添加到 authorized_keys"
else
    echo "✅ 公钥已在 authorized_keys 中，跳过添加"
fi

# 打印需要添加到 GitHub 的信息
echo ""
echo "========================================"
echo "  请将以下内容添加到 GitHub Secrets："
echo "  仓库：https://github.com/cuipangpang/solaice-backend"
echo "  路径：Settings → Secrets and variables → Actions → New repository secret"
echo "========================================"
echo ""
echo "【Secret 1】"
echo "名称：SERVER_SSH_KEY"
echo "值（私钥，包含 BEGIN 和 END 行，完整复制）："
echo "─────────────────────────────────────────"
cat "$KEY_FILE"
echo "─────────────────────────────────────────"
echo ""
echo "【Secret 2】"
echo "名称：SERVER_USER"
echo "值：$(whoami)"
echo ""
echo "========================================"
echo "  两个 Secret 添加完成后："
echo "  git push 到 main 分支即可触发自动部署"
echo "========================================"
