/**
 * 国际化工具 - 简单的 i18n 实现
 */

import type { Language } from './storage';

// 翻译文本类型
export interface Translations {
  // 通用
  save: string;
  cancel: string;
  delete: string;
  confirm: string;
  loading: string;
  
  // 导航
  navModels: string;
  navSkills: string;
  navMcp: string;
  navSettings: string;
  
  // 模型配置
  modelConfig: string;
  modelConfigDesc: string;
  providerList: string;
  addProvider: string;
  editProvider: string;
  providerName: string;
  providerNamePlaceholder: string;
  baseUrl: string;
  baseUrlPlaceholder: string;
  baseUrlHint: string;
  apiKey: string;
  apiKeyPlaceholder: string;
  apiMode: string;
  apiModeDesc: string;
  apiModeAuto: string;
  apiModeChatCompletions: string;
  apiModeResponses: string;
  modelList: string;
  fetchModels: string;
  fetchingModels: string;
  availableModels: string;
  clickToAdd: string;
  customModelPlaceholder: string;
  add: string;
  addedModels: string;
  supportsVision: string;
  supportsVisionDesc: string;
  modelVision: string;
  modelVisionEnabled: string;
  modelVisionDisabled: string;
  saveConfig: string;
  saving: string;
  noProviders: string;
  selectOrAddProvider: string;
  modelsCount: string;
  
  // Skills 管理
  skillsManagement: string;
  skillsManagementDesc: string;
  installedSkills: string;
  importSkill: string;
  imported: string;
  builtin: string;
  compatibility: string;
  scriptFiles: string;
  referenceFiles: string;
  assetFiles: string;
  instructionsPreview: string;
  trusted: string;
  needConfirm: string;
  scriptHint: string;
  noSkills: string;
  selectSkillOrImport: string;
  scriptsCount: string;
  
  // 导入 Modal
  importSkillTitle: string;
  importSkillDesc: string;
  selectFolder: string;
  importing: string;
  skillFolderStructure: string;
  required: string;
  optional: string;
  jsOnly: string;
  importSuccess: string;
  importWarnings: string;
  
  // 通用设置
  generalSettings: string;
  generalSettingsDesc: string;
  language: string;
  languageDesc: string;
  floatingBall: string;
  floatingBallDesc: string;
  floatingBallEnabled: string;
  floatingBallDisabled: string;
  selectionQuote: string;
  selectionQuoteDesc: string;
  pageContentLimit: string;
  pageContentLimitDesc: string;
  pageContentLimitHint: string;
  toolCallLimit: string;
  toolCallLimitDesc: string;
  toolCallLimitHint: string;
  
  // 原始提取网站设置
  rawExtractSites: string;
  rawExtractSitesDesc: string;
  rawExtractSitesPlaceholder: string;
  rawExtractSitesHint: string;
  addSite: string;
  noSitesConfigured: string;
  
  // MCP 配置
  mcpConfig: string;
  mcpConfigDesc: string;
  mcpServerList: string;
  mcpAddServer: string;
  mcpEditServer: string;
  mcpServerName: string;
  mcpServerNamePlaceholder: string;
  mcpServerUrl: string;
  mcpServerUrlPlaceholder: string;
  mcpServerUrlHint: string;
  mcpServerDescription: string;
  mcpServerDescriptionPlaceholder: string;
  mcpServerStatus: string;
  mcpEnabled: string;
  mcpDisabled: string;
  mcpNoServers: string;
  mcpSelectOrAdd: string;
  mcpTestConnection: string;
  mcpTest: string;
  mcpTesting: string;
  mcpTestSuccess: string;
  mcpToolCount: string;
  mcpConfirmDelete: string;
  mcpInvalidUrl: string;
  mcpEnterUrl: string;
  mcpAuthToken: string;
  mcpAuthTokenPlaceholder: string;
  mcpAuthTokenHint: string;
  mcpAuthType: string;
  mcpAuthNone: string;
  mcpAuthBearer: string;
  mcpAuthOAuth: string;
  mcpOAuthHint: string;
  
