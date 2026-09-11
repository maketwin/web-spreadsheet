import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'web-spreadsheet',
  description: '现代化 TypeScript 电子表格 SDK',
  base: '/web-spreadsheet/',
  themeConfig: {
    nav: [
      { text: '指南', link: '/guide/getting-started' },
      { text: 'API', link: '/api/spreadsheet' },
      { text: '插件', link: '/plugins/creating-plugins' },
      { text: 'GitHub', link: 'https://github.com/maketwin/web-spreadsheet' },
    ],
    sidebar: {
      '/guide/': [
        {
          text: '入门',
          items: [
            { text: '快速开始', link: '/guide/getting-started' },
            { text: '数据模型', link: '/guide/data-model' },
            { text: '架构总览', link: '/guide/architecture' },
          ],
        },
        {
          text: '核心功能',
          items: [
            { text: '公式引擎', link: '/guide/formulas' },
            { text: '命令与撤销', link: '/guide/commands' },
            { text: '智能填充', link: '/guide/fill' },
            { text: '格式化', link: '/guide/formatting' },
            { text: '数据功能', link: '/guide/data-features' },
          ],
        },
        {
          text: '进阶',
          items: [
            { text: '文件 I/O 与持久化', link: '/guide/io' },
            { text: '事件系统', link: '/guide/events' },
            { text: '键盘快捷键', link: '/guide/keyboard' },
            { text: '主题与暗色模式', link: '/guide/theming' },
          ],
        },
      ],
      '/api/': [
        { text: 'Spreadsheet', link: '/api/spreadsheet' },
      ],
      '/plugins/': [
        { text: '插件开发', link: '/plugins/creating-plugins' },
      ],
    },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/maketwin/web-spreadsheet' },
    ],
    outline: [2, 3],
    search: {
      provider: 'local',
    },
  },
});
