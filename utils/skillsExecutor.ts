/**
 * Skills 执行器 - 处理 Skill 脚本执行
 * 
 * 通过 background script 使用 chrome.userScripts API 执行脚本
 * 绕过 CSP 限制，脚本在页面主世界中运行
 */

import type { Skill, SkillScript } from './db';
import { getSkillFileAsText } from './db';
import { isScriptTrusted, trustScript } from './storage';

export interface ScriptExecutionRequest {
  skill: Skill;
  script: SkillScript;
  tabId?: number;
  arguments?: Record<string, any>;
}

export interface ScriptExecutionResult {
  success: boolean;
  output?: any;
  error?: string;
  executedAt: number;
}

export interface ScriptConfirmationRequest {
  skillId: string;
  skillName: string;
  scriptName: string;
  scriptContent: string;
}

export type ScriptConfirmCallback = (
  request: ScriptConfirmationRequest
) => Promise<{ confirmed: boolean; trustForever: boolean }>;

let confirmCallback: ScriptConfirmCallback | null = null;

export function setScriptConfirmCallback(callback: ScriptConfirmCallback): void {
  confirmCallback = callback;
}

async function getActiveTabId(): Promise<number | undefined> {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  return tabs[0]?.id;
}

async function getScriptContent(skill: Skill, script: SkillScript): Promise<string> {
  const content = await getSkillFileAsText(skill.id, script.path);
  return content || '';
}

function generateScriptId(skillId: string, scriptName: string): string {
  return `skill_${skillId}_${scriptName}`.replace(/[^a-zA-Z0-9_]/g, '_');
}

export async function executeScript(
  request: ScriptExecutionRequest
): Promise<ScriptExecutionResult> {
  const { skill, script, tabId } = request;
  
  if (script.language !== 'javascript') {
    return {
      success: false,
      error: `不支持的脚本语言: ${script.language}，仅支持 JavaScript`,
      executedAt: Date.now(),
    };
  }
  
  const trusted = await isScriptTrusted(skill.id, script.name);
  
  if (!trusted) {
    if (!confirmCallback) {
      return {
        success: false,
        error: '脚本执行需要用户确认，但未设置确认回调',
        executedAt: Date.now(),
      };
    }
    
    const scriptContent = await getScriptContent(skill, script);
    
    const confirmation = await confirmCallback({
      skillId: skill.id,
      skillName: skill.metadata.name,
      scriptName: script.name,
      scriptContent,
    });
    
    if (!confirmation.confirmed) {
      return {
        success: false,
        error: '用户拒绝执行脚本',
        executedAt: Date.now(),
      };
    }
    
    if (confirmation.trustForever) {
      await trustScript(skill.id, script.name);
    }
  }
  
  try {
    const scriptContent = await getScriptContent(skill, script);
    const targetTabId = tabId ?? await getActiveTabId();
    
    if (!targetTabId) {
      return {
        success: false,
        error: '无法获取目标 Tab ID',
        executedAt: Date.now(),
      };
    }
    
    const scriptId = generateScriptId(skill.id, script.name);
    const result = await executeViaBackground(targetTabId, scriptContent, request.arguments || {}, scriptId);
    
    return {
      success: true,
      output: result,
      executedAt: Date.now(),
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : '脚本执行失败',
      executedAt: Date.now(),
    };
  }
}

// 通过 background script 执行脚本
async function executeViaBackground(
  tabId: number,
  code: string,
  args: Record<string, any>,
  scriptId: string
): Promise<any> {
  console.log('[skillsExecutor] 发送脚本到 background 执行, tabId:', tabId);
  
  const response = await browser.runtime.sendMessage({
    type: 'EXECUTE_SKILL_SCRIPT',
    tabId,
    code,
    args,
    scriptId,
  });
  
  if (response.success) {
    return response.result;
  } else {
    throw new Error(response.error || '脚本执行失败');
  }
}

export function validateScript(content: string): { valid: boolean; warnings: string[] } {
  const warnings: string[] = [];
  
  const dangerousPatterns = [
    { pattern: /eval\s*\(/, message: '使用了 eval()，可能存在安全风险' },
    { pattern: /Function\s*\(/, message: '使用了 Function 构造器，可能存在安全风险' },
    { pattern: /document\.cookie/, message: '尝试访问 cookie' },
    { pattern: /localStorage|sessionStorage/, message: '尝试访问本地存储' },
    { pattern: /chrome\.|browser\./, message: '尝试访问浏览器扩展 API' },
  ];
  
  for (const { pattern, message } of dangerousPatterns) {
    if (pattern.test(content)) {
      warnings.push(message);
    }
  }
  
  return { valid: true, warnings };
}
