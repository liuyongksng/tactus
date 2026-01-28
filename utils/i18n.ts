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
  apiKey: string;
  apiKeyPlaceholder: string;
  modelList: string;
  fetchModels: string;
  fetchingModels: string;
  availableModels: string;
  clickToAdd: string;
  customModelPlaceholder: string;
  add: string;
  addedModels: string;
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
  
  // Sidepanel
  newChat: string;
  history: string;
  settings: string;
  sharePageContent: string;
  pageContentShared: string;
  welcomeMessage: string;
  inputPlaceholder: string;
  thinking: string;
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
  apiKey: 'API Key',
  apiKeyPlaceholder: 'sk-...',
  modelList: 'Models',
  fetchModels: 'Fetch Models',
  fetchingModels: 'Fetching...',
  availableModels: 'Available Models (click to add)',
  clickToAdd: 'Click to add',
  customModelPlaceholder: 'Enter model name manually',
  add: 'Add',
  addedModels: 'Added Models',
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
  
  // Sidepanel
  newChat: 'New Chat',
  history: 'History',
  settings: 'Settings',
  sharePageContent: 'Share page content',
  pageContentShared: 'Page content will be shared with AI',
  welcomeMessage: 'Welcome! How can I help you?',
  inputPlaceholder: 'Type your message...',
  thinking: 'Thinking...',
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
  apiKey: 'API Key',
  apiKeyPlaceholder: 'sk-...',
  modelList: '模型列表',
  fetchModels: '获取可用模型',
  fetchingModels: '获取中...',
  availableModels: '可用模型（点击添加）',
  clickToAdd: '点击添加',
  customModelPlaceholder: '手动输入模型名称',
  add: '添加',
  addedModels: '已添加的模型',
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
  
  // Sidepanel
  newChat: '新建对话',
  history: '历史对话',
  settings: '设置',
  sharePageContent: '分享当前页面内容',
  pageContentShared: '页面内容将与 AI 共享',
  welcomeMessage: '欢迎使用，有什么可以帮您？',
  inputPlaceholder: '输入您的消息...',
  thinking: '思考中...',
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
