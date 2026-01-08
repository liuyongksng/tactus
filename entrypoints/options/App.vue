<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import {
  providersStorage,
  activeProviderIdStorage,
  saveProvider,
  deleteProvider,
  type AIProvider,
} from '../../utils/storage';
import { fetchModels } from '../../utils/api';

// State
const providers = ref<AIProvider[]>([]);
const activeProviderId = ref<string | null>(null);
const selectedProviderId = ref<string | null>(null);
const availableModels = ref<string[]>([]);
const isFetchingModels = ref(false);
const isSaving = ref(false);

// Form state
const formName = ref('');
const formBaseUrl = ref('');
const formApiKey = ref('');
const formModels = ref<string[]>([]);
const formCustomModel = ref('');

// Computed
const isNewProvider = computed(() => {
  return selectedProviderId.value === 'new';
});

// Initialize
onMounted(async () => {
  providers.value = await providersStorage.getValue();
  activeProviderId.value = await activeProviderIdStorage.getValue();
  
  if (providers.value.length > 0) {
    selectProvider(activeProviderId.value || providers.value[0].id);
  }
});

// Select provider
function selectProvider(id: string) {
  selectedProviderId.value = id;
  const provider = providers.value.find(p => p.id === id);
  if (provider) {
    formName.value = provider.name;
    formBaseUrl.value = provider.baseUrl;
    formApiKey.value = provider.apiKey;
    formModels.value = [...(provider.models || [])];
    formCustomModel.value = '';
    // 切换服务商时清空可用模型列表，需要重新获取
    availableModels.value = [];
  }
}

// Add new provider
function addNewProvider() {
  selectedProviderId.value = 'new';
  formName.value = '';
  formBaseUrl.value = '';
  formApiKey.value = '';
  formModels.value = [];
  formCustomModel.value = '';
  availableModels.value = [];
}

// Fetch models
async function fetchAvailableModels() {
  if (!formBaseUrl.value || !formApiKey.value) {
    alert('请先填写 Base URL 和 API Key');
    return;
  }
  
  isFetchingModels.value = true;
  try {
    const models = await fetchModels(formBaseUrl.value, formApiKey.value);
    availableModels.value = models.map(m => m.id);
  } catch (e) {
    console.error('Failed to fetch models:', e);
    alert('获取模型列表失败，请检查配置');
  } finally {
    isFetchingModels.value = false;
  }
}

// Add model to list
function addModel(model: string) {
  if (model && !formModels.value.includes(model)) {
    formModels.value.push(model);
  }
}

// Add custom model
function addCustomModel() {
  const model = formCustomModel.value.trim();
  if (model) {
    addModel(model);
    formCustomModel.value = '';
  }
}

// Remove model from list
function removeModel(model: string) {
  formModels.value = formModels.value.filter(m => m !== model);
}

// Save provider
async function saveCurrentProvider() {
  if (!formName.value || !formBaseUrl.value || !formApiKey.value) {
    alert('请填写服务商名称、Base URL 和 API Key');
    return;
  }
  
  if (formModels.value.length === 0) {
    alert('请至少添加一个模型');
    return;
  }

  isSaving.value = true;
  try {
    // 获取现有 provider 的 selectedModel，保持用户之前的选择
    const existingProvider = providers.value.find(p => p.id === selectedProviderId.value);
    const selectedModel = existingProvider?.selectedModel && formModels.value.includes(existingProvider.selectedModel)
      ? existingProvider.selectedModel
      : formModels.value[0];

    const provider: AIProvider = {
      id: isNewProvider.value ? crypto.randomUUID() : selectedProviderId.value!,
      name: formName.value,
      baseUrl: formBaseUrl.value,
      apiKey: formApiKey.value,
      models: [...formModels.value],
      selectedModel: selectedModel,
    };

    await saveProvider(provider);
    providers.value = await providersStorage.getValue();
    
    if (!activeProviderId.value || isNewProvider.value) {
      activeProviderId.value = provider.id;
      await activeProviderIdStorage.setValue(provider.id);
    }

    selectedProviderId.value = provider.id;
    alert('保存成功');
  } finally {
    isSaving.value = false;
  }
}

// Delete provider
async function removeProvider() {
  if (!selectedProviderId.value || isNewProvider.value) return;
  
  if (confirm('确定删除这个服务商吗？')) {
    await deleteProvider(selectedProviderId.value);
    providers.value = await providersStorage.getValue();
    
    if (activeProviderId.value === selectedProviderId.value) {
      activeProviderId.value = providers.value[0]?.id || null;
      await activeProviderIdStorage.setValue(activeProviderId.value);
    }
    
    if (providers.value.length > 0) {
      selectProvider(providers.value[0].id);
    } else {
      selectedProviderId.value = null;
    }
  }
}
</script>

