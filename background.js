console.log('Background service worker started');

// 添加全局变量来存储当前的 AbortController
let currentController = null;

// 分析函数
async function analyzeLocation(screenshot) {
  try {
    console.log('Starting analysis with screenshot');
    
    // 获取存储的设置
    const { apiKey, apiUrl, model } = await chrome.storage.local.get(['apiKey', 'apiUrl', 'model']);
    
    if (!apiKey || !apiUrl) {
      throw new Error('请先设置API域名和API Key');
    }

    // 构建完整的API URL
    const fullApiUrl = `${apiUrl.replace(/\/$/, '')}/v1/chat/completions`;
    console.log('Sending request to:', fullApiUrl);

    // 创建新的 AbortController 并保存到全局
    currentController = new AbortController();
    const timeoutId = setTimeout(() => currentController.abort(), 20000); // 20秒超时

    try {
      // 调用自定义API分析图片
      const response = await fetch(fullApiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: model || "gemini-2.0-flash",
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: `我在玩图寻，一个和geoguessr类似的游戏，根据我提供的图片分析信息，包括：地貌、人的肤色、路标、文字、交通标识、建筑风格、电线杆、车牌等信息，告诉我该图片所在的位置，越精确越好。
1. 我不需要你回答分析过程，只告诉我答案即可。请用中文回答！
2. 我是地理小白，必须要包含方位，我只知道东南西北！
3. 必须按格式输出，不能缺少任何信息，下侧为输出格式与示例！

输出格式：大洲 > 国家(位于大洲的方位) > 市(位于国家的方位)
输出示例：非洲 > 马达加斯加(非洲的东南部) > 贝富塔卡(马达加斯加的南部)`
                },
                {
                  type: "image_url",
                  image_url: {
                    url: screenshot
                  }
                }
              ]
            }
          ],
          max_tokens: 300
        }),
        signal: currentController.signal // 添加 signal
      });

      clearTimeout(timeoutId); // 清除超时计时器

      if (!response.ok) {
        // 尝试获取详细的错误信息
        let errorMessage = `API请求失败: ${response.status}`;
        try {
          const errorData = await response.json();
          if (errorData.error) {
            errorMessage += ` - ${errorData.error.message || errorData.error}`;
          }
        } catch (e) {
          // 如果无法解析错误响应，使用默认错误信息
        }
        throw new Error(errorMessage);
      }

      const result = await response.json();
      console.log('API Response:', result);
      
      if (!result.choices || !result.choices[0] || !result.choices[0].message) {
        throw new Error('API返回格式错误');
      }

      // 发送结果
      await chrome.storage.local.set({ 
        lastResult: result.choices[0].message.content 
      });
      
      return result.choices[0].message.content;
      
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        if (error.message && error.message !== 'The user aborted a request.') {
          throw error;
        }
        throw new Error('已取消识别');
      }
      throw error;
    } finally {
      currentController = null;
    }
    
  } catch (error) {
    console.error('Analysis error:', error);
    await chrome.storage.local.set({ 
      lastResult: `错误: ${error.message}` 
    });
    throw error;
  }
}

