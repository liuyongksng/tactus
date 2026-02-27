import { beforeEach, describe, expect, it } from 'vitest';
import {
  deleteMcpServer,
  getAllMcpServers,
  saveMcpServer,
  toggleMcpServer,
  type McpServerConfig,
} from '../../utils/mcpStorage';

function createServer(id: string, enabled: boolean = true): McpServerConfig {
  return {
    id,
    name: `server-${id}`,
    url: `https://example.com/${id}`,
    enabled,
    authType: 'none',
  };
}

describe('mcpStorage 并发写入', () => {
  beforeEach(async () => {
    const existing = await getAllMcpServers();
    await Promise.all(existing.map(server => deleteMcpServer(server.id)));
  });

  it('并发 saveMcpServer 不应丢失任一服务配置', async () => {
    await Promise.all([
      saveMcpServer(createServer('mcp-a')),
      saveMcpServer(createServer('mcp-b')),
    ]);

    const servers = await getAllMcpServers();
    const ids = servers.map(server => server.id).sort();
    expect(ids).toEqual(['mcp-a', 'mcp-b']);
  });

  it('并发 toggleMcpServer 与 deleteMcpServer 后状态应一致', async () => {
    await saveMcpServer(createServer('mcp-a', false));
    await saveMcpServer(createServer('mcp-b', false));

    await Promise.all([
      toggleMcpServer('mcp-a', true),
      deleteMcpServer('mcp-b'),
    ]);

    const servers = await getAllMcpServers();
    expect(servers).toHaveLength(1);
    expect(servers[0]).toMatchObject({ id: 'mcp-a', enabled: true });
  });
});
