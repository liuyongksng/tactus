/**
 * 获取 linux.do 帖子正文及评论区
 * 
 * 参数 (__args__):
 * - topicId: 帖子 ID (必填)
 * 
 * 注意：脚本需要在 linux.do 页面上执行，浏览器会自动携带 cookie
 */

const { topicId } = __args__;

if (!topicId) {
  return {
    success: false,
    error: '缺少必填参数: topicId'
  };
}

// fetch 同域请求会自动携带 cookie，无需手动设置
const headers = {
  "accept": "application/json, text/plain, */*",
  "cache-control": "no-cache"
};

/**
 * 带重试的 fetch 请求
 * @param {string} url 请求地址
 * @param {object} options fetch 选项
 * @param {number} retries 重试次数
 * @param {number} delay 重试间隔(ms)
 */
async function fetchWithRetry(url, options = {}, retries = 3, delay = 2000) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, options);
      if (response.ok) {
        return response;
      }
      throw new Error(`HTTP ${response.status}`);
    } catch (error) {
      if (i === retries - 1) throw error;
      console.log(`[fetch-post] 请求失败，${delay}ms 后重试 (${i + 1}/${retries}):`, error.message);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

/**
 * 解析 raw 格式的帖子内容
 * 格式: author | datetime UTC | #楼层号\n内容\n-------------------------
 */
function parseRawContent(rawText) {
  const posts = [];
  const sections = rawText.split('-------------------------');
  
  for (const section of sections) {
    const trimmed = section.trim();
    if (!trimmed) continue;
    
    // 匹配: author | datetime UTC | #楼层号
    const headerMatch = trimmed.match(/^(.+?)\s*\|\s*(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\s*UTC\s*\|\s*#(\d+)\s*\n([\s\S]*)$/);
    
    if (headerMatch) {
      const [, author, datetime, postNumber, content] = headerMatch;
      posts.push({
        postNumber: parseInt(postNumber, 10),
        author: author.trim(),
        createdAt: datetime.trim(),
        content: content.trim()
      });
    }
  }
  
  return posts;
}

/**
 * 获取帖子 JSON 数据，解析回复关系
 */
async function fetchPostJson(topicId) {
  const url = `https://linux.do/t/topic/${topicId}.json?print=true`;
  
  const response = await fetchWithRetry(url, { headers });
  
  const data = await response.json();
  
  // 构建回复关系映射
  const replyMap = {};
  if (data.post_stream && data.post_stream.posts) {
    for (const post of data.post_stream.posts) {
      replyMap[post.post_number] = {
        replyTo: post.reply_to_post_number || null,
        username: post.username,
        name: post.name
      };
    }
  }
  
  return {
    title: data.title,
    replyMap,
    postsCount: data.posts_count
  };
}

/**
 * 获取帖子 raw 内容
 */
async function fetchRawContent(topicId) {
  const url = `https://linux.do/raw/${topicId}`;
  
  const response = await fetchWithRetry(url, { headers });
  
  return await response.text();
}

/**
 * 聚合评论为讨论串
 * 把有回复关系的评论聚合到同一个数组中
 */
function aggregateToThreads(posts, replyMap) {
  // 为每个帖子添加回复信息（排除主帖）
  const comments = posts
    .filter(post => post.postNumber > 1)
    .map(post => ({
      ...post,
      replyTo: replyMap[post.postNumber]?.replyTo || 1  // 默认回复主帖
    }));
  
  // 使用并查集思想，找到每个评论所属的讨论串根节点
  const parent = {};  // postNumber -> 根节点 postNumber
  
  // 初始化：每个评论自己是根
  for (const comment of comments) {
    parent[comment.postNumber] = comment.postNumber;
  }
  
  // 查找根节点
  function findRoot(postNumber) {
    if (parent[postNumber] === undefined) return postNumber;
    if (parent[postNumber] !== postNumber) {
      parent[postNumber] = findRoot(parent[postNumber]);
    }
    return parent[postNumber];
  }
  
  // 合并：如果 A 回复 B，则它们属于同一讨论串
  for (const comment of comments) {
    if (comment.replyTo > 1 && parent[comment.replyTo] !== undefined) {
      // 找到两者的根，合并到较小的楼层号
      const rootA = findRoot(comment.postNumber);
      const rootB = findRoot(comment.replyTo);
      if (rootA !== rootB) {
        const minRoot = Math.min(rootA, rootB);
        const maxRoot = Math.max(rootA, rootB);
        parent[maxRoot] = minRoot;
      }
    }
  }
  
  // 按根节点分组
  const threadMap = {};
  for (const comment of comments) {
    const root = findRoot(comment.postNumber);
    if (!threadMap[root]) {
      threadMap[root] = [];
    }
    threadMap[root].push(comment);
  }
  
  // 转为数组，每个讨论串内按楼层排序
  const threads = Object.values(threadMap).map(thread => 
    thread.sort((a, b) => a.postNumber - b.postNumber)
  );
  
  // 讨论串按首条评论楼层排序
  threads.sort((a, b) => a[0].postNumber - b[0].postNumber);
  
  return threads;
}

try {
  console.log('[fetch-post] 开始获取帖子:', topicId);
  
  // 先获取 raw 内容（必须成功）
  const rawContent = await fetchRawContent(topicId);
  console.log('[fetch-post] raw 获取完成, 长度:', rawContent.length);
  
  // 解析 raw 内容
  const posts = parseRawContent(rawContent);
  console.log('[fetch-post] 解析完成, 帖子数:', posts.length);
  
  if (posts.length === 0) {
    return {
      success: false,
      error: '无法解析帖子内容'
    };
  }
  
  // 获取主帖
  const mainPost = posts.find(p => p.postNumber === 1);
  
  // 尝试获取 JSON 数据（可选，失败则降级）
  let jsonData = null;
  try {
    jsonData = await fetchPostJson(topicId);
    console.log('[fetch-post] JSON 获取完成, title:', jsonData.title);
  } catch (jsonError) {
    console.warn('[fetch-post] JSON 获取失败，降级为原始评论模式:', jsonError.message);
  }
  
  // 根据是否有 JSON 数据决定返回格式
  if (jsonData) {
    // 有 JSON 数据：聚合为讨论串
    const threads = aggregateToThreads(posts, jsonData.replyMap);
    
    const result = {
      success: true,
      mode: 'threads',
      topic: {
        id: topicId,
        title: jsonData.title
      },
      mainPost: mainPost ? {
        author: mainPost.author,
        content: mainPost.content,
        createdAt: mainPost.createdAt
      } : null,
      threads: threads,
      totalPosts: posts.length,
      threadsCount: threads.length,
      message: `成功获取帖子内容，共 ${posts.length} 条帖子（含主帖），${threads.length} 个讨论串`
    };
    
    console.log('[fetch-post] 返回结果:', result.success, result.message);
    return result;
  } else {
    // 无 JSON 数据：返回原始评论列表
    const comments = posts
      .filter(p => p.postNumber > 1)
      .map(p => ({
        postNumber: p.postNumber,
        author: p.author,
        content: p.content,
        createdAt: p.createdAt
      }));
    
    const result = {
      success: true,
      mode: 'comments',
      topic: {
        id: topicId,
        title: null  // JSON 获取失败，无法获取标题
      },
      mainPost: mainPost ? {
        author: mainPost.author,
        content: mainPost.content,
        createdAt: mainPost.createdAt
      } : null,
      comments: comments,
      totalPosts: posts.length,
      commentsCount: comments.length,
      message: `成功获取帖子内容（降级模式），共 ${posts.length} 条帖子（含主帖），${comments.length} 条评论`
    };
    
    console.log('[fetch-post] 返回结果(降级):', result.success, result.message);
    return result;
  }
  
} catch (error) {
  console.error('[fetch-post] 错误:', error);
  return {
    success: false,
    error: error.message || '获取帖子失败'
  };
}
