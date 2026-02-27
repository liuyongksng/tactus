/**
 * MCP Server 配置存储
 * 使用 WXT Storage 实现跨页面同步
 */

import { storage } from '@wxt-dev/storage';
import type { McpServerConfig, McpAuthType } from './mcp';
import { createMutationGate } from './storageLock';

export type { McpServerConfig, McpAuthType };

// ==================== Storage Items ====================

const mcpServersStorage = storage.defineItem<McpServerConfig[]>('local:mcpServers', {
  fallback: [],
});

const runMcpServersMutation = createMutationGate('mcp-servers');

// ==================== CRUD 操作 ====================

/**
 * 获取所有 MCP Server 配置
 */
export async function getAllMcpServers(): Promise<McpServerConfig[]> {
  return await mcpServersStorage.getValue();
}

/**
 * 获取所有启用的 MCP Server 配置
 */
export async function getEnabledMcpServers(): Promise<McpServerConfig[]> {
  const servers = await mcpServersStorage.getValue();
  return servers.filter(s => s.enabled);
}

/**
 * 获取单个 MCP Server 配置
 */
export async function getMcpServer(id: string): Promise<McpServerConfig | undefined> {
  const servers = await mcpServersStorage.getValue();
  return servers.find(s => s.id === id);
}

/**
 * 保存 MCP Server 配置（新增或更新）
 */
export async function saveMcpServer(server: McpServerConfig): Promise<void> {
  await runMcpServersMutation(async () => {
    const servers = await mcpServersStorage.getValue();
    const index = servers.findIndex(s => s.id === server.id);
    const nextServers = [...servers];
    if (index >= 0) {
      nextServers[index] = server;
    } else {
      nextServers.push(server);
    }
    await mcpServersStorage.setValue(nextServers);
  });
}

/**
 * 删除 MCP Server 配置
 */
export async function deleteMcpServer(id: string): Promise<void> {
  await runMcpServersMutation(async () => {
    const servers = await mcpServersStorage.getValue();
    await mcpServersStorage.setValue(servers.filter(s => s.id !== id));
  });
}

/**
 * 切换 MCP Server 启用状态
 */
export async function toggleMcpServer(id: string, enabled: boolean): Promise<void> {
  await runMcpServersMutation(async () => {
    const servers = await mcpServersStorage.getValue();
    const index = servers.findIndex(s => s.id === id);
    if (index < 0) return;
    const nextServers = [...servers];
    nextServers[index] = { ...servers[index], enabled };
    await mcpServersStorage.setValue(nextServers);
  });
}

/**
 * 生成新的 Server ID
 */
export function generateMcpServerId(): string {
  return `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ==================== Watch ====================

/**
 * 监听 MCP Server 配置变化
 */
export function watchMcpServers(callback: (servers: McpServerConfig[]) => void): () => void {
  return mcpServersStorage.watch((newValue) => {
    callback(newValue);
  });
}
