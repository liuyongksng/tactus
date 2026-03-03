/**
 * OpenAI Function Calling 工具定义
 */

import { mcpManager, mcpToolToOpenAITool, parseMcpToolName, isMcpTool, type McpTool } from './mcp';

// OpenAI Function Calling 格式的工具定义
export interface FunctionTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, { type: string; description: string }>;
      required: string[];
      additionalProperties?: boolean;
    };
    strict?: boolean;
  };
}

// 工具状态文本映射
export interface ToolStatusMap {
  [toolName: string]: string;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, any>;
}

export interface ToolResult {
  tool_call_id: string;
  name: string;
  result: string;
  success: boolean;
}

// 工具状态提示文本（静态）
const toolStatusTexts: ToolStatusMap = {
  extract_page_content: '正在提取网页内容...',
  activate_skill: '正在激活 Skill...',
  execute_skill_script: '正在执行脚本...',
  read_skill_file: '正在读取文件...',
};

// 导出 MCP 相关函数
export { parseMcpToolName, isMcpTool };

// 工具状态提示文本（动态，带参数）
function getDynamicToolStatusText(
  toolName: string,
  args?: Record<string, any>
): string | null {
  if (!args) return null;

  // MCP 工具
  if (isMcpTool(toolName)) {
    const parsed = parseMcpToolName(toolName);
    if (parsed) {
      return `正在调用 MCP 工具: ${parsed.toolName}...`;
    }
  }

  switch (toolName) {
    case 'activate_skill':
      if (args.skill_name) {
        return `正在激活 Skill: ${args.skill_name}...`;
      }
      break;
    case 'execute_skill_script':
      if (args.skill_name && args.script_path) {
        return `正在执行脚本: ${args.skill_name}/${args.script_path}...`;
      }
      break;
    case 'read_skill_file':
      if (args.skill_name && args.file_path) {
        return `正在读取文件: ${args.skill_name}/${args.file_path}...`;
      }
      break;
  }
  return null;
}

