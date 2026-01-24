<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import {
  getAllProviders,
  getActiveProvider,
  setActiveProviderId,
  saveProvider,
  deleteProvider,
  getTrustedScripts,
  untrustScript,
  getLanguage,
  setLanguage,
  type AIProvider,
  type TrustedScript,
  type Language,
} from '../../utils/storage';
import {
  getAllSkills,
  deleteSkill,
  type Skill,
} from '../../utils/db';
import { fetchModels } from '../../utils/api';
import { importSkillFromFolder } from '../../utils/skillsImporter';
import { t, type Translations } from '../../utils/i18n';

const activeNav = ref<'models' | 'skills' | 'settings'>('models');

// 语言设置
const currentLanguage = ref<Language>('en');

// 国际化辅助函数
const i18n = (key: keyof Translations, params?: Record<string, string | number>) => {
  return t(currentLanguage.value, key, params);
};

// 模型配置
const providers = ref<AIProvider[]>([]);
const activeProviderId = ref<string | null>(null);
const selectedProviderId = ref<string | null>(null);
const availableModels = ref<string[]>([]);
const isFetchingModels = ref(false);
const isSaving = ref(false);

const formName = ref('');
const formBaseUrl = ref('');
const formApiKey = ref('');
const formModels = ref<string[]>([]);
const formCustomModel = ref('');

const isNewProvider = computed(() => selectedProviderId.value === 'new');

// Skills 管理
const skills = ref<Skill[]>([]);
const trustedScripts = ref<TrustedScript[]>([]);
const selectedSkillId = ref<string | null>(null);
const isImporting = ref(false);
const importError = ref<string | null>(null);
const importWarnings = ref<string[]>([]);
const showImportModal = ref(false);

const selectedSkill = computed(() => skills.value.find(s => s.id === selectedSkillId.value) || null);
const skillTrustedScripts = computed(() => {
  if (!selectedSkill.value) return [];
  return trustedScripts.value.filter(t => t.skillId === selectedSkill.value!.id);
});

onMounted(async () => {
  providers.value = await getAllProviders();
  const active = await getActiveProvider();
  activeProviderId.value = active?.id || null;
  if (providers.value.length > 0) {
    selectProvider(activeProviderId.value || providers.value[0].id);
  }
  await loadSkills();
  // 加载语言设置
  currentLanguage.value = await getLanguage();
});

async function loadSkills() {
  skills.value = await getAllSkills();
  trustedScripts.value = await getTrustedScripts();
}

function selectProvider(id: string) {
  selectedProviderId.value = id;
  const provider = providers.value.find(p => p.id === id);
  if (provider) {
    formName.value = provider.name;
    formBaseUrl.value = provider.baseUrl;
    formApiKey.value = provider.apiKey;
    formModels.value = Array.isArray(provider.models) ? [...provider.models] : [];
    formCustomModel.value = '';
    availableModels.value = [];
  }
}

function addNewProvider() {
  selectedProviderId.value = 'new';
  formName.value = '';
  formBaseUrl.value = '';
  formApiKey.value = '';
  formModels.value = [];
  formCustomModel.value = '';
  availableModels.value = [];
}

async function fetchAvailableModels() {
  if (!formBaseUrl.value || !formApiKey.value) {
    alert(i18n('fillRequired'));
    return;
  }
  isFetchingModels.value = true;
  try {
    const models = await fetchModels(formBaseUrl.value, formApiKey.value);
    availableModels.value = models.map(m => m.id);
  } catch (e) {
    alert(i18n('fetchModelsFailed'));
  } finally {
    isFetchingModels.value = false;
  }
}

function addModel(model: string) {
  if (model && !formModels.value.includes(model)) formModels.value.push(model);
}

function addCustomModel() {
  const model = formCustomModel.value.trim();
  if (model) { addModel(model); formCustomModel.value = ''; }
}

function removeModel(model: string) {
  formModels.value = formModels.value.filter(m => m !== model);
}