<template>
  <div class="options-page">
    <!-- Left Navigation -->
    <nav class="nav-sidebar">
      <div class="nav-header">
        <h1>TC Chrome Agent</h1>
      </div>
      <div class="nav-menu">
        <div class="nav-item active">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
          </svg>
          <span>模型配置</span>
        </div>
      </div>
    </nav>

    <!-- Main Content -->
    <main class="main-content">
      <div class="content-header">
        <h2>模型配置</h2>
        <p class="content-desc">管理 AI 服务商和模型</p>
      </div>

      <div class="content-body">
        <!-- Provider List -->
        <aside class="provider-sidebar">
          <div class="sidebar-header">
            <span class="section-label">服务商列表</span>
            <button class="add-btn" @click="addNewProvider" title="添加服务商">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 5v14M5 12h14"/>
              </svg>
            </button>
          </div>
          
          <div class="provider-list">
            <div
              v-for="p in providers"
              :key="p.id"
              class="provider-item"
              :class="{ selected: p.id === selectedProviderId }"
              @click="selectProvider(p.id)"
            >
              <div class="provider-info">
                <div class="provider-name">{{ p.name }}</div>
                <div class="provider-model">{{ (p.models || []).length }} 个模型</div>
              </div>
            </div>
            
            <div v-if="providers.length === 0" class="empty-list">
              暂无服务商配置
            </div>
          </div>
        </aside>

        <!-- Provider Form -->
        <div class="provider-form-area">
          <div v-if="selectedProviderId" class="form-container">
            <div class="form-header">
              <h3>{{ isNewProvider ? '添加服务商' : '编辑服务商' }}</h3>
              <div class="form-actions" v-if="!isNewProvider">
                <button class="btn btn-danger" @click="removeProvider">删除</button>
              </div>
            </div>

            <div class="form-body">
              <div class="form-group">
                <label>服务商名称</label>
                <input 
                  v-model="formName" 
                  placeholder="例如：OpenAI, Claude, DeepSeek"
                />
              </div>

              <div class="form-group">
                <label>Base URL</label>
                <input 
                  v-model="formBaseUrl" 
                  placeholder="https://api.openai.com"
                />
              </div>

              <div class="form-group">
                <label>API Key</label>
                <input 
                  v-model="formApiKey" 
                  type="password" 
                  placeholder="sk-..."
                />
              </div>

              <div class="form-group">
                <div class="label-row">
                  <label>模型列表</label>
                  <button
                    class="fetch-btn"
                    @click="fetchAvailableModels"
                    :disabled="isFetchingModels"
                  >
                    {{ isFetchingModels ? '获取中...' : '获取可用模型' }}
                  </button>
                </div>
                
                <!-- Available models from API -->
                <div v-if="availableModels.length > 0" class="available-models">
                  <div class="available-models-label">可用模型（点击添加）</div>
                  <div class="model-tags">
                    <button
                      v-for="m in availableModels"
                      :key="m"
                      class="model-tag"
                      :class="{ added: formModels.includes(m) }"
                      @click="addModel(m)"
                      :disabled="formModels.includes(m)"
                    >
                      {{ m }}
                    </button>
                  </div>
                </div>

                <!-- Custom model input -->
                <div class="custom-model-input">
                  <input
                    v-model="formCustomModel"
                    placeholder="手动输入模型名称"
                    @keydown.enter="addCustomModel"
                  />
                  <button class="add-model-btn" @click="addCustomModel" :disabled="!formCustomModel.trim()">
                    添加
                  </button>
                </div>

                <!-- Selected models -->
                <div v-if="formModels.length > 0" class="selected-models">
                  <div class="selected-models-label">已添加的模型</div>
                  <div class="model-list">
                    <div
                      v-for="m in formModels"
                      :key="m"
                      class="model-item"
                    >
                      <span class="model-name">{{ m }}</span>
                      <div class="model-actions">
                        <button class="remove-model-btn" @click="removeModel(m)" title="移除">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M18 6L6 18M6 6l12 12"/>
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div class="form-footer">
                <button 
                  class="btn btn-primary" 
                  @click="saveCurrentProvider"
                  :disabled="isSaving"
                >
                  {{ isSaving ? '保存中...' : '保存配置' }}
                </button>
              </div>
            </div>
          </div>

          <div v-else class="empty-form">
            <p>请选择或添加一个服务商</p>
          </div>
        </div>
      </div>
    </main>
  </div>
</template>
