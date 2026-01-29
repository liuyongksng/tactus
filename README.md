English | [简体中文](README_ch.md)

# ![icon](public/icon/32.png) Tactus

**The First Browser AI Agent Extension with Agent Skills Support**

Tactus is an innovative browser extension that brings the [Agent Skills](https://agentskills.io/specification) specification to the browser environment, enabling AI Agent to perform complex tasks through an extensible skill system.

Triggering skills can achieve prompt injection for specific scenarios, and common workflows can be encapsulated in scripts for execution, replacing repetitive automated operations of AI Agents. This approach is both fast and token-efficient.

<!-- Demo GIF placeholder -->
![Tactus Demo](resources/trust-skill.png)
![Tactus Demo](resources/show-result.png)

## ✨ Core Features

### 🧩 Agent Skills System

Tactus is the first product to implement the Agent Skills specification in a browser extension:

- **Skill Import** - Import spec-compliant Skill folders containing instructions, scripts, and resource files
- **Script Execution** - Safely execute JavaScript scripts within pages
- **Trust Mechanism** - First-time script execution requires user confirmation, with option to permanently trust

<!-- Skills Import Demo placeholder -->
![Skills Import Demo](resources/add-skill.png)

### 🤖 Intelligent Conversation

- **OpenAI Compatible API** - Supports OpenAI-compatible API providers
- **Multi-Model Switching** - Configure multiple providers and switch models anytime
- **Streaming Response** - Real-time AI replies with chain-of-thought display
- **ReAct Paradigm** - Built-in tool calling loop, AI autonomously decides when to use tools

### 📄 Page Understanding

- **Smart Extraction** - Uses Readability + Turndown to extract core page content and convert to Markdown
- **Selection Quote** - Select text on page and quote it with one click
- **Context Awareness** - AI determines whether to call page extraction tool; skips if skill script provides it

<!-- Page Interaction Demo placeholder -->
![Page Interaction Demo](resources/page-interaction.png)

### 💾 Local Storage

- **Session Management** - Conversation history stored locally with pagination support
- **IndexedDB** - Skills and files stored in local database
- **Privacy First** - All data saved locally, nothing uploaded to any server

## 🚀 Quick Start

### 1. Download
Download the latest `tactus.zip` file from the official GitHub [Releases page](https://github.com/Castor6/tactus/releases).

### 2. Install
- Extract `tactus.zip` to a permanent directory
- Open `chrome://extensions/` in Chrome
- Enable `Developer mode` (top right)
- Click `Load unpacked` (top left)
- Select the extracted `tactus` folder

## 🛠️ Build from Source

1. Clone the repository
```bash
git clone https://github.com/Castor6/tactus.git
cd tactus
```

2. Install dependencies
```bash
npm install
```

3. Run in development mode
```bash
npm run dev
```

4. Build for production
```bash
npm run build
```

5. Please use the Professional style within the `.claude\skills\design-style` skills to design with a unified extended UI style.

## 📖 User Guide

### Configure AI Provider

1. Click the extension icon to open the sidebar
2. Click the settings button to enter configuration page
3. Add API provider (fill in name, API URL, key)
4. Fetch model list and select a model

<!-- Configuration Demo placeholder -->
![Configuration Demo](resources/set-llm.png)

### Import Skill

1. Find the Skills management area in settings page
2. Click "Import Skill" button
3. Select a folder containing `SKILL.md`
4. Confirm import and use it in conversations

### Skill Folder Structure

```
my-skill/
├── SKILL.md          # Required: Skill definition and instructions
├── scripts/          # Optional: Executable scripts
│   └── fetch-data.js
├── references/       # Optional: Reference documents
│   └── api-docs.md
└── assets/           # Optional: Resource files
    └── template.json
```

### SKILL.md Format

```markdown
---
name: my-skill
description: This is an example skill
---

# Skill Instructions

When user needs to perform a task, follow these steps:

1. First analyze user requirements
2. Call scripts/fetch-data.js to fetch data
3. Organize and return results
```

## 🛠️ Tech Stack

- **Framework**: [WXT](https://wxt.dev/) - Modern browser extension development framework
- **Frontend**: Vue 3 + TypeScript
- **AI Integration**: OpenAI SDK (compatible with any OpenAI API)
- **Content Extraction**: @mozilla/readability + turndown
- **Storage**: IndexedDB (idb) + WXT Storage

## 🔧 Built-in Tools

Tactus provides the following built-in tools for AI:

| Tool | Description |
|------|-------------|
| `extract_page_content` | Extract main content from current page |
| `activate_skill` | Activate a specified Skill |
| `execute_skill_script` | Execute script within a Skill |
| `read_skill_file` | Read file content from a Skill |

## 📝 Development

### Project Structure

```
tactus/
├── entrypoints/
│   ├── background.ts      # Background script
│   ├── content.ts         # Content script
│   ├── sidepanel/         # Sidebar UI
│   └── options/           # Settings page
├── components/            # Vue components
├── utils/
│   ├── api.ts             # API calls
│   ├── db.ts              # IndexedDB operations
│   ├── skills.ts          # Skills core logic
│   ├── skillsExecutor.ts  # Script executor
│   └── skillsImporter.ts  # Skills import
└── public/                # Static assets
```

## 🤝 Contributing

Issues and Pull Requests are welcome!

## 🚧 Future Roadmap

We have exciting plans for the future development of Tactus:
- [ ] Introduce CDP automation as a tool for the Agent, allowing manual intervention and takeover.
- [ ] Record operations and generate reusable skills with a single click.
- [ ] Tackle the challenges of long-term stable automation tasks.

## 📄 License

Apache-2.0 License

## ⭐ Star History

[![Star History Chart](https://api.star-history.com/svg?repos=Castor6/tactus&type=Date)](https://star-history.com/#Castor6/tactus&Date)

---

**Tactus** - granting AI the sense of touch to navigate the web 🚀