async function saveCurrentProvider() {
  if (!formName.value || !formBaseUrl.value || !formApiKey.value) {
    alert(i18n('fillRequired'));
    return;
  }
  if (formModels.value.length === 0) {
    alert(i18n('addAtLeastOneModel'));
    return;
  }
  isSaving.value = true;
  try {
    const existingProvider = providers.value.find(p => p.id === selectedProviderId.value);
    const selectedModel = existingProvider?.selectedModel && formModels.value.includes(existingProvider.selectedModel)
      ? existingProvider.selectedModel : formModels.value[0];
    const provider: AIProvider = {
      id: isNewProvider.value ? crypto.randomUUID() : selectedProviderId.value!,
      name: formName.value,
      baseUrl: formBaseUrl.value,
      apiKey: formApiKey.value,
      models: [...formModels.value],
      selectedModel,
    };
    await saveProvider(provider);
    providers.value = await getAllProviders();
    if (!activeProviderId.value || isNewProvider.value) {
      activeProviderId.value = provider.id;
      await setActiveProviderId(provider.id);
    }
    selectedProviderId.value = provider.id;
  } finally {
    isSaving.value = false;
  }
}

async function removeProvider() {
  if (!selectedProviderId.value || isNewProvider.value) return;
  if (confirm(i18n('confirmDeleteProvider'))) {
    await deleteProvider(selectedProviderId.value);
    providers.value = await getAllProviders();
    if (activeProviderId.value === selectedProviderId.value) {
      activeProviderId.value = providers.value[0]?.id || null;
      await setActiveProviderId(activeProviderId.value);
    }
    if (providers.value.length > 0) selectProvider(providers.value[0].id);
    else selectedProviderId.value = null;
  }
}

function selectSkill(id: string) { selectedSkillId.value = id; }

function openImportModal() {
  showImportModal.value = true;
  importError.value = null;
  importWarnings.value = [];
}

function closeImportModal() {
  showImportModal.value = false;
  importError.value = null;
  importWarnings.value = [];
}

async function handleFolderImport(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = input.files;
  if (!files || files.length === 0) return;
  
  isImporting.value = true;
  importError.value = null;
  importWarnings.value = [];
  
  try {
    const result = await importSkillFromFolder(files);
    if (result.success) {
      await loadSkills();
      if (result.skill) selectedSkillId.value = result.skill.id;
      if (result.warnings) importWarnings.value = result.warnings;
      if (!result.warnings?.length) closeImportModal();
      // 通知其他页面 skills 已更新
      browser.runtime.sendMessage({ type: 'SKILLS_CHANGED', action: 'added' });
    } else {
      importError.value = result.error || '导入失败';
    }
  } catch (e) {
    importError.value = e instanceof Error ? e.message : 'Import failed';
  } finally {
    isImporting.value = false;
    input.value = '';
  }
}

async function removeSkill(id: string) {
  if (confirm(i18n('confirmDeleteSkill'))) {
    await deleteSkill(id);
    await loadSkills();
    if (selectedSkillId.value === id) selectedSkillId.value = skills.value[0]?.id || null;
    // 通知其他页面 skills 已更新
    browser.runtime.sendMessage({ type: 'SKILLS_CHANGED', action: 'deleted' });
  }
}

async function handleUntrustScript(skillId: string, scriptName: string) {
  if (confirm(i18n('confirmUntrustScript', { name: scriptName }))) {
    await untrustScript(skillId, scriptName);
    trustedScripts.value = await getTrustedScripts();
  }
}

