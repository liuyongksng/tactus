import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyFontSettings,
  DEFAULT_FONT_SETTINGS,
  getFontSettings,
  resolveFontFamily,
  setFontSettings,
  watchFontSettings,
} from '../../utils/storage';

describe('font settings storage', () => {
  beforeEach(async () => {
    await setFontSettings(DEFAULT_FONT_SETTINGS);
  });

  it('应返回默认字体设置', async () => {
    const settings = await getFontSettings();
    expect(settings).toEqual(DEFAULT_FONT_SETTINGS);
    expect(resolveFontFamily(settings)).toContain('Source Sans 3');
  });

  it('应在 custom 为空时回退到系统字体', () => {
    const family = resolveFontFamily({
      preset: 'custom',
      customFamily: '   ',
    });
    expect(family).toContain('Source Sans 3');
  });

  it('应保存并读取字体设置', async () => {
    await setFontSettings({
      preset: 'custom',
      customFamily: '"Inter", "PingFang SC", sans-serif',
    });

    const settings = await getFontSettings();
    expect(settings).toEqual({
      preset: 'custom',
      customFamily: '"Inter", "PingFang SC", sans-serif',
    });
    expect(resolveFontFamily(settings)).toBe('"Inter", "PingFang SC", sans-serif');
  });

  it('watchFontSettings 应在设置变化时触发', async () => {
    const values: Array<{ preset: string; customFamily: string }> = [];
    const unwatch = watchFontSettings((settings) => {
      values.push(settings);
    });

    await setFontSettings({
      preset: 'serif',
      customFamily: '',
    });

    unwatch();
    expect(values.length).toBeGreaterThan(0);
    expect(values[values.length - 1]).toEqual({
      preset: 'serif',
      customFamily: '',
    });
  });

  it('applyFontSettings 应写入字体 CSS 变量', () => {
    const cssVars: Record<string, string> = {};
    const target = {
      style: {
        setProperty: (name: string, value: string) => {
          cssVars[name] = value;
        },
      },
    } as unknown as HTMLElement;

    applyFontSettings(
      {
        preset: 'monospace',
        customFamily: '',
      },
      target,
    );

    expect(cssVars['--font-body']).toContain('IBM Plex Mono');
    expect(cssVars['--font-display']).toContain('IBM Plex Mono');
    expect(cssVars['--font-mono']).toContain('IBM Plex Mono');
  });
});
