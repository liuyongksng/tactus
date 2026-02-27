import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  saveSkillWithFilesMock,
  getSkillByNameMock,
  parseSkillMdMock,
  generateSkillIdMock,
} = vi.hoisted(() => ({
  saveSkillWithFilesMock: vi.fn(),
  getSkillByNameMock: vi.fn(),
  parseSkillMdMock: vi.fn(),
  generateSkillIdMock: vi.fn(),
}));

vi.mock('../../utils/skills', () => ({
  parseSkillMd: parseSkillMdMock,
  generateSkillId: generateSkillIdMock,
  saveSkillWithFiles: saveSkillWithFilesMock,
  getSkillByName: getSkillByNameMock,
}));

vi.mock('../../utils/skillsExecutor', () => ({
  validateScript: vi.fn(() => ({ warnings: [] })),
}));

import { importSkillFromFolder } from '../../utils/skillsImporter';

function createFolderFile(path: string, content: string): File {
  const name = path.split('/').at(-1) ?? path;
  const file = new File([content], name, { type: 'text/plain' });
  Object.defineProperty(file, 'webkitRelativePath', {
    value: path,
    configurable: true,
  });
  return file;
}

function toFileList(files: File[]): FileList {
  return {
    length: files.length,
    item: (index: number) => files[index] ?? null,
    [Symbol.iterator]: function* iterator() {
      yield* files;
    },
  } as unknown as FileList;
}

describe('importSkillFromFolder 原子保存', () => {
  beforeEach(() => {
    saveSkillWithFilesMock.mockReset();
    getSkillByNameMock.mockReset();
    parseSkillMdMock.mockReset();
    generateSkillIdMock.mockReset();

    getSkillByNameMock.mockResolvedValue(null);
    generateSkillIdMock.mockReturnValue('skill-demo');
    parseSkillMdMock.mockReturnValue({
      metadata: {
        name: 'demo-skill',
        description: 'demo description',
      },
      instructions: 'do something',
    });
    saveSkillWithFilesMock.mockResolvedValue(undefined);
  });

  it('应一次性提交 Skill 元数据和全部文件', async () => {
    const files = toFileList([
      createFolderFile('demo-skill/SKILL.md', '# mock'),
      createFolderFile('demo-skill/scripts/main.js', 'console.log("ok");'),
      createFolderFile('demo-skill/references/readme.txt', 'hello'),
    ]);

    const result = await importSkillFromFolder(files);

    expect(result.success).toBe(true);
    expect(saveSkillWithFilesMock).toHaveBeenCalledTimes(1);
    const [skill, skillFiles] = saveSkillWithFilesMock.mock.calls[0] as [any, Array<{ path: string }>];
    expect(skill.id).toBe('skill-demo');
    expect(skillFiles.map(file => file.path).sort()).toEqual([
      'SKILL.md',
      'references/readme.txt',
      'scripts/main.js',
    ]);
  });

  it('应在原子保存失败时返回失败并透传错误', async () => {
    saveSkillWithFilesMock.mockRejectedValueOnce(new Error('atomic write failed'));
    const files = toFileList([
      createFolderFile('demo-skill/SKILL.md', '# mock'),
      createFolderFile('demo-skill/scripts/main.js', 'console.log("ok");'),
    ]);

    const result = await importSkillFromFolder(files);

    expect(result).toMatchObject({
      success: false,
      error: 'atomic write failed',
    });
  });
});
