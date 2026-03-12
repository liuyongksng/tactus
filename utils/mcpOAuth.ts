/**
 * MCP OAuth 2.1 认证模块
 * 为浏览器扩展环境适配 OAuth 流程
 */

import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import { exchangeAuthorization, discoverOAuthMetadata } from '@modelcontextprotocol/sdk/client/auth.js';
import type { OAuthTokens, OAuthClientInformationMixed, OAuthClientMetadata } from '@modelcontextprotocol/sdk/shared/auth.js';
import { storage } from '@wxt-dev/storage';

export interface McpOAuthData {
  tokens?: OAuthTokens;
  clientInfo?: OAuthClientInformationMixed;
  codeVerifier?: string;
}

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

export function createExtensionOAuthProvider(serverId: string, serverUrl: string): OAuthClientProvider {
  let pendingState: string | undefined;
  let pendingCodeVerifier: string | undefined;

  const redirectUrl = browser.identity.getRedirectURL();

  const provider: OAuthClientProvider = {
    get redirectUrl(): string {
      return redirectUrl;
    },

    get clientMetadata(): OAuthClientMetadata {
      return {
        redirect_uris: [redirectUrl],
        client_name: 'Tactus Browser Extension',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      };
    },

    async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
      console.log('[MCP OAuth] 开始授权流程:', authorizationUrl.toString());

      try {
        const callbackUrl = await browser.identity.launchWebAuthFlow({
          url: authorizationUrl.toString(),
          interactive: true,
        });

        if (!callbackUrl) {
          throw new Error('未获取到 OAuth 回调地址');
        }

        console.log('[MCP OAuth] 授权回调:', callbackUrl);

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

        const clientInfo = await provider.clientInformation();
        const codeVerifier = await provider.codeVerifier();

        if (!clientInfo) {
          throw new Error('缺少客户端信息');
        }

        const authServerUrl = new URL(serverUrl);
        authServerUrl.pathname = '';
        const metadata = await discoverOAuthMetadata(authServerUrl);

        const tokens = await exchangeAuthorization(authServerUrl, {
          metadata,
          clientInformation: clientInfo,
          authorizationCode: code,
          codeVerifier,
          redirectUri: redirectUrl,
        });

        console.log('[MCP OAuth] Token 交换成功');
        await provider.saveTokens(tokens);
      } catch (error) {
        console.error('[MCP OAuth] 授权失败:', error);
        throw error;
      }
    },

    async tokens(): Promise<OAuthTokens | undefined> {
      const data = await getOAuthData(serverId);
      if (!data.tokens?.access_token) {
        return undefined;
      }

      return data.tokens;
    },

    async saveTokens(tokens: OAuthTokens): Promise<void> {
      console.log('[MCP OAuth] 保存 tokens');
      const data = await getOAuthData(serverId);
      data.tokens = tokens;
      await setOAuthData(serverId, data);
    },

    async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
      const data = await getOAuthData(serverId);
      return data.clientInfo;
    },

    async saveClientInformation(clientInfo: OAuthClientInformationMixed): Promise<void> {
      console.log('[MCP OAuth] 保存客户端信息');
      const data = await getOAuthData(serverId);
      data.clientInfo = clientInfo;
      await setOAuthData(serverId, data);
    },

    async state(): Promise<string> {
      pendingState = crypto.randomUUID();
      return pendingState;
    },

    async codeVerifier(): Promise<string> {
      if (pendingCodeVerifier) {
        return pendingCodeVerifier;
      }

      const data = await getOAuthData(serverId);
      return data.codeVerifier || '';
    },

    async saveCodeVerifier(verifier: string): Promise<void> {
      pendingCodeVerifier = verifier;
      const data = await getOAuthData(serverId);
      data.codeVerifier = verifier;
      await setOAuthData(serverId, data);
    },

    async invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier'): Promise<void> {
      console.log('[MCP OAuth] 清除凭证:', scope);

      if (scope === 'all') {
        await clearOAuthData(serverId);
        pendingState = undefined;
        pendingCodeVerifier = undefined;
        return;
      }

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
    },
  };

  return provider;
}

export async function hasValidOAuthTokens(serverId: string): Promise<boolean> {
  const data = await getOAuthData(serverId);
  return !!data.tokens?.access_token;
}

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
