// 裸 CSS 动态导入的模块声明
// izitoast 的样式表在 src/lib/toast.ts 中动态 import 注入(避免污染服务端 bundle),
// 该包不自带类型,Next.js 全局声明也不覆盖非 .module.css 的第三方 CSS
declare module 'izitoast/dist/css/iziToast.min.css'