// 定义可用工具（OpenAI Function Calling 格式）
export const availableTools: FunctionTool[] = [
  {
    type: 'function',
    function: {
      name: 'extract_page_content',
      description: '提取并清洗当前网页的主要内容，返回包含标题、作者、来源等元数据的结构化 Markdown 格式文本。当用户询问关于当前页面的问题时，需要调用此工具获取页面内容。',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'activate_skill',
      description: '激活一个已安装的 Skill，加载其完整指令到上下文中。当用户的任务匹配某个 Skill 的描述时调用此工具。',
      parameters: {
        type: 'object',
        properties: {
          skill_name: { type: 'string', description: 'Skill 的名称' },
        },
        required: ['skill_name'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'execute_skill_script',
      description: '执行 Skill 中的脚本文件。脚本在当前页面上下文中运行，可访问 DOM。脚本执行前可能需要用户确认。可通过 arguments 传递参数，脚本中通过 __args__ 变量获取。',
      parameters: {
        type: 'object',
        properties: {
          skill_name: { type: 'string', description: 'Skill 的名称' },
          script_path: { type: 'string', description: '脚本文件路径' },
          arguments: { type: 'object', description: '传递给脚本的参数对象（可选），脚本中通过 __args__ 获取' },
        },
        required: ['skill_name', 'script_path'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_skill_file',
      description: '读取 Skill 中的引用文件。可读取 references/ 目录下的引用文件（如文档、配置模板）或 assets/ 目录下的文本资源。仅支持文本文件。',
      parameters: {
        type: 'object',
        properties: {
          skill_name: { type: 'string', description: 'Skill 的名称' },
          file_path: { type: 'string', description: '引用文件路径' },
        },
        required: ['skill_name', 'file_path'],
        additionalProperties: false,
      },
    },
  },
];

// 获取工具的状态提示文本
export function getToolStatusText(
  toolName: string,
  args?: Record<string, any>
): string {
  // 优先使用动态状态文本
  const dynamicText = getDynamicToolStatusText(toolName, args);
  if (dynamicText) {
    return dynamicText;
  }
  // 回退到静态状态文本
  return toolStatusTexts[toolName] || `正在执行 ${toolName}...`;
}

// Skills 提示生成（从 skills.ts 导入的类型）
export interface SkillInfo {
  name: string;
  description: string;
}

// 根据上下文过滤可用工具
export function getFilteredTools(context?: {
  sharePageContent?: boolean;
  skills?: SkillInfo[];
  mcpTools?: McpTool[];
}): FunctionTool[] {
  const tools: FunctionTool[] = [];

  // 添加内置工具
  for (const tool of availableTools) {
    const toolName = tool.function.name;
    
    // 如果未分享页面内容，禁用 extract_page_content
    if (toolName === 'extract_page_content' && !context?.sharePageContent) {
      continue;
    }
    
    // 如果没有 skills，禁用 skill 相关工具
    if ((toolName === 'activate_skill' || toolName === 'execute_skill_script' || toolName === 'read_skill_file')) {
      if (!context?.skills || context.skills.length === 0) {
        continue;
      }
    }
    
    tools.push(tool);
  }

  // 添加 MCP 工具
  if (context?.mcpTools && context.mcpTools.length > 0) {
    for (const mcpTool of context.mcpTools) {
      tools.push(mcpToolToOpenAITool(mcpTool));
    }
  }

  return tools;
}

// 生成 Skills 系统提示（用于 function calling 上下文）
function buildSkillsContextPrompt(skills?: SkillInfo[]): string {
  if (!skills || skills.length === 0) {
    return '';
  }

  const skillsXml = skills.map(skill =>
    `  <skill>
    <name>${skill.name}</name>
    <description>${skill.description}</description>
  </skill>`
  ).join('\n');

  return `

## 可用 Skills
以下 Skills 已安装，当用户的任务匹配某个 Skill 的描述时，使用 activate_skill 工具激活它：

<available_skills>
${skillsXml}
</available_skills>

### 工具优先级
当需要获取页面内容时：
1. **优先检查** Skills 列表，如果某个 Skill 的描述表明它专门处理当前网站/页面类型，先激活该 Skill
2. **否则** 使用通用的 extract_page_content 工具

激活 Skill 后，你将获得详细的指令来完成任务。`;
}

// 语言类型
export type Language = 'en' | 'zh-CN';

// 生成 MCP 工具上下文提示
function buildMcpToolsContextPrompt(mcpTools?: McpTool[]): string {
  if (!mcpTools || mcpTools.length === 0) {
    return '';
  }

  // 按 Server 分组
  const toolsByServer = new Map<string, McpTool[]>();
  for (const tool of mcpTools) {
    const existing = toolsByServer.get(tool.serverName) || [];
    existing.push(tool);
    toolsByServer.set(tool.serverName, existing);
  }

  const serverSections: string[] = [];
  for (const [serverName, tools] of toolsByServer) {
    const toolsXml = tools.map(tool =>
      `    <tool>
      <name>${tool.name}</name>
      <description>${tool.description || '无描述'}</description>
    </tool>`
    ).join('\n');

    serverSections.push(`  <server name="${serverName}">
${toolsXml}
  </server>`);
  }

  return `

## MCP 工具
以下 MCP Server 已连接，你可以使用它们提供的工具：

<mcp_servers>
${serverSections.join('\n')}
</mcp_servers>

调用 MCP 工具时，工具名称格式为 \`mcp__{serverId}__{toolName}\`，直接使用即可。`;
}

// 生成上下文提示
export function generateContextPrompt(context?: {
  sharePageContent?: boolean;
  skills?: SkillInfo[];
  mcpTools?: McpTool[];
  pageInfo?: {
    domain: string;
    title: string;
    url?: string;
  };
  language?: Language;
}): string {
  const hints: string[] = [];
  
  // 语言设置提示
  if (context?.language) {
    const langName = context.language === 'zh-CN' ? '简体中文' : 'English';
    hints.push(`- Always respond in ${langName}`);
  }
  
  if (context?.sharePageContent) {
    let hint = '- 用户已点击输入框上方标签页高亮分享当前页面内容，当用户询问关于当前页面的问题时，你需要先获取页面内容';
    if (context.pageInfo) {
      hint += `\n- 当前页面：${context.pageInfo.title}（${context.pageInfo.domain}）`;
      if (context.pageInfo.url) {
        hint += `\n- 页面 URL：${context.pageInfo.url}`;
      }
    }
    hints.push(hint);
  } else {
    hints.push('- 用户未点击输入框上方标签页高亮分享当前页面内容，extract_page_content 工具当前不可用');
  }

  const skillsPrompt = buildSkillsContextPrompt(context?.skills);
  const mcpPrompt = buildMcpToolsContextPrompt(context?.mcpTools);

  return `## 当前上下文
${hints.join('\n')}${skillsPrompt}${mcpPrompt}

## 重要提示
- 不要假设页面内容，必须通过工具获取真实内容
- 工具调用后会返回结果，你需要基于结果进行回答`;
}