  // Sidepanel
  newChat: string;
  history: string;
  settings: string;
  sharePageContent: string;
  pageContentShared: string;
  currentTab: string;
  welcomeMessage: string;
  inputPlaceholder: string;
  thinking: string;
  quoteSelection: string;
  stop: string;
  uploadImage: string;
  imageUploadHint: string;
  dragImageHere: string;
  imageTooLarge: string;
  imageCountLimit: string;
  imageOnlyFiles: string;
  removeImage: string;
  currentModelNoVision: string;
  noModelConfig: string;
  notConfigured: string;
  
  // 确认对话框
  confirmDeleteProvider: string;
  confirmDeleteSkill: string;
  confirmDeleteChat: string;
  confirmUntrustScript: string;
  
  // 错误提示
  fillRequired: string;
  addAtLeastOneModel: string;
  fetchModelsFailed: string;
  
  // 工具状态
  extractingPage: string;
  activatingSkill: string;
  executingScript: string;
  readingFile: string;
  
  // 消息操作
  editMessage: string;
  copyMessage: string;
  copy: string;
  copied: string;
  send: string;
}

// 英文翻译
const en: Translations = {
  // 通用
  save: 'Save',
  cancel: 'Cancel',
  delete: 'Delete',
  confirm: 'Confirm',
  loading: 'Loading...',
  
  // 导航
  navModels: 'Models',
  navSkills: 'Skills',
  navMcp: 'MCP',
  navSettings: 'Settings',
  
  // 模型配置
  modelConfig: 'Model Configuration',
  modelConfigDesc: 'Manage AI providers and models',
  providerList: 'Providers',
  addProvider: 'Add Provider',
  editProvider: 'Edit Provider',
  providerName: 'Provider Name',
  providerNamePlaceholder: 'e.g. OpenAI, DeepSeek',
  baseUrl: 'Base URL',
  baseUrlPlaceholder: 'https://api.openai.com',
  baseUrlHint: 'Defaults to auto-completing /v1. If the URL ends with "/", SDK keeps it as-is and appends endpoint paths directly.',
  apiKey: 'API Key',
  apiKeyPlaceholder: 'sk-...',
  apiMode: 'API Mode',
  apiModeDesc: 'Choose request endpoint. Auto tries Responses first and falls back to Chat Completions.',
  apiModeAuto: 'Auto (recommended)',
  apiModeChatCompletions: 'Chat Completions',
  apiModeResponses: 'Responses',
  modelList: 'Models',
  fetchModels: 'Fetch Models',
  fetchingModels: 'Fetching...',
  availableModels: 'Available Models (click to add)',
  clickToAdd: 'Click to add',
  customModelPlaceholder: 'Enter model name manually',
  add: 'Add',
  addedModels: 'Added Models',
  supportsVision: 'Vision support',
  supportsVisionDesc: 'Configure vision support for each model below. Only enabled models can upload images.',
  modelVision: 'Vision',
  modelVisionEnabled: 'Vision enabled',
  modelVisionDisabled: 'Text only',
  saveConfig: 'Save Configuration',
  saving: 'Saving...',
  noProviders: 'No providers configured',
  selectOrAddProvider: 'Select or add a provider',
  modelsCount: '{count} models',
  
  // Skills 管理
  skillsManagement: 'Skills Management',
  skillsManagementDesc: 'Import and manage Agent Skills to extend AI capabilities',
  installedSkills: 'Installed Skills',
  importSkill: 'Import Skill',
  imported: 'Imported',
  builtin: 'Built-in',
  compatibility: 'Compatibility:',
  scriptFiles: 'Script Files',
  referenceFiles: 'Reference Files',
  assetFiles: 'Asset Files',
  instructionsPreview: 'Instructions Preview',
  trusted: 'Trusted',
  needConfirm: 'Need Confirm',
  scriptHint: 'Scripts require user confirmation before execution. Trusted scripts will run automatically.',
  noSkills: 'No skills installed',
  selectSkillOrImport: 'Select a skill to view details, or import a new one',
  scriptsCount: '{count} scripts',
  
  // 导入 Modal
  importSkillTitle: 'Import Skill',
  importSkillDesc: 'Select a folder containing SKILL.md to import.',
  selectFolder: 'Click to select folder',
  importing: 'Importing...',
  skillFolderStructure: 'Skill Folder Structure',
  required: 'Required',
  optional: 'Optional',
  jsOnly: 'JS only',
  importSuccess: 'Import successful with warnings:',
  importWarnings: 'Import successful with warnings:',
  
  // 通用设置
  generalSettings: 'General Settings',
  generalSettingsDesc: 'Configure extension options',
  language: 'Language',
  languageDesc: 'Select the language for interface and AI responses',
  floatingBall: 'Floating Ball',
  floatingBallDesc: 'Show floating ball on the right side of pages for quick access',
  floatingBallEnabled: 'Enabled',
  floatingBallDisabled: 'Disabled',
  selectionQuote: 'Selection Quote',
  selectionQuoteDesc: 'Show quick action button when selecting text on pages',
  pageContentLimit: 'Max page content length',
  pageContentLimitDesc: 'Maximum number of characters extracted from current page',
  pageContentLimitHint: 'Used by page extraction tools to truncate long content',
  toolCallLimit: 'Max tool calls',
  toolCallLimitDesc: 'Maximum number of tool calls per request',
  toolCallLimitHint: 'Stop tool loop once the limit is reached',
  
  // 原始提取网站设置
  rawExtractSites: 'Raw Extract Sites',
  rawExtractSitesDesc: 'Sites in this list will bypass Readability algorithm and extract raw page content directly',
  rawExtractSitesPlaceholder: 'e.g. youtube.com',
  rawExtractSitesHint: 'Enter domain keywords, e.g. "youtube" will match youtube.com',
  addSite: 'Add',
  noSitesConfigured: 'No sites configured',
  
  // MCP 配置
  mcpConfig: 'MCP Configuration',
  mcpConfigDesc: 'Connect to MCP (Model Context Protocol) servers to extend AI capabilities',
  mcpServerList: 'MCP Servers',
  mcpAddServer: 'Add Server',
  mcpEditServer: 'Edit Server',
  mcpServerName: 'Server Name',
  mcpServerNamePlaceholder: 'e.g. My MCP Server',
  mcpServerUrl: 'Server URL',
  mcpServerUrlPlaceholder: 'http://localhost:3000/mcp',
  mcpServerUrlHint: 'HTTP endpoint of the MCP server (Streamable HTTP transport)',
  mcpServerDescription: 'Description',
  mcpServerDescriptionPlaceholder: 'Optional description',
  mcpServerStatus: 'Status',
  mcpEnabled: 'Enabled',
  mcpDisabled: 'Disabled',
  mcpNoServers: 'No MCP servers configured',
  mcpSelectOrAdd: 'Select a server to view details, or add a new one',
  mcpTestConnection: 'Test Connection',
  mcpTest: 'Test',
  mcpTesting: 'Testing...',
  mcpTestSuccess: 'Connection successful',
  mcpToolCount: '{count} tools available',
  mcpConfirmDelete: 'Are you sure you want to delete this MCP server?',
  mcpInvalidUrl: 'Please enter a valid URL',
  mcpEnterUrl: 'Please enter the server URL first',
  mcpAuthToken: 'Auth Token',
  mcpAuthTokenPlaceholder: 'Bearer token for authentication (optional)',
  mcpAuthTokenHint: 'If the MCP server requires authentication, enter the Bearer token here',
  mcpAuthType: 'Authentication',
  mcpAuthNone: 'None',
  mcpAuthBearer: 'Bearer Token',
  mcpAuthOAuth: 'OAuth 2.1',
  mcpOAuthHint: 'OAuth authentication will open a browser window for authorization when connecting. The token will be automatically managed.',
  
  // Sidepanel
  newChat: 'New Chat',
  history: 'History',
  settings: 'Settings',
  sharePageContent: 'Share page content',
  pageContentShared: 'Page content will be shared with AI',
  currentTab: 'Current tab',
  welcomeMessage: 'Welcome! How can I help you?',
  inputPlaceholder: 'Type your message...',
  thinking: 'Thinking...',
  quoteSelection: 'Quote selection',
  stop: 'Stop',
  uploadImage: 'Upload image',
  imageUploadHint: 'Drag image here, click upload, or paste directly',
  dragImageHere: 'Drop image to attach',
  imageTooLarge: 'Image is too large (max {sizeMB}MB)',
  imageCountLimit: 'You can attach up to {count} images per message',
  imageOnlyFiles: 'Only image files are supported',
  removeImage: 'Remove image',
  currentModelNoVision: 'The current model does not support vision. Please enable vision for this model in settings.',
  noModelConfig: 'Please configure an AI provider in settings first',
  notConfigured: 'Not configured',
  
  // 确认对话框
  confirmDeleteProvider: 'Are you sure you want to delete this provider?',
  confirmDeleteSkill: 'Are you sure you want to delete this skill?',
  confirmDeleteChat: 'Are you sure you want to delete this conversation?',
  confirmUntrustScript: 'Are you sure you want to untrust script "{name}"?',
  
  // 错误提示
  fillRequired: 'Please fill in provider name, Base URL and API Key',
  addAtLeastOneModel: 'Please add at least one model',
  fetchModelsFailed: 'Failed to fetch models',
  
  // 工具状态
  extractingPage: 'Extracting page content...',
  activatingSkill: 'Activating Skill: {name}...',
  executingScript: 'Executing script: {skill}/{script}...',
  readingFile: 'Reading file: {skill}/{file}...',
  
  // 消息操作
  editMessage: 'Edit message',
  copyMessage: 'Copy message',
  copy: 'Copy',
  copied: 'Copied!',
  send: 'Send',
};

