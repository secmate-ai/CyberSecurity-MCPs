# Model Context Protocol Server For Cyber Security

## 项目简介

这是一个专注于网络安全领域的 Model Context Protocol Server (MCPs) 集合项目，包含两个主要目标：

1. 收集和整理现有的网络安全相关 MCP 服务器实现
2. 开发新的 MCP Server 实现

每个 MCP Server 都独立封装在各自的目录中，便于管理和使用。

## 实现列表

### 1. sqlmap-mcp

SQL注入测试工具的MCP服务器实现。基于TypeScript开发，提供了以下功能：

- 支持对目标URL进行SQL注入扫描
- 提供创建和管理测试笔记的功能
- 集成了调试工具支持

### 2. quake-server

基于360 Quake的网络空间搜索引擎MCP服务器实现。主要特点：

- 提供网络空间资产搜索能力
- 支持资源管理和笔记功能
- 基于TypeScript开发的现代化架构

### 3. doc-processor

Markdown到Word文档的转换工具MCP服务器实现。主要特点：

- 支持将Markdown格式内容转换为Word文档
- 支持嵌套列表、表格、代码块等Markdown元素
- 提供自定义样式和格式控制
- 能够处理中文文档和特殊格式要求

## 项目结构

```plaintext
.
├── implementations/           # 自主开发的 MCP Server 实现
│   ├── sqlmap-mcp/          # SQL注入测试工具MCP实现
│   │   ├── src/             # 源代码目录
│   │   ├── build/          # 编译输出目录
│   │   └── README.md       # 实现文档
│   ├── quake-server/        # Quake搜索引擎MCP实现
│   │   ├── src/             # 源代码目录
│   │   ├── build/          # 编译输出目录
│   │   └── README.md       # 实现文档
│   └── doc-processor/       # 文档处理工具MCP实现
│       ├── src/             # 源代码目录
│       ├── build/          # 编译输出目录
│       └── README.md       # 实现文档
└── README.md               # 项目主文档
```

## 开发

每个实现都遵循类似的开发流程：

1. 安装依赖：
```bash
npm install
```

2. 构建服务器：
```bash
npm run build
```

3. 开发模式（自动重新构建）：
```bash
npm run watch
```

## 安装使用

要在Claude Desktop中使用这些MCP服务器，需要在配置文件中添加相应的服务器配置：

MacOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
Windows: `%APPDATA%/Claude/claude_desktop_config.json`

示例配置：
```json
{
  "mcpServers": {
    "sqlmap-server": {
      "command": "/path/to/sqlmap-mcp/build/index.js"
    },
    "quake-server": {
      "command": "node",
      "args": [
        "/path/to/quake-server/build/index.js"
      ],
      "env": {
        "QUAKE_API_KEY": "xxxxxx-xxxx-xxxx-xxxx-xxxxxxx"
      },
      "disabled": false,
      "alwaysAllow": []
    },
    "doc-processor": {
      "command": "node",
      "args": [
        "/path/to/doc-processor/build/index.js"
      ],
      "disabled": false,
      "alwaysAllow": []
    }
  }
}
```

## 调试

所有MCP服务器都支持使用[MCP Inspector](https://github.com/modelcontextprotocol/inspector)进行调试：

```bash
npm run inspector
```

Inspector将提供一个Web界面用于服务器调试。