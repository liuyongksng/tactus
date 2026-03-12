import { beforeEach, describe, expect, it, vi } from 'vitest';

const mcpWarmupMocks = vi.hoisted(() => ({
  disconnectAll: vi.fn(),
  connect: vi.fn(),
  getEnabledMcpServers: vi.fn(),
  watchMcpServers: vi.fn(),
}));

vi.mock('../../utils/mcp', () => ({
  mcpManager: {
    disconnectAll: mcpWarmupMocks.disconnectAll,
    connect: mcpWarmupMocks.connect,
  },
}));

vi.mock('../../utils/mcpStorage', () => ({
  getEnabledMcpServers: mcpWarmupMocks.getEnabledMcpServers,
  watchMcpServers: mcpWarmupMocks.watchMcpServers,
}));

import { createMcpWarmup } from '../../entrypoints/sidepanel/useMcpWarmup';

describe('sidepanel MCP warmup', () => {
  beforeEach(() => {
    mcpWarmupMocks.disconnectAll.mockReset();
    mcpWarmupMocks.connect.mockReset();
    mcpWarmupMocks.getEnabledMcpServers.mockReset();
    mcpWarmupMocks.watchMcpServers.mockReset();
  });

  it('应预热已启用 MCP 服务并回调连接状态与工具列表', async () => {
    mcpWarmupMocks.getEnabledMcpServers.mockResolvedValue([
      { id: 'server-a', name: 'Server A' },
      { id: 'server-b', name: 'Server B' },
    ]);
    mcpWarmupMocks.connect
      .mockResolvedValueOnce([{
        serverId: 'server-a',
        serverName: 'Server A',
        name: 'tool-a',
        inputSchema: { type: 'object' },
      }])
      .mockResolvedValueOnce([{
        serverId: 'server-b',
        serverName: 'Server B',
        name: 'tool-b',
        inputSchema: { type: 'object' },
      }]);

    const connectingStates: boolean[] = [];
    const toolSnapshots: Array<Array<{ serverId: string; serverName: string; name: string }>> = [];
    const warmup = createMcpWarmup({
      onConnectingChange: (connecting) => {
        connectingStates.push(connecting);
      },
      onToolsChange: (tools) => {
        toolSnapshots.push(
          tools.map(tool => ({
            serverId: tool.serverId,
            serverName: tool.serverName,
            name: tool.name,
          })),
        );
      },
    });

    const tools = await warmup.prewarm();

    expect(mcpWarmupMocks.disconnectAll).toHaveBeenCalledTimes(1);
    expect(mcpWarmupMocks.connect).toHaveBeenCalledTimes(2);
    expect(tools).toEqual([
      {
        serverId: 'server-a',
        serverName: 'Server A',
        name: 'tool-a',
        inputSchema: { type: 'object' },
      },
      {
        serverId: 'server-b',
        serverName: 'Server B',
        name: 'tool-b',
        inputSchema: { type: 'object' },
      },
    ]);
    expect(connectingStates).toEqual([true, false]);
    expect(toolSnapshots).toEqual([
      [],
      [
        { serverId: 'server-a', serverName: 'Server A', name: 'tool-a' },
        { serverId: 'server-b', serverName: 'Server B', name: 'tool-b' },
      ],
    ]);
  });

  it('配置变更监听应透传并触发失效回调', async () => {
    const stopWatching = vi.fn();
    let capturedListener: (() => void) | undefined;
    mcpWarmupMocks.watchMcpServers.mockImplementation((listener: () => void) => {
      capturedListener = listener;
      return stopWatching;
    });

    const invalidate = vi.fn();
    const warmup = createMcpWarmup();
    const unwatch = await warmup.watchConfigChanges(invalidate);

    capturedListener?.();
    await Promise.resolve();

    expect(invalidate).toHaveBeenCalledTimes(1);
    unwatch();
    expect(stopWatching).toHaveBeenCalledTimes(1);
  });
});
