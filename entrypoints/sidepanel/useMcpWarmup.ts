import type { McpTool } from '../../utils/mcp';

type McpManagerModule = typeof import('../../utils/mcp');
type McpStorageModule = typeof import('../../utils/mcpStorage');

export interface McpWarmupCallbacks {
  onConnectingChange?: (connecting: boolean) => void;
  onToolsChange?: (tools: McpTool[]) => void;
}

async function loadMcpModules(): Promise<[McpManagerModule, McpStorageModule]> {
  return Promise.all([
    import('../../utils/mcp'),
    import('../../utils/mcpStorage'),
  ]);
}

export function createMcpWarmup(callbacks: McpWarmupCallbacks = {}) {
  let warmupPromise: Promise<McpTool[]> | null = null;

  const runWarmup = async (): Promise<McpTool[]> => {
    callbacks.onConnectingChange?.(true);
    callbacks.onToolsChange?.([]);

    try {
      const [mcpModule, mcpStorageModule] = await loadMcpModules();
      await mcpModule.mcpManager.disconnectAll();

      const enabledServers = await mcpStorageModule.getEnabledMcpServers();
      const allTools: McpTool[] = [];

      for (const server of enabledServers) {
        try {
          const tools = await mcpModule.mcpManager.connect(server);
          allTools.push(...tools);
          console.log(`[MCP] 已连接 ${server.name}，获取 ${tools.length} 个工具`);
        } catch (error) {
          console.error(`[MCP] 连接 ${server.name} 失败:`, error);
        }
      }

      callbacks.onToolsChange?.(allTools);
      return allTools;
    } finally {
      callbacks.onConnectingChange?.(false);
    }
  };

  return {
    prewarm(): Promise<McpTool[]> {
      if (!warmupPromise) {
        warmupPromise = runWarmup().finally(() => {
          warmupPromise = null;
        });
      }
      return warmupPromise;
    },
    async watchConfigChanges(onInvalidate: () => void | Promise<void>): Promise<() => void> {
      const [, mcpStorageModule] = await loadMcpModules();
      return mcpStorageModule.watchMcpServers(() => {
        void Promise.resolve(onInvalidate());
      });
    },
    async disconnectAll(): Promise<void> {
      const [mcpModule] = await loadMcpModules();
      callbacks.onToolsChange?.([]);
      await mcpModule.mcpManager.disconnectAll();
    },
  };
}
