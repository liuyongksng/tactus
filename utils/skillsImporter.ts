/**
 * Skills 导入器 - 处理 Skill 文件夹的导入
 * 支持通过 webkitdirectory 上传整个文件夹
 */

import {
  type Skill,
  type SkillScript,
  type SkillResource,
  type SkillFile,
  parseSkillMd,
  generateSkillId,
  saveSkill,
  saveSkillFile,
  getSkillByName,
} from './skills';
import { validateScript } from './skillsExecutor';

export interface ImportResult {
  success: boolean;
  skill?: Skill;
  error?: string;
  warnings?: string[];
}

// MIME 类型映射
const MIME_TYPES: Record<string, string> = {
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.js': 'application/javascript',
  '.ts': 'application/typescript',
  '.json': 'application/json',
  '.html': 'text/html',
  '.css': 'text/css',
  '.xml': 'application/xml',
  '.yaml': 'application/x-yaml',
  '.yml': 'application/x-yaml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
};

// 文本文件扩展名
const TEXT_EXTENSIONS = new Set([
  '.md', '.txt', '.js', '.ts', '.json', '.html', '.css', 
  '.xml', '.yaml', '.yml', '.svg', '.csv', '.log',
]);

function getMimeType(filename: string): string {
  const ext = filename.substring(filename.lastIndexOf('.')).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

function isTextFile(filename: string): boolean {
  const ext = filename.substring(filename.lastIndexOf('.')).toLowerCase();
  return TEXT_EXTENSIONS.has(ext);
}

/**
 * 从文件夹导入 Skill
 * 使用 <input type="file" webkitdirectory> 获取的 FileList
 */
export async function importSkillFromFolder(files: FileList): Promise<ImportResult> {
  try {
    const fileMap = new Map<string, File>();
    
    // 构建文件映射，使用相对路径
    for (const file of files) {
      const path = (file as any).webkitRelativePath || file.name;
      fileMap.set(path, file);
    }
    
    // 查找 SKILL.md
    let skillMdFile: File | null = null;
    let basePath = '';
    
    for (const [path, file] of fileMap) {
      if (path.endsWith('SKILL.md')) {
        skillMdFile = file;
        // 获取基础路径（SKILL.md 所在目录）
        const lastSlash = path.lastIndexOf('/');
        basePath = lastSlash > 0 ? path.substring(0, lastSlash + 1) : '';
        break;
      }
    }
    
    if (!skillMdFile) {
      return { success: false, error: '未找到 SKILL.md 文件' };
    }
    
    // 解析 SKILL.md
    const skillMdContent = await skillMdFile.text();
    const { metadata, instructions } = parseSkillMd(skillMdContent);
    
    // 检查是否已存在同名 Skill
    const existing = await getSkillByName(metadata.name);
    if (existing) {
      return { success: false, error: `已存在同名 Skill: ${metadata.name}` };
    }
    
    // 生成 Skill ID
    const skillId = generateSkillId(metadata.name);
    
    // 收集文件信息
    const scripts: SkillScript[] = [];
    const references: SkillResource[] = [];
    const assets: SkillResource[] = [];
    const warnings: string[] = [];
    const filesToSave: { path: string; file: File }[] = [];
    
    for (const [fullPath, file] of fileMap) {
      // 计算相对于 SKILL.md 的路径
      let relativePath = fullPath;
      if (basePath && fullPath.startsWith(basePath)) {
        relativePath = fullPath.substring(basePath.length);
      }
      
      // 跳过 SKILL.md 本身（已经解析过了）
      if (relativePath === 'SKILL.md') continue;
      
      // 处理 scripts 目录
      if (relativePath.startsWith('scripts/')) {
        const scriptName = relativePath.substring('scripts/'.length);
        
        // 只允许 JavaScript 文件作为可执行脚本
        if (scriptName.endsWith('.js')) {
          const content = await file.text();
          const validation = validateScript(content);
          
          if (validation.warnings.length > 0) {
            warnings.push(`脚本 ${scriptName} 存在安全警告: ${validation.warnings.join(', ')}`);
          }
          
          scripts.push({
            name: scriptName,
            path: relativePath,
            language: 'javascript',
            trusted: false,
          });
        }
        
        // 所有 scripts 目录下的文件都保存
        filesToSave.push({ path: relativePath, file });
      }
      // 处理 references 目录
      else if (relativePath.startsWith('references/')) {
        const refName = relativePath.substring('references/'.length);
        references.push({
          name: refName,
          path: relativePath,
          type: 'reference',
        });
        filesToSave.push({ path: relativePath, file });
      }
      // 处理 assets 目录
      else if (relativePath.startsWith('assets/')) {
        const assetName = relativePath.substring('assets/'.length);
        assets.push({
          name: assetName,
          path: relativePath,
          type: 'asset',
        });
        filesToSave.push({ path: relativePath, file });
      }
      // 其他文件也保存（保持目录结构）
      else {
        filesToSave.push({ path: relativePath, file });
      }
    }
    
    // 创建 Skill 对象
    const skill: Skill = {
      id: skillId,
      metadata,
      instructions,
      scripts,
      references,
      assets,
      source: 'imported',
      importedAt: Date.now(),
      location: basePath || 'folder',
    };
    
    // 保存 Skill 元数据
    await saveSkill(skill);
    
    // 保存 SKILL.md 文件
    const skillMdBuffer = await skillMdFile.arrayBuffer();
    await saveSkillFile({
      skillId,
      path: 'SKILL.md',
      content: skillMdBuffer,
      mimeType: 'text/markdown',
      size: skillMdBuffer.byteLength,
      isText: true,
    });
    
    // 保存所有其他文件
    for (const { path, file } of filesToSave) {
      const content = await file.arrayBuffer();
      const skillFile: SkillFile = {
        skillId,
        path,
        content,
        mimeType: getMimeType(file.name),
        size: content.byteLength,
        isText: isTextFile(file.name),
      };
      await saveSkillFile(skillFile);
    }
    
    return {
      success: true,
      skill,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : '导入失败',
    };
  }
}

/**
 * 获取 Skill 的目录树结构
 */
export async function getSkillFileTree(skillId: string): Promise<FileTreeNode> {
  const { getSkillFiles } = await import('./db');
  const files = await getSkillFiles(skillId);
  
  const root: FileTreeNode = {
    name: '/',
    type: 'directory',
    children: [],
  };
  
  for (const file of files) {
    const parts = file.path.split('/');
    let current = root;
    
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      
      if (isLast) {
        // 文件节点
        current.children!.push({
          name: part,
          type: 'file',
          path: file.path,
          size: file.size,
          mimeType: file.mimeType,
        });
      } else {
        // 目录节点
        let dir = current.children!.find(c => c.name === part && c.type === 'directory');
        if (!dir) {
          dir = {
            name: part,
            type: 'directory',
            children: [],
          };
          current.children!.push(dir);
        }
        current = dir;
      }
    }
  }
  
  return root;
}

export interface FileTreeNode {
  name: string;
  type: 'file' | 'directory';
  path?: string;
  size?: number;
  mimeType?: string;
  children?: FileTreeNode[];
}