function formatDate(timestamp: number): string {
  const locale = currentLanguage.value === 'zh-CN' ? 'zh-CN' : 'en-US';
  return new Date(timestamp).toLocaleDateString(locale, {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

// 语言切换
async function handleLanguageChange(lang: Language) {
  currentLanguage.value = lang;
  await setLanguage(lang);
}
</script>

<template>
  <div class="options-page">
    <nav class="nav-sidebar">
      <div class="nav-header"><h1>Tactus</h1></div>
      <div class="nav-menu">
        <div class="nav-item" :class="{ active: activeNav === 'models' }" @click="activeNav = 'models'">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
          </svg>
          <span>{{ i18n('navModels') }}</span>
        </div>
        <div class="nav-item" :class="{ active: activeNav === 'skills' }" @click="activeNav = 'skills'">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/>
          </svg>
          <span>{{ i18n('navSkills') }}</span>
        </div>
        <div class="nav-item" :class="{ active: activeNav === 'settings' }" @click="activeNav = 'settings'">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/>
          </svg>
          <span>{{ i18n('navSettings') }}</span>
        </div>
      </div>
    </nav>

    <main class="main-content">
      <template v-if="activeNav === 'models'">
        <div class="content-header">
          <h2>{{ i18n('modelConfig') }}</h2>
          <p class="content-desc">{{ i18n('modelConfigDesc') }}</p>
        </div>
        <div class="content-body">
          <aside class="provider-sidebar">
            <div class="sidebar-header">
              <span class="section-label">{{ i18n('providerList') }}</span>
              <button class="add-btn" @click="addNewProvider" :title="i18n('addProvider')">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
              </button>
            </div>
            <div class="provider-list">
              <div v-for="p in providers" :key="p.id" class="provider-item" :class="{ selected: p.id === selectedProviderId }" @click="selectProvider(p.id)">
                <div class="provider-info">
                  <div class="provider-name">{{ p.name }}</div>
                  <div class="provider-model">{{ i18n('modelsCount', { count: (Array.isArray(p.models) ? p.models : []).length }) }}</div>
                </div>
              </div>
              <div v-if="providers.length === 0" class="empty-list">{{ i18n('noProviders') }}</div>
            </div>
          </aside>
          <div class="provider-form-area">
            <div v-if="selectedProviderId" class="form-container">
              <div class="form-header">
                <h3>{{ isNewProvider ? i18n('addProvider') : i18n('editProvider') }}</h3>
                <div class="form-actions" v-if="!isNewProvider">
                  <button class="btn btn-danger" @click="removeProvider">{{ i18n('delete') }}</button>
                </div>
              </div>
              <div class="form-body">
                <div class="form-group">
                  <label>{{ i18n('providerName') }}</label>
                  <input v-model="formName" :placeholder="i18n('providerNamePlaceholder')" />
                </div>
                <div class="form-group">
                  <label>{{ i18n('baseUrl') }}</label>
                  <input v-model="formBaseUrl" :placeholder="i18n('baseUrlPlaceholder')" />
                </div>
                <div class="form-group">
                  <label>{{ i18n('apiKey') }}</label>
                  <input v-model="formApiKey" type="password" :placeholder="i18n('apiKeyPlaceholder')" />
                </div>
                <div class="form-group">
                  <div class="label-row">
                    <label>{{ i18n('modelList') }}</label>
                    <button class="fetch-btn" @click="fetchAvailableModels" :disabled="isFetchingModels">{{ isFetchingModels ? i18n('fetchingModels') : i18n('fetchModels') }}</button>
                  </div>
                  <div v-if="availableModels.length > 0" class="available-models">
                    <div class="available-models-label">{{ i18n('availableModels') }}</div>
                    <div class="model-tags">
                      <button v-for="m in availableModels" :key="m" class="model-tag" :class="{ added: formModels.includes(m) }" @click="addModel(m)" :disabled="formModels.includes(m)">{{ m }}</button>
                    </div>
                  </div>
                  <div class="custom-model-input">
                    <input v-model="formCustomModel" :placeholder="i18n('customModelPlaceholder')" @keydown.enter="addCustomModel" />
                    <button class="add-model-btn" @click="addCustomModel" :disabled="!formCustomModel.trim()">{{ i18n('add') }}</button>
                  </div>
                  <div v-if="formModels.length > 0" class="selected-models">
                    <div class="selected-models-label">{{ i18n('addedModels') }}</div>
                    <div class="model-list">
                      <div v-for="m in formModels" :key="m" class="model-item">
                        <span class="model-name">{{ m }}</span>
                        <button class="remove-model-btn" @click="removeModel(m)" :title="i18n('delete')">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
                <div class="form-footer">
                  <button class="btn btn-primary" @click="saveCurrentProvider" :disabled="isSaving">{{ isSaving ? i18n('saving') : i18n('saveConfig') }}</button>
                </div>
              </div>
            </div>
            <div v-else class="empty-form"><p>{{ i18n('selectOrAddProvider') }}</p></div>
          </div>
        </div>
      </template>

      <template v-if="activeNav === 'skills'">
        <div class="content-header">
          <h2>{{ i18n('skillsManagement') }}</h2>
          <p class="content-desc">{{ i18n('skillsManagementDesc') }}</p>
        </div>
        <div class="content-body">
          <aside class="provider-sidebar">
            <div class="sidebar-header">
              <span class="section-label">{{ i18n('installedSkills') }}</span>
              <button class="add-btn" @click="openImportModal" :title="i18n('importSkill')">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
              </button>
            </div>
            <div class="provider-list">
              <div v-for="skill in skills" :key="skill.id" class="provider-item" :class="{ selected: skill.id === selectedSkillId }" @click="selectSkill(skill.id)">
                <div class="provider-info">
                  <div class="provider-name">{{ skill.metadata.name }}</div>
                  <div class="provider-model">{{ i18n('scriptsCount', { count: skill.scripts.length }) }}</div>
                </div>
              </div>
              <div v-if="skills.length === 0" class="empty-list">{{ i18n('noSkills') }}</div>
            </div>
          </aside>
          <div class="provider-form-area">
            <div v-if="selectedSkill" class="form-container">
              <div class="form-header">
                <h3>{{ selectedSkill.metadata.name }}</h3>
                <div class="form-actions">
                  <button class="btn btn-danger" @click="removeSkill(selectedSkill.id)">{{ i18n('delete') }}</button>
                </div>
              </div>
              <div class="form-body">
                <div class="skill-info-section">
                  <div class="skill-meta">
                    <span class="skill-badge">{{ selectedSkill.source === 'imported' ? i18n('imported') : i18n('builtin') }}</span>
                    <span class="skill-date">{{ formatDate(selectedSkill.importedAt) }}</span>
                  </div>
                  <div class="skill-description">{{ selectedSkill.metadata.description }}</div>
                  <div v-if="selectedSkill.metadata.compatibility" class="skill-compat">
                    <span class="compat-label">{{ i18n('compatibility') }}</span>{{ selectedSkill.metadata.compatibility }}
                  </div>
                </div>
                <div v-if="selectedSkill.scripts.length > 0" class="form-group">
                  <label>{{ i18n('scriptFiles') }}</label>
                  <div class="script-list">
                    <div v-for="script in selectedSkill.scripts" :key="script.name" class="script-item">
                      <div class="script-info">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M10 12l-2 2 2 2M14 12l2 2-2 2"/>
                        </svg>
                        <span class="script-name">{{ script.name }}</span>
                      </div>
                      <div class="script-actions">
                        <span v-if="skillTrustedScripts.some(t => t.scriptName === script.name)" class="trusted-badge" @click="handleUntrustScript(selectedSkill!.id, script.name)" :title="i18n('confirmUntrustScript', { name: script.name })">{{ i18n('trusted') }}</span>
                        <span v-else class="untrusted-badge">{{ i18n('needConfirm') }}</span>
                      </div>
                    </div>
                  </div>
                  <p class="script-hint">{{ i18n('scriptHint') }}</p>
                </div>
                <div v-if="selectedSkill.references.length > 0" class="form-group">
                  <label>{{ i18n('referenceFiles') }}</label>
                  <div class="resource-list">
                    <div v-for="ref in selectedSkill.references" :key="ref.name" class="resource-item">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/></svg>
                      <span>{{ ref.name }}</span>
                    </div>
                  </div>
                </div>
                <div v-if="selectedSkill.assets.length > 0" class="form-group">
                  <label>{{ i18n('assetFiles') }}</label>
                  <div class="resource-list">
                    <div v-for="asset in selectedSkill.assets" :key="asset.name" class="resource-item">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
                      <span>{{ asset.name }}</span>
                    </div>
                  </div>
                </div>
                <div class="form-group">
                  <label>{{ i18n('instructionsPreview') }}</label>
                  <div class="instructions-preview">
                    <pre>{{ selectedSkill.instructions.slice(0, 500) }}{{ selectedSkill.instructions.length > 500 ? '...' : '' }}</pre>
                  </div>
                </div>
              </div>
            </div>
            <div v-else class="empty-form">
              <div class="empty-icon">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/></svg>
              </div>
              <p>{{ i18n('selectSkillOrImport') }}</p>
              <button class="btn btn-primary" @click="openImportModal">{{ i18n('importSkill') }}</button>
            </div>
          </div>
        </div>
      </template>

      <template v-if="activeNav === 'settings'">
        <div class="content-header">
          <h2>{{ i18n('generalSettings') }}</h2>
          <p class="content-desc">{{ i18n('generalSettingsDesc') }}</p>
        </div>
        <div class="content-body settings-body">
          <div class="settings-section">
            <div class="settings-card">
              <div class="settings-item">
                <div class="settings-item-info">
                  <div class="settings-item-label">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <circle cx="12" cy="12" r="10"/>
                      <path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/>
                    </svg>
                    <span>{{ i18n('language') }}</span>
                  </div>
                  <p class="settings-item-desc">{{ i18n('languageDesc') }}</p>
                </div>
                <div class="settings-item-control">
                  <div class="language-selector">
                    <button 
                      class="lang-btn" 
                      :class="{ active: currentLanguage === 'en' }"
                      @click="handleLanguageChange('en')"
                    >
                      English
                    </button>
                    <button 
                      class="lang-btn" 
                      :class="{ active: currentLanguage === 'zh-CN' }"
                      @click="handleLanguageChange('zh-CN')"
                    >
                      简体中文
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>
    </main>

    <div v-if="showImportModal" class="modal-overlay" @click.self="closeImportModal">
      <div class="modal import-modal">
        <div class="modal-header">
          <h3>{{ i18n('importSkillTitle') }}</h3>
          <button class="close-btn" @click="closeImportModal">×</button>
        </div>
        <div class="modal-body">
          <p class="import-desc">{{ i18n('importSkillDesc') }}</p>
          <div class="import-area">
            <input type="file" id="skill-folder-input" webkitdirectory directory @change="handleFolderImport" :disabled="isImporting" />
            <label for="skill-folder-input" class="import-label" :class="{ disabled: isImporting }">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
              <span>{{ isImporting ? i18n('importing') : i18n('selectFolder') }}</span>
            </label>
          </div>
          <div v-if="importError" class="import-error">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
            {{ importError }}
          </div>
          <div v-if="importWarnings.length > 0" class="import-warnings">
            <div class="warning-title">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              {{ i18n('importWarnings') }}
            </div>
            <ul><li v-for="(w, i) in importWarnings" :key="i">{{ w }}</li></ul>
            <button class="btn btn-primary" @click="closeImportModal">{{ i18n('confirm') }}</button>
          </div>
          <div class="import-help">
            <h4>{{ i18n('skillFolderStructure') }}</h4>
            <pre>my-skill/
├── SKILL.md          # {{ i18n('required') }}
├── scripts/          # {{ i18n('optional') }} ({{ i18n('jsOnly') }})
├── references/       # {{ i18n('optional') }}
└── assets/           # {{ i18n('optional') }}</pre>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
