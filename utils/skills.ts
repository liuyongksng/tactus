/**
 * Agent Skills 系统 - 基于 Anthropic Agent Skills 规范
 * https://agentskills.io/specification
 */

export type {
  Skill,
  SkillMetadata,
  SkillScript,
  SkillResource,
  SkillFile,
} from './db';

export type { TrustedScript } from './storage';

export {
  // Skill CRUD
  getAllSkills,
  getSkill,
  getSkillByName,
  saveSkill,
  deleteSkill,
  
  // Skill Files
  saveSkillFile,
  getSkillFile,
  getSkillFiles,
  deleteSkillFile,
  getSkillFileAsText,
} from './db';

export {
  // Trusted Scripts (from WXT storage)
  isScriptTrusted,
  trustScript,
  untrustScript,
  getTrustedScripts,
} from './storage';

import type { SkillMetadata, Skill } from './db';

// 解析 SKILL.md 文件
export function parseSkillMd(content: string): { metadata: SkillMetadata; instructions: string } {
  // 统一换行符，处理 Windows (\r\n) 和 Unix (\n) 格式
  const normalizedContent = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;
  const match = normalizedContent.match(frontmatterRegex);
  
  if (!match) {
    throw new Error('Invalid SKILL.md format: missing YAML frontmatter');
  }
  
  const yamlContent = match[1];
  const instructions = match[2].trim();
  
  const metadata = parseYaml(yamlContent);
  
  if (!metadata.name || !metadata.description) {
    throw new Error('SKILL.md must have name and description fields');
  }
  
  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/.test(metadata.name)) {
    throw new Error('Invalid skill name format');
  }
  
  if (metadata.name.length > 64) {
    throw new Error('Skill name must be 64 characters or less');
  }
  
  if (metadata.description.length > 1024) {
    throw new Error('Skill description must be 1024 characters or less');
  }
  
  return { metadata, instructions };
}

// 简单的 YAML 解析器
function parseYaml(yaml: string): SkillMetadata {
  // 统一换行符，处理 Windows (\r\n) 和 Unix (\n) 格式
  const normalizedYaml = yaml.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalizedYaml.split('\n');
  const result: Record<string, any> = {};
  let currentKey = '';
  let multilineValue = '';
  let inMultiline = false;
  
  for (const line of lines) {
    if (inMultiline) {
      if (line.startsWith('  ') || line.trim() === '') {
        multilineValue += (multilineValue ? '\n' : '') + line.replace(/^  /, '');
        continue;
      } else {
        result[currentKey] = multilineValue.trim();
        inMultiline = false;
        multilineValue = '';
      }
    }
    
    const keyMatch = line.match(/^([a-z-]+):\s*(.*)$/i);
    if (keyMatch) {
      const [, key, value] = keyMatch;
      const normalizedKey = key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      
      if (value === '|' || value === '>') {
        currentKey = normalizedKey;
        inMultiline = true;
        multilineValue = '';
      } else if (value) {
        result[normalizedKey] = value.replace(/^["']|["']$/g, '');
      }
    }
  }
  
  if (inMultiline && multilineValue) {
    result[currentKey] = multilineValue.trim();
  }
  
  return result as SkillMetadata;
}

// 生成 Skill ID
export function generateSkillId(name: string): string {
  return `skill-${name}-${Date.now()}`;
}

// 生成 Skills 提示词（用于注入到系统提示中）
export function generateSkillsPrompt(skills: Skill[]): string {
  if (skills.length === 0) {
    return '';
  }
  
  const skillsXml = skills.map(skill => `  <skill>
    <name>${skill.metadata.name}</name>
    <description>${skill.metadata.description}</description>
  </skill>`).join('\n');
  
  return `<available_skills>
${skillsXml}
</available_skills>

当用户的任务匹配某个 skill 的描述时，你应该激活该 skill。
激活 skill 时，使用以下格式：

<skill_activation>
{"name": "skill名称"}
</skill_activation>

等待 skill 指令加载后，按照指令执行任务。`;
}

// 解析 LLM 输出中的 Skill 激活请求
export function parseSkillActivation(content: string): string | null {
  const regex = /<skill_activation>\s*([\s\S]*?)\s*<\/skill_activation>/;
  const match = content.match(regex);
  
  if (match) {
    try {
      const parsed = JSON.parse(match[1].trim());
      return parsed.name || null;
    } catch {
      return null;
    }
  }
  
  return null;
}

// 检查内容是否包含 Skill 激活请求
export function hasSkillActivation(content: string): boolean {
  return /<skill_activation>[\s\S]*?<\/skill_activation>/.test(content);
}
