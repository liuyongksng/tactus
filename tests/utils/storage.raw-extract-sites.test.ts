import { beforeEach, describe, expect, it } from 'vitest';
import {
  addRawExtractSite,
  getRawExtractSites,
  removeRawExtractSite,
  setRawExtractSites,
} from '../../utils/storage';

describe('rawExtractSites 标准化', () => {
  beforeEach(async () => {
    await setRawExtractSites([]);
  });

  it('addRawExtractSite 应统一小写并去重', async () => {
    await addRawExtractSite(' YouTube.com ');
    await addRawExtractSite('youtube.com');

    expect(await getRawExtractSites()).toEqual(['youtube.com']);
  });

  it('removeRawExtractSite 应使用同样的标准化规则删除', async () => {
    await addRawExtractSite('YouTube.com');
    await addRawExtractSite('example.com');

    await removeRawExtractSite(' YOUTUBE.COM ');

    expect(await getRawExtractSites()).toEqual(['example.com']);
  });

  it('removeRawExtractSite 输入空白值时应保持原列表', async () => {
    await addRawExtractSite('example.com');
    await removeRawExtractSite('   ');

    expect(await getRawExtractSites()).toEqual(['example.com']);
  });

  it('removeRawExtractSite 应兼容历史大小写和空白站点数据', async () => {
    await setRawExtractSites([' YouTube.com ', 'example.com']);

    await removeRawExtractSite('youtube.COM');

    expect(await getRawExtractSites()).toEqual(['example.com']);
  });
});
