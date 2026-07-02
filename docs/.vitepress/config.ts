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
        { text: '快速开始', link: '/guide/getting-started' },
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
  },
});
