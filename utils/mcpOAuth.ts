/**
 * MCP OAuth 2.1 认证模块
 * 为浏览器扩展环境适配 OAuth 流程
 */

import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import { exchangeAuthorization, discoverOAuthMetadata } from '@modelcontextprotocol/sdk/client/auth.js';
import type { OAuthTokens, OAuthClientInformationMixed, OAuthClientMetadata } from '@modelcontextprotocol/sdk/shared/auth.js';
import { storage } from '@wxt-dev/storage';

// ==================== 类型定义 ====================

export interface McpOAuthData {
  tokens?: OAuthTokens;
  clientInfo?: OAuthClientInformationMixed;
  codeVerifier?: string;
}

// ==================== Storage ====================

function getOAuthStorageKey(serverId: string): `local:${string}` {
  return `local:mcpOAuth_${serverId}`;
}

async function getOAuthData(serverId: string): Promise<McpOAuthData> {
  const key = getOAuthStorageKey(serverId);
  const item = storage.defineItem<McpOAuthData>(key, { fallback: {} });
  return await item.getValue();
}

async function setOAuthData(serverId: string, data: McpOAuthData): Promise<void> {
  const key = getOAuthStorageKey(serverId);
  const item = storage.defineItem<McpOAuthData>(key, { fallback: {} });
  await item.setValue(data);
}

export async function clearOAuthData(serverId: string): Promise<void> {
  const key = getOAuthStorageKey(serverId);
  const item = storage.defineItem<McpOAuthData>(key, { fallback: {} });
  await item.setValue({});
}

// ==================== OAuth Provider ====================

/**
 * 创建适用于浏览器扩展的 OAuth Provider
 */
export function createExtensionOAuthProvider(serverId: string, serverUrl: string): OAuthClientProvider {
  let pendingState: string | undefined;
  let pendingCodeVerifier: string | undefined;
  
  // 获取扩展的 redirect URL
  const redirectUrl = browser.identity.getRedirectURL();
  
  const provider: OAuthClientProvider = {
    /**
     * OAuth 回调 URL
     */
    get redirectUrl(): string | URL {
      return redirectUrl;
    },

    /**
     * OAuth 客户端元数据（用于动态客户端注册）
     */
    get clientMetadata(): OAuthClientMetadata {
      return {
        redirect_uris: [redirectUrl],
        client_name: 'Tactus Browser Extension',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none', // 公共客户端
      };
    },

    /**
     * 重定向到授权页面
     * 在扩展中，我们需要完成整个流程（包括 token 交换）
     */
    async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
      console.log('[MCP OAuth] 开始授权流程:', authorizationUrl.toString());
      
      try {
        // 使用扩展的 identity API 进行 OAuth
        const callbackUrl = await browser.identity.launchWebAuthFlow({
          url: authorizationUrl.toString(),
          interactive: true,
        });
        if (!callbackUrl) {
          throw new Error('未获取到 OAuth 回调地址');
        }
        
        console.log('[MCP OAuth] 授权回调:', callbackUrl);
        
        // 解析回调 URL
        const url = new URL(callbackUrl);
        const code = url.searchParams.get('code');
        const error = url.searchParams.get('error');
        const errorDescription = url.searchParams.get('error_description');
        
        if (error) {
          throw new Error(`OAuth 错误: ${error} - ${errorDescription || ''}`);
        }
        
        if (!code) {
          throw new Error('未获取到授权码');
        }
        
        console.log('[MCP OAuth] 获取到授权码，开始交换 token');
        
        // 获取客户端信息和 code verifier
        const clientInfo = await provider.clientInformation();
        const codeVerifier = await provider.codeVerifier();
        
        if (!clientInfo) {
          throw new Error('缺少客户端信息');
        }
        
        // 发现 OAuth 元数据
        const authServerUrl = new URL(serverUrl);
        authServerUrl.pathname = '';
        const metadata = await discoverOAuthMetadata(authServerUrl);
        
        // 交换 token
        const tokens = await exchangeAuthorization(
          authServerUrl,
          {
            metadata,
            clientInformation: clientInfo,
            authorizationCode: code,
            codeVerifier,
            redirectUri: redirectUrl,
          }
        );
        
        console.log('[MCP OAuth] Token 交换成功');
        
        // 保存 tokens
        await provider.saveTokens(tokens);
        
      } catch (error) {
        console.error('[MCP OAuth] 授权失败:', error);
        throw error;
      }
    },

    /**
     * 获取当前 tokens
     */
    async tokens(): Promise<OAuthTokens | undefined> {
      const data = await getOAuthData(serverId);
      
      if (!data.tokens?.access_token) {
        return undefined;
      }
      
      // 检查 token 是否过期（提前 60 秒）
      if (data.tokens.expires_in) {
        // expires_in 是相对时间，需要结合存储时间计算
        // 这里简化处理，假设 token 有效
      }
      
      return data.tokens;
    },

    /**
     * 保存 tokens
     */
    async saveTokens(tokens: OAuthTokens): Promise<void> {
      console.log('[MCP OAuth] 保存 tokens');
      const data = await getOAuthData(serverId);
      data.tokens = tokens;
      await setOAuthData(serverId, data);
    },

    /**
     * 获取客户端信息
     */
    async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
      const data = await getOAuthData(serverId);
      return data.clientInfo;
    },

    /**
     * 保存客户端信息
     */
    async saveClientInformation(clientInfo: OAuthClientInformationMixed): Promise<void> {
      console.log('[MCP OAuth] 保存客户端信息');
      const data = await getOAuthData(serverId);
      data.clientInfo = clientInfo;
      await setOAuthData(serverId, data);
    },

    /**
     * 生成 state 参数
     */
    async state(): Promise<string> {
      pendingState = crypto.randomUUID();
      return pendingState;
    },

    /**
     * 获取 PKCE code verifier
     */
    async codeVerifier(): Promise<string> {
      // 优先返回内存中的，否则从存储读取
      if (pendingCodeVerifier) {
        return pendingCodeVerifier;
      }
      const data = await getOAuthData(serverId);
      return data.codeVerifier || '';
    },

    /**
     * 保存 PKCE code verifier
     */
    async saveCodeVerifier(verifier: string): Promise<void> {
      pendingCodeVerifier = verifier;
      const data = await getOAuthData(serverId);
      data.codeVerifier = verifier;
      await setOAuthData(serverId, data);
    },

    /**
     * 清除所有凭证
     */
    async invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier'): Promise<void> {
      console.log('[MCP OAuth] 清除凭证:', scope);
      
      if (scope === 'all') {
        await clearOAuthData(serverId);
        pendingState = undefined;
        pendingCodeVerifier = undefined;
      } else {
        const data = await getOAuthData(serverId);
        if (scope === 'tokens') {
          delete data.tokens;
        } else if (scope === 'client') {
          delete data.clientInfo;
        } else if (scope === 'verifier') {
          delete data.codeVerifier;
          pendingCodeVerifier = undefined;
        }
        await setOAuthData(serverId, data);
      }
    },
  };
  
  return provider;
}

/**
 * 检查是否已有有效的 OAuth tokens
 */
export async function hasValidOAuthTokens(serverId: string): Promise<boolean> {
  const data = await getOAuthData(serverId);
  return !!data.tokens?.access_token;
}

/**
 * 获取 OAuth 状态信息
 */
export async function getOAuthStatus(serverId: string): Promise<{
  authenticated: boolean;
  hasClientInfo: boolean;
}> {
  const data = await getOAuthData(serverId);
  return {
    authenticated: !!data.tokens?.access_token,
    hasClientInfo: !!data.clientInfo?.client_id,
  };
}
