# 使用 ubuntu 作为构建阶段来处理脚本
FROM --platform=linux/amd64 ubuntu:latest as builder

# 复制脚本
COPY entrypoint.sh /entrypoint.sh

# 确保脚本格式正确
RUN apt-get update && apt-get install -y dos2unix \
    && dos2unix /entrypoint.sh \
    && chmod +x /entrypoint.sh

# 使用 ollama 作为最终镜像
FROM --platform=linux/amd64 ollama/ollama:latest

# 安装 bash (使用 apt 而不是 apk)
RUN apt-get update && apt-get install -y bash

# 从构建阶段复制处理好的脚本
COPY --from=builder /entrypoint.sh /entrypoint.sh

# 设置入口点
ENTRYPOINT ["/bin/bash", "/entrypoint.sh"] 