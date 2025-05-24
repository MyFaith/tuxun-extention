document.addEventListener('DOMContentLoaded', async () => {
  // 加载保存的设置
  const { apiKey, apiUrl, model } = await chrome.storage.local.get(['apiKey', 'apiUrl', 'model']);
  
  if (apiKey) {
    document.getElementById('apiKey').value = apiKey;
  }
  if (apiUrl) {
    document.getElementById('apiUrl').value = apiUrl;
  }
  if (model) {
    document.getElementById('model').value = model;
  }

  // 保存设置
  document.getElementById('saveSettings').addEventListener('click', async () => {
    const apiKey = document.getElementById('apiKey').value.trim();
    const apiUrl = document.getElementById('apiUrl').value.trim();
    const model = document.getElementById('model').value.trim();

    await chrome.storage.local.set({
      apiKey,
      apiUrl,
      model
    });

    window.close();
  });

  // 添加分析按钮点击处理
  document.getElementById('analyzeButton').addEventListener('click', async () => {
    try {
      const { apiKey, apiUrl } = await chrome.storage.local.get(['apiKey', 'apiUrl']);
      if (!apiKey || !apiUrl) {
        return;
      }

      // 截取当前页面
      const screenshot = await chrome.tabs.captureVisibleTab();
      if (!screenshot) {
        return;
      }

      // 调用background.js中的分析函数
      await chrome.runtime.sendMessage({ 
        action: 'analyze',
        screenshot: screenshot
      });
      
    } catch (error) {
      console.error('Analysis error:', error);
    }
  });
}); 