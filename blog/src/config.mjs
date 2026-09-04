// 站点级配置:改这里就能换站名、导航、社交链接、是否开启留言
export default {
  site: {
    title: 'MostarManus个人博客空间——技术.成长.社交',
    seoName: 'MostarManus',
    description: '具身智能 · 大模型驱动机器人 · 独立思考的智能体 —— 从 ROS2 到 OpenClaw,从 PID 到 LLM Agent,记录一个机器人如何学会"自己想"。',
    author: 'MostarManus',
    lang: 'zh-CN',
    url: 'https://mostarmanus.ink',
  },
  nav: [
    { label: '首页', href: '/' },
    { label: '学习笔记', href: '/blog/' },
    { label: '项目', href: '/projects/' },
    { label: '关于 / 履历', href: '/about/' },
    { label: '友链', href: '/friends/' },
    { label: '专业术语', href: '/terms/' },
  ],
  // 笔记分类映射
  categories: {
    debug: { label: '排错记录', desc: '具身智能开发中的坑与解法' },
    learn: { label: '学习途径', desc: '从零搭建具身智能机器人的路线图' },
    insight: { label: '技术洞察', desc: '对大模型、机器人、AI Agent 的思考与分享' },
  },
  // 联系方式(留空即不显示)
  social: {
    email: '',                     // 暂不公开邮箱
    bilibili: '',
    weibo: '',
  },
};
