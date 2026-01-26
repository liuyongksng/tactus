[English](README.md) | 简体中文

# ![icon](public/icon/32.png) Tactus

**首个支持 Agent Skills 的浏览器 AI Agent 扩展**

Tactus 是一款创新的浏览器扩展，将 [Agent Skills](https://agentskills.io/specification) 规范引入浏览器环境，让 AI Agent 能够通过可扩展的技能系统执行复杂任务。

触发 skills 可实现特定场景的提示词注入，常用工作流可封装在脚本中执行，代替 AI Agent 重复的自动化操作，既快速又省token。

<!-- 演示动图占位符 -->
![Tactus 演示](resources/trust-skill.png)
![Tactus 演示](resources/show-result.png)

## ✨ 核心特性

### 🧩 Agent Skills 系统

Tactus 是首个在浏览器扩展中实现 Agent Skills 规范的产品：

- **技能导入** - 支持导入符合规范的 Skill 文件夹，包含指令、脚本和资源文件
- **脚本执行** - 在页面中安全执行 JavaScript 脚本   
- **信任机制** - 首次执行脚本需用户确认，可选择永久信任

<!-- Skills 导入演示占位符 -->
![Skills 导入演示](resources/add-skill.png)

### 🤖 智能对话

- **OpenAI 兼容 API** - 支持 OpenAI 兼容的 API 服务商
- **多模型切换** - 配置多个服务商，随时切换模型
- **流式响应** - 实时显示 AI 回复，支持思维链展示
- **ReAct 范式** - 内置工具调用循环，AI 可自主决策使用工具

### 📄 页面理解

- **智能提取** - 使用 Readability + Turndown 提取页面核心内容并转换为 Markdown
- **选中引用** - 选中页面文字后一键引用提问带上
- **上下文感知** - AI自行判断是否调用网页提取工具，如果 skill 脚本有提供则不会

<!-- 页面交互演示占位符 -->
![页面交互演示](resources/page-interaction.png)

### 💾 本地存储

- **会话管理** - 对话历史本地存储，支持分页加载
- **IndexedDB** - Skills 和文件存储在本地数据库
- **隐私优先** - 所有数据保存在本地，不上传任何服务器

## 🚀 快速开始

### 1. 下载
从官方 Github [发布页面](https://github.com/Castor6/tactus/releases) 下载最新的 `tactus.zip` 文件。

### 2. 安装
- 在固定目录解压 `tactus.zip` 。
- 在 Chrome 中打开 `chrome://extensions/`
- 启用 `开发者模式`（右上角）
- 点击 `加载未打包的扩展程序` （左上角）
- 选择已解压的 `tactus` 文件夹。

## 🛠️ 从源代码构建

1. 克隆仓库
```bash
git clone https://github.com/Castor6/tactus.git
cd tactus
```

2. 安装依赖
```bash
npm install
```

3. 开发模式运行
```bash
npm run dev
```

4. 构建生产版本
```bash
npm run build
```

## 📖 使用指南

### 配置 AI 服务商

1. 点击扩展图标打开侧边栏
2. 点击设置按钮进入配置页面
3. 添加 API 服务商（填写名称、API 地址、密钥）
4. 获取模型列表并选择模型

<!-- 配置演示占位符 -->
![配置演示](resources/set-llm.png)

### 导入 Skill

1. 在设置页面找到 Skills 管理区域
2. 点击"导入 Skill"按钮
3. 选择包含 `SKILL.md` 的文件夹
4. 确认导入后即可在对话中使用

### Skill 文件夹结构

```
my-skill/
├── SKILL.md          # 必需：技能定义和指令
├── scripts/          # 可选：可执行脚本
│   └── fetch-data.js
├── references/       # 可选：参考文档
│   └── api-docs.md
└── assets/           # 可选：资源文件
    └── template.json
```

### SKILL.md 格式

```markdown
---
name: my-skill
description: 这是一个示例技能
---

# 技能指令

当用户需要执行某任务时，按以下步骤操作：

1. 首先分析用户需求
2. 调用 scripts/fetch-data.js 获取数据
3. 整理并返回结果
```

## 🛠️ 技术栈

- **框架**: [WXT](https://wxt.dev/) - 现代浏览器扩展开发框架
- **前端**: Vue 3 + TypeScript
- **AI 集成**: OpenAI SDK（兼容任意 OpenAI API）
- **内容提取**: @mozilla/readability + turndown
- **存储**: IndexedDB (idb) + WXT Storage

## 🔧 内置工具

Tactus 为 AI 提供以下内置工具：

| 工具 | 描述 |
|------|------|
| `extract_page_content` | 提取当前页面的主要内容 |
| `activate_skill` | 激活指定的 Skill |
| `execute_skill_script` | 执行 Skill 中的脚本 |
| `read_skill_file` | 读取 Skill 中的文件内容 |

## 📝 开发

### 项目结构

```
tactus/
├── entrypoints/
│   ├── background.ts      # 后台脚本
│   ├── content.ts         # 内容脚本
│   ├── sidepanel/         # 侧边栏 UI
│   └── options/           # 设置页面
├── components/            # Vue 组件
├── utils/
│   ├── api.ts             # API 调用
│   ├── db.ts              # IndexedDB 操作
│   ├── skills.ts          # Skills 核心逻辑
│   ├── skillsExecutor.ts  # 脚本执行器
│   └── skillsImporter.ts  # Skills 导入
└── public/                # 静态资源
```

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 🚧 未来发展路线图

我们对 Tactus 的未来发展有着激动人心的计划：
- [ ] 引入 CDP 自动化作为 Agent 的工具，可人工接管介入
- [ ] 操作录制一键生成可复用的 skills
- [ ] 长时稳定自动化任务挑战

## 📄 许可证

Apache-2.0 License

---

**Tactus** - 赋予 AI 触觉，代你行走网络 🚀