// 修改 showToast 函数，添加取消请求的功能
async function showToast(message, showTimer = false, isAnalyzing = false) {
  // 注入 CSS
  await chrome.scripting.insertCSS({
    target: { tabId: await getCurrentTabId() },
    files: ['styles/toast.css']
  });

  // 注入并显示 toast
  await chrome.scripting.executeScript({
    target: { tabId: await getCurrentTabId() },
    func: (message, showTimer, isAnalyzing) => {
      // 移除现有的 toast（如果有）
      const existingContainer = document.querySelector('.toast-container');
      if (existingContainer) {
        existingContainer.remove();
      }

      // 创建新的 toast
      const container = document.createElement('div');
      container.className = 'toast-container';
      document.body.appendChild(container);

      const toast = document.createElement('div');
      toast.className = 'toast toast-persistent';
      
      // 创建消息文本元素
      const messageText = document.createElement('span');
      messageText.textContent = message;
      
      // 如果需要显示计时器
      if (showTimer) {
        const timerSpan = document.createElement('span');
        timerSpan.className = 'toast-timer';
        timerSpan.textContent = '0s';
        
        // 启动计时器
        let seconds = 0;
        const timer = setInterval(() => {
          seconds++;
          timerSpan.textContent = `${seconds}s`;
        }, 1000);
        
        // 当 toast 被移除时清除计时器
        const clearTimer = () => {
          clearInterval(timer);
          container.remove();
          // 如果是在分析中，发送取消消息
          if (isAnalyzing) {
            chrome.runtime.sendMessage({ action: 'cancelAnalysis' });
          }
        };
        
        // 创建关闭按钮
        const closeButton = document.createElement('span');
        closeButton.className = 'toast-close';
        closeButton.textContent = '×';
        closeButton.onclick = clearTimer;
        
        // 添加元素到 toast
        toast.appendChild(messageText);
        toast.appendChild(timerSpan);
        toast.appendChild(closeButton);
      } else {
        // 创建普通关闭按钮
        const closeButton = document.createElement('span');
        closeButton.className = 'toast-close';
        closeButton.textContent = '×';
        closeButton.onclick = () => container.remove();
        
        // 添加元素到 toast
        toast.appendChild(messageText);
        toast.appendChild(closeButton);
      }
      
      container.appendChild(toast);
    },
    args: [message, showTimer, isAnalyzing]
  });
}

// 获取当前标签页 ID 的辅助函数
async function getCurrentTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab.id;
}

// 获取最新截图的函数
async function getLatestScreenshot() {
  // 先执行一次重绘
  await chrome.scripting.executeScript({
    target: { tabId: await getCurrentTabId() },
    func: () => {
      // 强制浏览器重新渲染
      document.body.style.webkitTransform = 'scale(1)';
      void document.body.offsetHeight; // 触发重排
      document.body.style.webkitTransform = '';
    }
  });

  // 等待一小段时间确保重绘完成
  await new Promise(resolve => setTimeout(resolve, 100));

  // 然后进行截图
  return await chrome.tabs.captureVisibleTab();
}

// 添加域名检查函数
async function isAllowedDomain() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = new URL(tab.url);
  return url.hostname.endsWith('tuxun.fun') || url.hostname.endsWith('google.com');
}

// 添加消息监听器来处理取消请求
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'cancelAnalysis' && currentController) {
    // 先设置错误信息，再中止请求
    const error = new Error('已取消识别');
    currentController.abort(error);
    currentController = null;
  }
  if (request.action === 'analyze') {
    // 立即返回响应
    sendResponse({ success: true });
    
    // 异步执行分析
    (async () => {
      try {
        // 检查域名
        if (!await isAllowedDomain()) {
          throw new Error('此插件仅支持在 tuxun.fun 和 google.com 使用');
        }

        // 显示识别中的toast，不自动关闭
        await showToast('识别中...', true, true);
        
        const screenshot = await getLatestScreenshot();
        if (!screenshot) {
          throw new Error('截图失败');
        }

        const result = await analyzeLocation(screenshot);
        await showToast(result);
        chrome.runtime.sendMessage({
          action: 'analysisComplete',
          result: result
        }).catch(console.error);
      } catch (error) {
        await showToast(`错误: ${error.message}`);
        chrome.runtime.sendMessage({
          action: 'analysisError',
          error: error.message
        }).catch(console.error);
      }
    })();
    
    return true;
  }
});

// 修改快捷键监听部分也做相同的改动
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'analyze-location') {
    try {
      // 检查域名
      if (!await isAllowedDomain()) {
        throw new Error('此插件仅支持在 tuxun.fun 和 google.com 使用');
      }

      const { apiKey, apiUrl } = await chrome.storage.local.get(['apiKey', 'apiUrl']);
      if (!apiKey || !apiUrl) {
        return;
      }

      // 显示识别中的toast，不自动关闭
      await showToast('识别中...', true, true);
      
      const screenshot = await getLatestScreenshot();
      if (!screenshot) {
        throw new Error('截图失败');
      }

      const result = await analyzeLocation(screenshot);
      await showToast(result);
      
    } catch (error) {
      console.error('Shortcut analysis error:', error);
      await showToast(`错误: ${error.message}`);
    }
  }
});