#!/bin/bash

# 启动 Ollama 服务
ollama serve &

# 等待服务启动
sleep 10

# 拉取 deepseek-r1 模型
# ollama pull deepseek-r1

ollama pull deepseek-r1:14b

# # 拉取 llama3.2 模型
# ollama pull llama3.2

# 保持容器运行
tail -f /dev/null
 