// 简体中文翻译
const zhCN: Translations = {
  // 通用
  save: '保存',
  cancel: '取消',
  delete: '删除',
  confirm: '确定',
  loading: '加载中...',
  
  // 导航
  navModels: '模型配置',
  navSkills: 'Skills 管理',
  navMcp: 'MCP 配置',
  navSettings: '通用设置',
  
  // 模型配置
  modelConfig: '模型配置',
  modelConfigDesc: '管理 AI 服务商和模型',
  providerList: '服务商列表',
  addProvider: '添加服务商',
  editProvider: '编辑服务商',
  providerName: '服务商名称',
  providerNamePlaceholder: '例如：OpenAI, DeepSeek',
  baseUrl: 'Base URL',
  baseUrlPlaceholder: 'https://api.openai.com',
  baseUrlHint: '默认自动补全 /v1；若以 / 结尾则保持原样并直接拼接接口路径',
  apiKey: 'API Key',
  apiKeyPlaceholder: 'sk-...',
  apiMode: 'API 模式',
  apiModeDesc: '选择请求接口。自动模式会优先尝试 Responses，失败时回退到 Chat Completions。',
  apiModeAuto: '自动（推荐）',
  apiModeChatCompletions: 'Chat Completions',
  apiModeResponses: 'Responses',
  modelList: '模型列表',
  fetchModels: '获取可用模型',
  fetchingModels: '获取中...',
  availableModels: '可用模型（点击添加）',
  clickToAdd: '点击添加',
  customModelPlaceholder: '手动输入模型名称',
  add: '添加',
  addedModels: '已添加的模型',
  supportsVision: '视觉支持',
  supportsVisionDesc: '请为下方每个模型单独配置视觉支持。只有开启视觉的模型才可上传图片。',
  modelVision: '视觉',
  modelVisionEnabled: '支持视觉',
  modelVisionDisabled: '仅文本',
  saveConfig: '保存配置',
  saving: '保存中...',
  noProviders: '暂无服务商配置',
  selectOrAddProvider: '请选择或添加一个服务商',
  modelsCount: '{count} 个模型',
  
  // Skills 管理
  skillsManagement: 'Skills 管理',
  skillsManagementDesc: '导入和管理 Agent Skills，扩展 AI 能力',
  installedSkills: '已安装 Skills',
  importSkill: '导入 Skill',
  imported: '已导入',
  builtin: '内置',
  compatibility: '兼容性：',
  scriptFiles: '脚本文件',
  referenceFiles: '引用文件',
  assetFiles: '资源文件',
  instructionsPreview: '指令预览',
  trusted: '已信任',
  needConfirm: '需确认',
  scriptHint: '脚本执行前需要用户确认，已信任的脚本将自动执行',
  noSkills: '暂无已安装的 Skills',
  selectSkillOrImport: '选择一个 Skill 查看详情，或导入新的 Skill',
  scriptsCount: '{count} 个脚本',
  
  // 导入 Modal
  importSkillTitle: '导入 Skill',
  importSkillDesc: '选择包含 SKILL.md 的文件夹进行导入。',
  selectFolder: '点击选择文件夹',
  importing: '导入中...',
  skillFolderStructure: 'Skill 文件夹结构',
  required: '必需',
  optional: '可选',
  jsOnly: '仅 .js',
  importSuccess: '导入成功，但有以下警告：',
  importWarnings: '导入成功，但有以下警告：',
  
  // 通用设置
  generalSettings: '通用设置',
  generalSettingsDesc: '配置扩展的通用选项',
  language: '语言 / Language',
  languageDesc: '选择界面和 AI 回复的语言',
  floatingBall: '悬浮球',
  floatingBallDesc: '在页面右侧显示悬浮球，方便快速访问',
  floatingBallEnabled: '已启用',
  floatingBallDisabled: '已禁用',
  selectionQuote: '划词引用',
  selectionQuoteDesc: '选中页面文字时显示快捷操作按钮',
  pageContentLimit: '网页最大字数限制',
  pageContentLimitDesc: '提取当前网页内容时的最大字符数',
  pageContentLimitHint: '用于页面提取工具，超出后会自动截断',
  toolCallLimit: '工具调用最大次数',
  toolCallLimitDesc: '每次请求允许的工具调用上限',
  toolCallLimitHint: '达到上限后将停止工具循环',
  
  // 原始提取网站设置
  rawExtractSites: '原始提取网站',
  rawExtractSitesDesc: '列表中的网站将跳过 Readability 算法，直接提取页面原始内容',
  rawExtractSitesPlaceholder: '例如：youtube.com',
  rawExtractSitesHint: '输入域名关键词，如 "youtube" 将匹配 youtube.com',
  addSite: '添加',
  noSitesConfigured: '暂无配置',
  
  // MCP 配置
  mcpConfig: 'MCP 配置',
  mcpConfigDesc: '连接 MCP (Model Context Protocol) 服务器，扩展 AI 能力',
  mcpServerList: 'MCP 服务器',
  mcpAddServer: '添加服务器',
  mcpEditServer: '编辑服务器',
  mcpServerName: '服务器名称',
  mcpServerNamePlaceholder: '例如：我的 MCP 服务器',
  mcpServerUrl: '服务器地址',
  mcpServerUrlPlaceholder: 'http://localhost:3000/mcp',
  mcpServerUrlHint: 'MCP 服务器的 HTTP 端点地址（Streamable HTTP 传输）',
  mcpServerDescription: '描述',
  mcpServerDescriptionPlaceholder: '可选的描述信息',
  mcpServerStatus: '状态',
  mcpEnabled: '已启用',
  mcpDisabled: '已禁用',
  mcpNoServers: '暂无 MCP 服务器配置',
  mcpSelectOrAdd: '选择一个服务器查看详情，或添加新的服务器',
  mcpTestConnection: '测试连接',
  mcpTest: '测试',
  mcpTesting: '测试中...',
  mcpTestSuccess: '连接成功',
  mcpToolCount: '可用 {count} 个工具',
  mcpConfirmDelete: '确定删除这个 MCP 服务器吗？',
  mcpInvalidUrl: '请输入有效的 URL 地址',
  mcpEnterUrl: '请先输入服务器地址',
  mcpAuthToken: '认证 Token',
  mcpAuthTokenPlaceholder: '用于认证的 Bearer Token（可选）',
  mcpAuthTokenHint: '如果 MCP 服务器需要认证，请在此输入 Bearer Token',
  mcpAuthType: '认证方式',
  mcpAuthNone: '无需认证',
  mcpAuthBearer: 'Bearer Token',
  mcpAuthOAuth: 'OAuth 2.1',
  mcpOAuthHint: 'OAuth 认证将在连接时打开浏览器窗口进行授权，Token 将自动管理。',
  
  // Sidepanel
  newChat: '新建对话',
  history: '历史对话',
  settings: '设置',
  sharePageContent: '分享当前页面内容',
  pageContentShared: '页面内容将与 AI 共享',
  currentTab: '当前标签页',
  welcomeMessage: '欢迎使用，有什么可以帮您？',
  inputPlaceholder: '输入您的消息...',
  thinking: '思考中...',
  quoteSelection: '引用选中文本',
  stop: '终止',
  uploadImage: '上传图片',
  imageUploadHint: '拖拽图片到此处，或点击上传，也可直接粘贴',
  dragImageHere: '松开以上传图片',
  imageTooLarge: '图片过大（最大 {sizeMB}MB）',
  imageCountLimit: '每条消息最多上传 {count} 张图片',
  imageOnlyFiles: '仅支持图片文件',
  removeImage: '移除图片',
  currentModelNoVision: '当前模型未开启视觉支持，请在设置中为该模型开启后再上传图片',
  noModelConfig: '请先在设置中配置 AI 服务商',
  notConfigured: '未配置',
  
  // 确认对话框
  confirmDeleteProvider: '确定删除这个服务商吗？',
  confirmDeleteSkill: '确定删除这个 Skill 吗？',
  confirmDeleteChat: '确定删除这个对话吗？',
  confirmUntrustScript: '确定取消信任脚本 "{name}" 吗？',
  
  // 错误提示
  fillRequired: '请填写服务商名称、Base URL 和 API Key',
  addAtLeastOneModel: '请至少添加一个模型',
  fetchModelsFailed: '获取模型列表失败',
  
  // 工具状态
  extractingPage: '正在提取网页内容...',
  activatingSkill: '正在激活 Skill: {name}...',
  executingScript: '正在执行脚本: {skill}/{script}...',
  readingFile: '正在读取文件: {skill}/{file}...',
  
  // 消息操作
  editMessage: '编辑消息',
  copyMessage: '复制消息',
  copy: '复制',
  copied: '已复制！',
  send: '发送',
};

// 翻译映射
const translations: Record<Language, Translations> = {
  'en': en,
  'zh-CN': zhCN,
};

// 获取翻译文本
export function t(lang: Language, key: keyof Translations, params?: Record<string, string | number>): string {
  let text = translations[lang][key] || translations['en'][key] || key;
  
  // 替换参数
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      text = text.replace(`{${k}}`, String(v));
    });
  }
  
  return text;
}

// 获取所有翻译
export function getTranslations(lang: Language): Translations {
  return translations[lang] || translations['en'];
}
